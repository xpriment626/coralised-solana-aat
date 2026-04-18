# Fixture 02 — compliance-demo runtime spec (source-only)

**Source:** `/Users/bambozlor/Desktop/content-lab/compliance-demo/coral-sanctions-agent/src/main/kotlin/ai/coralprotocol/coral/koog/fullexample/Main.kt` (verbatim copy as `Main.kt` in this directory).

**Status:** packaged 2026-04-18 as a **source-level spec**, not a wire-level capture. See "Why source-only" below.

## What this fixture asserts

The Koog-based compliance-demo runtime implements three primitives that any TS Coral atom runtime must replicate to handle the **send** path correctly. Each primitive is identified by location in `Main.kt`. The TS implementation must produce equivalent behavior; this fixture defines what equivalent means.

### Primitive 1: Runtime-managed tool gate

**Koog implementation** — `Main.kt:69`:
```kotlin
private val RUNTIME_MANAGED_THREAD_TOOLS = setOf("coral_send_message", "coral_create_thread")
```

And in the iteration loop at `Main.kt:1058–1071`:
```kotlin
val allowedCalls = toolsToCall.filter { call ->
    if (call.tool in RUNTIME_MANAGED_THREAD_TOOLS) {
        rejectedCalls += call
        false
    }
    // ... other phase-aware rules ...
    else { true }
}
```

The model is permitted to *attempt* `coral_send_message` and `coral_create_thread`, but the runtime intercepts those calls before execution, splits them into `rejectedCalls`, and substitutes a rejection result that flows back into the model's context (`Main.kt:1073–1084`):

```kotlin
val rejectedResults = rejectedCalls.map {
    val rejectionReason = when {
        it.tool in RUNTIME_MANAGED_THREAD_TOOLS ->
            "Tool '${it.tool}' is runtime-managed. Do not call it from the model."
        // ...
    }
    buildRejectedToolResult(it, rejectionReason)
}
```

This matters because: the model would otherwise emit `coral_send_message` calls with content it composed itself (often premature, often without the right structured payload). By rejecting and feeding a structured "do not call this" reason back, the runtime keeps the model from finalizing prematurely AND teaches it within-session that this tool is off-limits.

