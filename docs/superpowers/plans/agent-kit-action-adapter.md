# Agent Kit Action Adapter

Design Source: `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md`

Depends On:
- `docs/superpowers/plans/atom-template-runtime-loop.md` — the adapter produces `LocalTool` values consumed by the template's tool registry.
- `docs/superpowers/plans/atom-template-prompt-message-debug.md` — the normalized tool-result shape is what iteration debug artifacts capture.

Scope Summary: Build a generic adapter that takes a SendAI Agent Kit action/plugin registry and an atom's allowlist of action names, and returns a `LocalToolRegistry` in which each tool preserves the Agent Kit schema + description and normalizes results into the spec's `{ tool, status, data, warnings, source }` envelope. No atom-specific wiring — that is plan 5.

---

## Tasks

### Task 1: Introduce Agent Kit as a dependency and confirm the action surface

Goal: Add the SendAI Agent Kit package to the repo, import its action registry type for market-data plugins, and record which exports we will rely on.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md` (Action Adapter Contract, Risk Areas)
- `docs/decomposition/capability-atoms/agent-kit-market-data-atom-inventory.md`
- `package.json`
- `src/atoms/market-data.ts` (shows the action names the adapter must support: `GET_COINGECKO_*`, `PYTH_FETCH_PRICE`, `FETCH_ASSETS_BY_OWNER`)

Allowed Write Scope:
- `package.json`
- `src/agent-kit/types.ts` (new file — type aliases re-exported from Agent Kit for readability)

Out Of Scope:
- `src/agent-kit/index.ts` (adapter body is Task 2)
- Any atom or runtime change

Steps:
1. Install the appropriate Agent Kit packages (`solana-agent-kit`, `@solana-agent-kit/plugin-misc`, `@solana-agent-kit/plugin-token`) via `npm install`. Do not pin loosely — use caret on the latest stable.
2. In `src/agent-kit/types.ts` export `type AgentKitAction`, `type AgentKitActionRegistry`, and whatever result envelope type Agent Kit exposes. If Agent Kit uses `any` internally, declare a minimal structural type here (`{ name: string; description?: string; schema?: ZodSchema; handler: (input, agent) => Promise<unknown> }`) and note the source file/version inspected.
3. Add a short comment in `src/agent-kit/types.ts` listing the action names the adapter must handle (copied from `src/atoms/market-data.ts`) so Task 2 has a concrete target.

Verification:
- `npm install` succeeds.
- `npm run typecheck` passes.
- The listed action names appear verbatim in the types file comment.

Stop Condition:
- Packages installed, types file exists, typecheck clean. No adapter logic yet.

---

### Task 2: Implement the adapter

Goal: Produce `adaptAgentKitActions({ registry, allowlist, agent })` that returns a `LocalToolRegistry` selecting only the allowlisted actions and wrapping each in the runtime's tool format with schema preservation.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md` (Action Adapter Contract, Tool Result Contract)
- `src/agent-kit/types.ts` (from Task 1)
- `src/runtime/tools.ts` (for `LocalTool`, `LocalToolRegistry`, `buildLocalRegistry`)

Allowed Write Scope:
- `src/agent-kit/adapter.ts` (new file)
- `src/agent-kit/index.ts` (rewrite — the existing scaffold is intentionally superseded)

Out Of Scope:
- Any atom or molecule wiring
- Credential handling — that is Task 3
- Policy/risk gating beyond skipping disallowed names

Steps:
1. In `src/agent-kit/adapter.ts` export `adaptAgentKitActions({ registry, allowlist, agent }: AdaptParams): LocalToolRegistry`.
2. For each action name in `allowlist`: look it up in `registry`, skip with a `console.warn` if not found, and build a `LocalTool` whose `description` mirrors the action's description, whose `parameters` is the action's Zod schema (or `z.object({})` if the action has none), and whose `execute` calls the action's handler and normalizes the result into the envelope from Task 3 (stubbed here, implemented fully in Task 3).
3. For each adapted tool, rename the Coral-visible tool name to `agentkit.<action_name_lowercase>` to avoid collisions with Coral MCP tools and to make provenance obvious in logs.
4. Re-export the adapter from `src/agent-kit/index.ts`, dropping the previous placeholder types (`AgentKitAtomSelection`, `ActionFilterRule`) since they are not used anywhere in the codebase (verify via `grep -r` before removing).

Verification:
- `npm run typecheck` passes.
- `grep -r "AgentKitAtomSelection\|ActionFilterRule" src/ agents/ molecules/ scripts/` returns nothing after removal.
- A sanity exercise (inline, reverted before finishing): pass a fake registry with one action and an allowlist containing that action → receive a registry with exactly one `agentkit.<name>` entry.

Stop Condition:
- `adaptAgentKitActions` exists, rejects nothing silently except genuine not-found names (which it warns on), and produces a valid `LocalToolRegistry`.

---

### Task 3: Normalize Agent Kit results and redact errors

Goal: Wrap every adapted action's `execute` so the model sees the normalized `{ tool, status, data, warnings, source }` envelope, and so errors become structured failure payloads instead of raw throws.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md` (Tool Result Contract, Risk Areas — "API key handling can drift into .env-only behavior")
- `src/runtime/debug.ts` (for `redactSecrets` — reuse rather than duplicate)
- `src/agent-kit/adapter.ts` (from Task 2)

Allowed Write Scope:
- `src/agent-kit/adapter.ts`
- `src/agent-kit/envelope.ts` (new file — the envelope Zod schema and a single normalize helper)

Out Of Scope:
- Modifying Agent Kit itself
- Any atom wiring

Steps:
1. In `src/agent-kit/envelope.ts` export a `AgentKitResultEnvelope` Zod schema and a `normalizeAgentKitResult({ action, plugin, result })` helper that returns a success envelope.
2. In the adapter's `execute` wrapper, run the action's handler inside try/catch. On success → `normalizeAgentKitResult(...)`. On thrown error → return `{ tool, status: "error", data: {}, warnings: [errorMessage], source }`. Run the final envelope through `redactSecrets` with the configured secret list before returning.
3. `warnings` should also capture Agent Kit "soft" failures (e.g. an action that returns `{ ok: false, reason }`) — if the raw result has a `warnings` array or an `ok === false` shape, lift it into the envelope.

Verification:
- `npm run typecheck` passes.
- A sanity exercise proves: successful action → `status: "success"` envelope; throwing action → `status: "error"` envelope with the message in `warnings`; action returning `{ ok: false, reason }` → `status: "success"` envelope with the reason in `warnings`. Revert any scratch code before finishing.

Stop Condition:
- Every adapted tool returns a validated envelope and never throws out of `execute`. Secrets are scrubbed before the envelope is returned.
