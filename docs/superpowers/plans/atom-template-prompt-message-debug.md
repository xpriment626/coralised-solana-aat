# Atom Template: Prompt, Message, and Debug Contracts

Design Source: `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md`

Depends On:
- `docs/superpowers/plans/atom-template-runtime-loop.md` — the loop body, registry, and MCP client are prerequisites. This plan fills in how the loop constructs prompts, sends Coral messages, and records debug artifacts.

Scope Summary: Give the atom template its behavioural shell — system prompt composition with Coral resource placeholders, the `atom_request` / `atom_result` JSON contract sent through `coral_send_message`, and a per-iteration debug artifact writer. Replaces the quiet-turn finalization placeholder from plan 2 with an explicit "message-sent" signal.

---

## Tasks

### Task 1: Prompt composers (Koog-parity)

Goal: Implement two composers — `buildSystemPrompt` and `buildUserTurn` — that match how Koog's `fullexample` builds its prompt surface. Reference: `coral-koog-agent/src/main/kotlin/.../fullexample/util/coral/CoralMCPUtils.kt` (`buildSystemPrompt`, `buildInitialUserMessage`, `injectedWithMcpResources`).

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md` (Prompt Contract section)
- `src/runtime/loop.ts`
- `src/runtime/tools.ts`
- Koog reference (for structural parity): https://github.com/Coral-Protocol/coral-koog-agent/blob/main/src/main/kotlin/ai/coralprotocol/coral/koog/fullexample/util/coral/CoralMCPUtils.kt

Allowed Write Scope:
- `src/runtime/prompt.ts` (new file)

Out Of Scope:
- `src/runtime/loop.ts` (extended in Task 4, not here)
- Any change to the four prompt options themselves — this task consumes them, doesn't redesign them

Steps:
1. Export `buildSystemPrompt({ systemPrompt, extraSystemPrompt, instructionResource, stateResource })`:
   - Concatenate `systemPrompt` + `"\n\n"` + `extraSystemPrompt` (omit the extra block if it's blank, mirroring Koog's `isNotBlank` check).
   - Expand `<resource>coral://instruction</resource>` → `<resource uri="coral://instruction">\n${instructionResource}\n</resource>` and the same for `coral://state`. This matches `injectedWithMcpResources` in Koog.
   - Return the composed string. The atom-name / capability / tool-list scaffolding is **not** injected here — those belong in the atom's configured `SYSTEM_PROMPT` value (the manifest author writes them). The runtime's job is option composition + resource injection, nothing more.
2. Export `buildUserTurn({ iteration, extraInitialUserPrompt, followupUserPrompt })`:
   - On `iteration === 0`, return the Koog `buildInitialUserMessage` equivalent: the generic autonomous-agent preamble (`"[automated message] You are an autonomous agent designed to assist users by collaborating with other agents. ..."`), followed — only when `extraInitialUserPrompt` is non-blank — by `"Here are some additional instructions to guide your behavior:"` and an XML-like `<specific instructions>...</specific instructions>` block containing it, followed by the "I am not the user" reminder.
   - On `iteration > 0`, return `followupUserPrompt` verbatim.
3. Keep both composers pure (no I/O); `instructionResource` and `stateResource` are fetched by the loop in Task 4 and passed in.

Verification:
- `npm run typecheck` passes.
- Given a sample `systemPrompt` containing both resource tags and non-empty `instructionResource`/`stateResource`, `buildSystemPrompt` returns a string where both tags are expanded with URI attributes.
- `buildUserTurn({ iteration: 0, extraInitialUserPrompt: "", ... })` contains the preamble but no `<specific instructions>` block; with `extraInitialUserPrompt: "do X"` it contains both.
- `buildUserTurn({ iteration: 5, followupUserPrompt: "continue" })` returns exactly `"continue"`.

Stop Condition:
- Both composers exist, are exported from `src/runtime/index.ts`, and behave per the verification cases.

---

### Task 2: `atom_request` and `atom_result` message helpers

Goal: Implement typed helpers for producing the two Coral message payloads defined in the spec, and a thin wrapper that sends them via the Coral MCP `coral_send_message` tool.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md` (Message Contract section)
- `src/runtime/coral-tools.ts`
- `src/runtime/tools.ts`

Allowed Write Scope:
- `src/runtime/messages.ts` (new file)

Out Of Scope:
- Loop integration (Task 4)
- Handoff routing logic — this plan only produces the payloads and sends them; it does not decide addressees

Steps:
1. Define Zod schemas for `AtomRequest` and `AtomResult` exactly matching the JSON shapes in the spec. Export both the schemas and the inferred TS types.
2. Export `sendAtomMessage(registry, payload, { threadId, mentions })` which locates the Coral `coral_send_message` tool in the registry, validates the payload against its Zod schema, and invokes the tool. Throw a clear error if `coral_send_message` is not present in the registry.
3. Export small builder helpers `atomRequest(partial)` and `atomResult(partial)` that fill `kind` automatically and let callers supply the rest.

Verification:
- `npm run typecheck` passes.
- A sanity check (inline, reverted before finishing) proves `sendAtomMessage` rejects a payload that fails schema validation without calling the Coral tool.

Stop Condition:
- Schemas, types, `sendAtomMessage`, and both builders are exported. Validation rejects malformed payloads before any network call.

---

### Task 3: Debug artifact writer

Goal: Emit per-iteration debug artifacts to a predictable path (`.coral-debug/<atomName>/<sessionId>/<iteration>.json`), excluded from git, with raw secrets redacted.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md` (Debugging Contract section)
- `.gitignore`
- `src/runtime/env.ts`