**Pi-mono mapping:** [`beforeToolCall`](https://github.com/mariozechner/pi-mono) returning `{block: true, reason}`. The pi-mono attempt 1 in `archive/pi-mono-attempt-1` had a `makeToolGate` helper for exactly this; that helper was correct in shape, the receive path failure (fixture 01) prevented it from ever being exercised.

### Primitive 2: Workflow state extracted from tool results

**Koog implementation** — `Main.kt:72–86`:
```kotlin
private data class ScreeningWorkflowState(
    var dilisenseChecks: Int = 0,
    var hasClearMatch: Boolean = false,
    var maxObservedHits: Int = 0,
    // ... 8 more fields ...
    var finalSent: Boolean = false,
    var subjectName: String = "unknown",
    // ...
)
```

State is mutated from tool results inside the iteration loop (`Main.kt:1088–1123`):

```kotlin
toolResult.forEach { result ->
    if (result.tool == "dilisense_check_individual" && !isToolFailure(result)) {
        workflowState.dilisenseChecks++
        // ... extract subject name, dob, signals ...
        if (signals.validatedSanctionsHits > 0) {
            workflowState.hasClearMatch = true
        }
        // ... more state mutations ...
    }
    // tavily fail tracking ...
}
```

This matters because: the runtime cannot make a finalize decision based on raw tool outputs (verbose, unstructured) — it needs a typed projection. The model cannot be trusted to maintain this projection in its own working memory across iterations. So the runtime extracts and owns it.

**Pi-mono mapping:** `afterToolCall` hook with a closure-captured state object (or pi-mono's `defineAtomState<TPhase, TData>` helper from the archived attempt 1). The state object is per-atom-instance; the runtime owns it, the model never reads it directly.

### Primitive 3: Runtime-driven finalization on terminal state

**Koog implementation** — `Main.kt:1141–1151` (in the iteration loop):
```kotlin
if (!workflowState.finalSent) {
    val resolvedThreadId = trackingThreadId
    val shouldFinalizeNoMatch =
        !workflowState.hasClearMatch &&
                workflowState.dilisenseChecks >= MAX_DILISENSE_CHECKS
    if ((workflowState.hasClearMatch || shouldFinalizeNoMatch) && !resolvedThreadId.isNullOrBlank()) {
        sendFinalScreeningResult(resolvedThreadId, workflowState)
        workflowState.finalSent = true
        shouldStopAfterIteration = true
    }
}
```

And a fallback after the iteration ceiling (`Main.kt:1193–1203`):
```kotlin
if (!workflowState.finalSent) {
    try {
        trackingThreadId = ensureTrackingThreadId(parser, settings, trackingThreadId)
        trackingThreadId?.let {
            sendFinalScreeningResult(it, workflowState)
            workflowState.finalSent = true
        }
    } catch (e: Exception) {
        println("Failed to send fallback final JSON message: ${e.message}")
    }
}
```

The actual send (`Main.kt:812–824`):
```kotlin
private suspend fun ai.koog.agents.core.agent.context.AIAgentFunctionalContext.sendFinalScreeningResult(
    threadId: String,
    state: ScreeningWorkflowState
) {
    val finalJson = buildFinalScreeningJson(state)
    val args = buildJsonObject {
        put("threadId", JsonPrimitive(threadId))
        put("content", JsonPrimitive(finalJson.toString()))
        put("mentions", buildJsonArray { })
    }
    environment.executeTool(buildToolCall("coral_send_message", args))
}
```

This matters because: the **runtime** composes the final payload from accumulated state and **the runtime** posts it via `coral_send_message` — bypassing the model entirely. The model never sees `coral_send_message` succeed; it only sees the rejection reasons. The send-path correctness becomes a property of the runtime's state machine, not a property of the model's judgment.

**Pi-mono mapping:** `agent.subscribe("turn_end", (ctx) => { ... if (state.phase === "ready_to_finalize") { coral.callTool("coral_send_message", composeArgs(state)); state.phase = "sent"; agent.abort(); } })`. The archived attempt 1 had this shape in `agents/market-trends/index.ts`; the receive failure (fixture 01) prevented it from ever firing.

## Other primitives worth knowing about (not strictly required for fixture conformance)

These exist in `Main.kt` and are useful patterns, but a TS implementation can elide them on the first pass without violating the fixture.

- **Tool argument sanitization** (`Main.kt:532` — `sanitizeTavilyCall`): runtime rewrites bad model-supplied args (e.g. invalid `time_range` values) before execution. Pi-mono equivalent: `AgentTool.prepareArguments` or a thin wrapper inside `beforeToolCall`.
- **Result content compaction** (`Main.kt:600` — `compactDilisenseResultContent`): runtime trims verbose tool output before it goes back into the model's context, to control token spend. Pi-mono equivalent: a transform inside `afterToolCall` that mutates `ctx.toolResult.content`.
- **Realtime status pings** (`Main.kt:195` — `sendRealtimeToolStatus`): runtime sends per-tool-call status messages to a tracking thread (separate from the final result). This is a UX nicety, not a correctness requirement. Skip on first pi-mono pass.
- **Phase-aware system prompt** (`Main.kt:752` — `buildForceTavilyPrompt`): runtime injects different instructions into the system prompt based on workflow state. Pi-mono equivalent: rebuild systemPrompt per iteration, or use a dedicated phase prompt slot.

## Why source-only (no live wire capture)

A wire-level capture from compliance-demo would require booting its Coral Server (Gradle), the sanctions agent (separate Gradle process), and triggering a screening (via React frontend or REST). That captures bytes confirming the code does what its name says — which is low-value evidence given:

- Fixture 01 already proves wire-level receive works in a TS context against the Coral protocol.
- The send mechanism in `Main.kt` is unambiguous as a runtime contract — there's no contested wire-level behavior that would require empirical verification.
- The expensive part of pi-mono attempt 1 (the *receive* mechanism that wasn't obvious from any single source file) is locked down by fixture 01.
- A wire trace of Koog's send would not help diagnose a future TS send failure, because the failure mode would be in the TS runtime's state machine logic, not in what bytes the runtime puts on the MCP transport.

If a future pi-mono attempt fails specifically on the send path AND we cannot diagnose it from logs + state inspection, *that* is when we capture a live compliance-demo trace and diff. Until then this is YAGNI.

## The contract any future TS runtime must satisfy (from this fixture)

A new pi-mono (or other) atom implementation passes this fixture if:

1. **Tool gate present.** `coral_send_message` and `coral_create_thread` are intercepted before execution. Model-initiated calls return a structured rejection result with a reason, not silently dropped.
2. **State extracted from tool results.** The runtime maintains a typed state object that is mutated from tool results, not from model output text. The state object is the source of truth for "are we done?"
3. **Runtime composes and posts the final message.** The final `coral_send_message` invocation is made by the runtime (not the model) using args composed from the state object. The trigger condition is a state predicate, not a model decision.
4. **Final-send is idempotent.** A `finalSent` (or equivalent) latch prevents duplicate posts even if the iteration loop continues for a tick.
5. **Fallback finalize.** If the iteration ceiling is hit without state reaching the terminal predicate, a fallback finalize fires with the partial state (avoids zombie atoms).

Predicates 1, 3, and 4 are non-negotiable. Predicate 2 is technically replaceable with model-output parsing but doing so reintroduces the failure mode the runtime gate exists to prevent. Predicate 5 is best-practice; an atom that exits without finalizing produces `message_non_execution` artifacts.

## Files in this fixture

| File | What it is |
|---|---|
| `Main.kt` | Verbatim copy of the canonical Koog atom (1208 lines). Read top-down for the full pattern; use the line refs in this README to navigate to the runtime primitives. |

## How to use this fixture

When implementing or reviewing a future pi-mono atom's send path:

1. For each primitive above, locate the equivalent in the pi-mono atom code (likely under `agents/<atom>/index.ts` and `agents/<atom>/atom-config.ts`).
2. Verify each of the five contract predicates is satisfied. A missing predicate = fixture violation = blocker.
3. If unsure how a Koog primitive maps to pi-mono, read the cited `Main.kt` line range for the exact mechanics and compare to pi-mono's hook semantics. The mapping is structural, not literal — pi-mono's hook names are `beforeToolCall` / `afterToolCall` / `subscribe("turn_end")`, not Koog's `functionalStrategy` block, but the responsibilities are 1:1.
