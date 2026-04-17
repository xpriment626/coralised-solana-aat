# Atom Template: Runtime Loop

Design Source: `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md`

Depends On:
- `docs/superpowers/plans/atom-template-manifest-and-environment.md` — provides `startAtom`, `readCoralEnv`, and the MCP client handshake that the loop sits inside.

Scope Summary: Extend the atom template with the bounded core loop: Coral MCP tool discovery, local tool registry merging, a no-op local tool for smoke tests, the model-turn body, tool-call execution, and termination conditions (iteration budget, failing-call threshold, finalization signal). Leaves prompt construction and message contracts to plan 3.

---

## Tasks

### Task 1: Introduce the local tool registry type and a smoke-test no-op tool

Goal: Define the local-tool shape the template will accept from atoms, and ship one built-in no-op tool (`atom.noop`) the dummy atom can call to prove the loop executes tools.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md` (sections: Tool Contract, Prompt Contract — only to understand tool registration, prompt composition is out of scope here)
- `src/runtime/atom-template.ts` (from previous plan)
- `src/atoms/manifest.ts`

Allowed Write Scope:
- `src/runtime/tools.ts` (new file)

Out Of Scope:
- `src/runtime/atom-template.ts` (modified in Task 3, not here)
- Any Agent Kit action adaptation — that is plan 4
- Any atom directory

Steps:
1. In `src/runtime/tools.ts` export a `LocalTool` type matching the Vercel AI SDK `tool()` shape (description, Zod `parameters`, `execute`), plus a `LocalToolRegistry = Record<string, LocalTool>`.
2. Export a `noopTool` registered under the name `atom.noop` whose parameters are `z.object({ echo: z.string().default("ping") })` and whose execute returns `{ status: "ok", echo }`.
3. Export a `buildLocalRegistry(tools: LocalToolRegistry)` helper that returns a frozen copy and rejects names containing characters outside `[a-z0-9_.-]` (to keep names Coral-safe).

Verification:
- `npm run typecheck` passes.
- A unit-level sanity check (script under `scripts/` is fine, do not add a test framework) constructs a registry with `noopTool`, calls `buildLocalRegistry`, and asserts the registry rejects a tool named `"bad name"`.

Stop Condition:
- `LocalTool`, `LocalToolRegistry`, `noopTool`, and `buildLocalRegistry` are exported and typecheck. The sanity script (if added) is removed before finishing unless the plan explicitly asks for it — in this case do not commit a script.

---

### Task 2: Implement Coral tool discovery and merged registry

Goal: After MCP connection succeeds, list the Coral MCP tools, wrap each in the same `LocalTool` shape for uniform dispatch, merge with the atom's local registry, and reject local tool names that collide with Coral tool names.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md` (Tool Contract section)
- `src/runtime/atom-template.ts`
- `src/runtime/tools.ts` (from Task 1)
- `@modelcontextprotocol/sdk` client listTools API (check the installed version in `node_modules/@modelcontextprotocol/sdk/package.json`)

Allowed Write Scope:
- `src/runtime/coral-tools.ts` (new file)
- `src/runtime/tools.ts` (extend only to add `mergeRegistries` helper)

Out Of Scope:
- `src/runtime/atom-template.ts` (wiring happens in Task 3)
- Guardrails and loop body

Steps:
1. In `src/runtime/coral-tools.ts` export `discoverCoralTools(client)` which calls `client.listTools()` and returns a `LocalToolRegistry` whose `execute` wraps `client.callTool({ name, arguments })` and returns the raw MCP result.
2. In `src/runtime/tools.ts` add `mergeRegistries(local, coral)` which throws when a local name collides with a Coral name (Coral wins on the thrown error message to make the contract explicit) and returns a merged frozen registry.

Verification:
- `npm run typecheck` passes.
- `discoverCoralTools` function shape matches `(client: MCPClient) => Promise<LocalToolRegistry>`.

Stop Condition:
- Both helpers exist, typecheck, and are exported from `src/runtime/index.ts`.

---

### Task 3: Wire the core loop into `startAtom`