Allowed Write Scope:
- `src/runtime/debug.ts` (new file)
- `.gitignore`

Out Of Scope:
- Loop integration (Task 4)
- Any log-forwarding to external services

Steps:
1. Export `writeIterationArtifact({ atomName, sessionId, iteration, payload })` which serializes `payload` to JSON and writes to `.coral-debug/<atomName>/<sessionId>/<iteration>.json`. Create parent directories as needed.
2. Before writing, run `redactSecrets(payload)` which walks the object and replaces any string value matching known secret patterns (`sk-...`, `CORAL_AGENT_SECRET`, `MODEL_API_KEY` values pulled from env, Solana base58 private-key length > 80 chars) with `"[redacted]"`. The function takes `secretsFromEnv: string[]` so callers can pass the actual values to replace.
3. Add `.coral-debug/` to `.gitignore` if not already present.

Verification:
- `npm run typecheck` passes.
- Calling `writeIterationArtifact` with a payload containing one of the sampled secret values produces a file where that value is replaced with `[redacted]`.
- `.gitignore` contains `.coral-debug/`.

Stop Condition:
- Writer and redactor exist, the directory is gitignored, and redaction is verified end-to-end.

---

### Task 4: Integrate prompt, messages, and debug into the loop

Goal: Replace the plan-2 placeholders with real behaviour — the loop builds the system prompt each iteration, considers an `atom_result` send as the finalization signal, and writes an artifact per iteration.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md` (Core Loop, Prompt Contract, Message Contract, Debugging Contract)
- `src/runtime/loop.ts`
- `src/runtime/prompt.ts`
- `src/runtime/messages.ts`
- `src/runtime/debug.ts`

Allowed Write Scope:
- `src/runtime/loop.ts`
- `src/runtime/atom-template.ts` (only to pass a `capability` string through to the loop)

Out Of Scope:
- Any atom directory
- Plan-4+ concerns (Agent Kit adapter, real atoms, molecule composition)

Steps:
1. Extend `readCoralEnv` (in `src/runtime/env.ts`) to also read the four prompt options: `SYSTEM_PROMPT` (required), `EXTRA_SYSTEM_PROMPT` (default `""`), `EXTRA_INITIAL_USER_PROMPT` (default `""`), `FOLLOWUP_USER_PROMPT` (default: the Koog-default string from plan 1 Task 2).
2. In the loop body, on each iteration:
   - read `coral://instruction` and `coral://state` via `client.readResource`
   - call `buildSystemPrompt({ systemPrompt, extraSystemPrompt, instructionResource, stateResource })` and rewrite the system message at index 0 with the result (replaces plan 2 Task 3's raw-body placeholder)
   - call `buildUserTurn({ iteration: i, extraInitialUserPrompt, followupUserPrompt })` and append to conversation state as the user message for this turn (replaces plan 2 Task 3's placeholder initial-user string)
   - run the model turn exactly as plan 2 Task 3 specified (tool-choice required, maxSteps 1)
   - after the model turn, if any executed tool call was `coral_send_message` and the payload had `kind === "atom_result"`, mark the iteration as a finalization and break out of the loop
   - call `writeIterationArtifact(...)` with `{ iteration, systemPrompt, userTurn, instructionResource, stateResource, toolCalls, toolResults, finalized }`
3. Export a `CapabilityConfig` type (`{ atomName; tools? }`) and have `startAtom` accept it. Note: `capability` is no longer a runtime-injected string — the manifest author expresses capability through `SYSTEM_PROMPT`, matching Koog.

Verification:
- `npm run typecheck` passes.
- Running the dummy atom end-to-end: on a run that sends an `atom_result`, the loop terminates at that iteration; on a run without one, the loop terminates at `MAX_ITERATIONS`. Both produce one debug file per iteration under `.coral-debug/`.

Stop Condition:
- The loop prints a final summary line with `{ event: "atom-finalized" | "atom-budget-exhausted", iterations, finalizedAt }` and exits 0 on finalization, non-zero on budget exhaustion.