Goal: Replace the connect-and-exit body of `startAtom` with the bounded iteration loop from the design spec: discover Coral tools, merge with atom tools, iterate up to `MAX_ITERATIONS`, issue tool-choice-constrained model calls via the Vercel AI SDK, execute tool calls, append results, and honor the termination conditions.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md` (sections: Core Loop, Tool Contract, Risks — particularly "Vercel AI SDK may not provide a direct equivalent to `requestLLMOnlyCallingTools`")
- `src/runtime/atom-template.ts`
- `src/runtime/tools.ts`
- `src/runtime/coral-tools.ts`
- `src/runtime/env.ts`
- Vercel AI SDK docs: `generateText` tool-calling reference → https://sdk.vercel.ai/docs/reference/ai-sdk-core/generate-text
- Vercel AI SDK docs: `toolChoice` and `maxSteps` → https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling
- Confirm installed version before coding: `node_modules/ai/package.json`. If the installed version lags the docs, fall back to `cat node_modules/ai/dist/index.d.ts` for the authoritative local API.

Allowed Write Scope:
- `src/runtime/atom-template.ts`
- `src/runtime/loop.ts` (new file — body of the loop extracted for readability)

Out Of Scope:
- Prompt construction (plan 3)
- `atom_request` / `atom_result` message shape (plan 3)
- Debug artifact writing (plan 3)
- Any change to `agents/dummy-atom/`

Steps:
1. Extend `startAtom` to accept a `config: { atomName: string; tools?: LocalToolRegistry }` parameter. Default `tools` to `{ "atom.noop": noopTool }`.
2. After the MCP connect, call `discoverCoralTools(client)` and then `mergeRegistries(tools, coralTools)`.
3. In `src/runtime/loop.ts` export `runLoop({ client, registry, env, atomName })`. Its body should mirror the Koog loop in `coral-koog-agent/src/main/kotlin/.../fullexample/Main.kt`:
   - initialize conversation state with a system message slot at index 0 (will be rewritten each iteration) and an empty tail
   - for `i` in `0..MAX_ITERATIONS`:
     - refresh `coral://instruction` and `coral://state` via `client.readResource`, expand the `<resource>...</resource>` tags inside `SYSTEM_PROMPT`, and rewrite the system message at index 0 with the result (full prompt composition body is plan 3 Task 1 — here, just append raw text bodies as a placeholder; plan 3 replaces the composition)
     - construct the user message for this turn: on `i === 0` use a placeholder initial-user string, on `i > 0` use `FOLLOWUP_USER_PROMPT` verbatim. Plan 3 Task 1 replaces the initial-user placeholder with the Koog-parity `buildInitialUserMessage` composer. Append this user message to the conversation state.
     - call `generateText` from `ai` with `messages: state`, `tools: registry`, `toolChoice: "required"`, `maxSteps: 1` (single tool-call step per iteration — parity with Koog's `requestLLMOnlyCallingTools`)
     - execute any returned tool calls through `registry[name].execute(args)` and append assistant + tool messages to state
     - if the same tool has failed three times in a row, throw a `ToolFailureBudgetExceeded` error
     - sleep `ITERATION_DELAY_MS` if set

   Finalization is out of scope for this plan — plan 3 Task 4 adds the `atom_result` send as the stop signal. For now the loop terminates at `MAX_ITERATIONS` or on the failure-budget throw.
4. Wrap the loop in try/finally that closes the MCP client and exits 0 on clean completion, 1 on thrown errors.

Verification:
- `npm run typecheck` passes.
- Running `agents/dummy-atom/index.ts` against a local Coral Server (or a mock MCP server if Coral is not available — flag this in the run log) completes within `MAX_ITERATIONS` and exits 0.
- Forcing `atom.noop` to throw (temporary local edit, reverted before finishing) produces a `ToolFailureBudgetExceeded` error after three failures and exits 1.

Stop Condition:
- `startAtom` runs the loop, respects `MAX_ITERATIONS`, honors the failure-budget guardrail, and exits cleanly. The quiet-turn finalization is a placeholder — plan 3 will replace it with an `atom_result` send.
