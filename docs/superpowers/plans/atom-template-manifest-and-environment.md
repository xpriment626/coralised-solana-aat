# Atom Template: Manifest and Environment

Design Source: `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md`

Depends On:
- none — this is the foundational plan; it establishes the executable-process shape for a single atom agent.

Scope Summary: Produce the minimum executable atom template: a discoverable `coral-agent.toml`, a TypeScript entry point that reads Coral runtime environment variables, fails fast with legible logs on missing config, connects to Coral MCP, and exits cleanly. No loop, no tool calls, no message sending — those belong to plan 2 and 3.

---

## Tasks

### Task 1: Define the atom template directory shape

Goal: Establish one concrete atom directory layout that all later atoms will copy, with a dummy atom (`dummy-atom`) used only for scaffold validation.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md`
- `src/atoms/manifest.ts`
- `agents/market-trends/README.md`
- `package.json`

Allowed Write Scope:
- `agents/dummy-atom/` (new directory)
- `agents/dummy-atom/README.md`
- `agents/dummy-atom/coral-agent.toml`
- `agents/dummy-atom/index.ts`

Out Of Scope:
- `agents/market-trends/` or any other real atom directory
- `src/` runtime code (belongs to Task 3 and plan 2)
- Changes to `package.json` or dependencies

Steps:
1. Create `agents/dummy-atom/` with a `README.md` that states this directory is the reference scaffold for the atom template, references this plan file, and lists the four required files: `README.md`, `coral-agent.toml`, `index.ts`, and (placeholder) `tools.ts` to be added in plan 2.
2. Create `agents/dummy-atom/index.ts` as a stub: it should only `import { startAtom } from "../../src/runtime/atom-template.js"` (file will be produced in Task 3) and call `startAtom({ atomName: "dummy-atom" })`. Do not implement `startAtom` in this task.
3. Create `agents/dummy-atom/coral-agent.toml` with the manifest fields from Task 2 populated with dummy values suitable for Console smoke testing.

Verification:
- `ls agents/dummy-atom` shows `README.md`, `coral-agent.toml`, `index.ts`.
- `cat agents/dummy-atom/index.ts` shows a single import + single call, no logic.

Stop Condition:
- The three files exist and match the shapes defined in Tasks 2 and 3. TypeScript will not yet compile because `src/runtime/atom-template.ts` does not exist — that is expected at this stage.

---

### Task 2: Author the `coral-agent.toml` contract for atoms

Goal: Produce a commented reference `coral-agent.toml` that captures every manifest field the design spec requires, with Console-visible options surfaced and environment-only values flagged.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md` (sections: Agent Manifest Contract, Runtime Environment Contract, Console Compatibility)
- `docs/decomposition/capability-atoms/coral-console-composition-patterns.md`
- `agents/dummy-atom/coral-agent.toml` (from Task 1, currently placeholder)
- Canonical reference manifest: https://github.com/Coral-Protocol/coral-koog-agent/blob/main/coral-agent.toml — use this as the structural template (fields, section layout, option typing conventions like `type = "u32"`, `display.description`, `secret = true`). Diverge only where the atom is a TypeScript process (`[runtimes.executable]` path/arguments should invoke `tsx` on the atom's `index.ts`, not `./gradlew`).

Allowed Write Scope:
- `agents/dummy-atom/coral-agent.toml`

Out Of Scope:
- Any other agent directory
- Runtime code
- Rewriting the manifest format itself — use whatever Coral Server expects; this plan does not redesign the format

Steps:
1. Populate the `coral-agent.toml` with the required manifest fields from the spec: `name`, `version`, `summary`, `description`, `executable runtime path + args` (use `tsx` on `index.ts`), and these options — match the Koog manifest shape:
   - Runtime budget: `MAX_ITERATIONS`, `ITERATION_DELAY_MS`, `MAX_TOKENS`
   - Model config: `MODEL_PROVIDER`, `MODEL_PROVIDER_URL_OVERRIDE`, `MODEL_API_KEY` (`secret = true`), `MODEL_ID`
   - **Prompt surface (Koog-parity — all four, even though the first milestone only uses defaults):**
     - `SYSTEM_PROMPT` — base system prompt, includes the `<resource>coral://instruction</resource>` and `<resource>coral://state</resource>` tags that the runtime expands each iteration
     - `EXTRA_SYSTEM_PROMPT` — additive system-prompt tweak, appended after `SYSTEM_PROMPT`
     - `EXTRA_INITIAL_USER_PROMPT` — task-specific instructions wrapped into the turn-0 user message only
     - `FOLLOWUP_USER_PROMPT` — the user message sent on every iteration after the first; default `"[automated message] Continue fulfilling your responsibilities collaboratively to the best of your ability."`
2. Mark capability-specific options as a commented example block (since the dummy atom has no capability) and note that real atoms in plan 5 will replace this block.
3. Add inline comments distinguishing values that Console must render or override (runtime options) from values that may come from the process environment (Coral connection variables). Also note next to each prompt option which loop position it drives (system-every-iteration vs user-turn-0 vs user-turn-1+) so a future manifest author doesn't have to read the runtime code to understand the knob.

Verification:
- The file parses as valid TOML (use `npx --yes @iarna/toml-cli parse agents/dummy-atom/coral-agent.toml` or equivalent; if no tooling is available, a round-trip through `node -e "require('@iarna/toml').parse(fs.readFileSync('...'))"` works once `@iarna/toml` is installed, otherwise defer to manual review).
- Every option named in the spec's Agent Manifest Contract section appears in the file.

Stop Condition:
- TOML parses cleanly and every spec-required option is present with a comment explaining its role.

---

### Task 3: Implement `startAtom` bootstrap — environment read + Coral MCP connect + clean exit

Goal: Produce `src/runtime/atom-template.ts` exporting `startAtom(config)`, which reads Coral runtime environment variables, fails fast with a structured log if any required variable is missing, opens an MCP connection to Coral Server, logs a successful handshake, and exits cleanly. No loop, no tool invocation.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md` (sections: Runtime Environment Contract, Core Loop up to "connect to Coral MCP / discover Coral tools" — only the connect step is in scope here)
- `src/runtime/coral-runtime.ts` (existing scaffold — will be replaced or supplemented)
- `package.json` (to confirm `@modelcontextprotocol/sdk` is already a dependency)

Allowed Write Scope:
- `src/runtime/atom-template.ts` (new file)
- `src/runtime/env.ts` (new file — env var reader and validator)
- `src/runtime/index.ts` (add exports)

Out Of Scope:
- `src/runtime/coral-runtime.ts` — leave the existing scaffold untouched; it is superseded by plan 2, not this plan
- Tool discovery, loop body, prompt construction, message sending
- Any logic that runs after the successful handshake; exit with code 0 immediately after logging the connection

Steps:
1. Create `src/runtime/env.ts` exporting `readCoralEnv()` which returns a typed object with `CORAL_CONNECTION_URL`, `CORAL_AGENT_ID`, `CORAL_AGENT_SECRET`, `CORAL_SESSION_ID`, `CORAL_API_URL`, `CORAL_RUNTIME_ID`, and optional `CORAL_PROMPT_SYSTEM`. On missing required values it should throw a single structured `Error` listing every missing variable (not one per variable).
2. Create `src/runtime/atom-template.ts` exporting `startAtom(config: { atomName: string })`. The function should call `readCoralEnv()`, construct an MCP client from `@modelcontextprotocol/sdk`, connect to the Coral server URL, log a single-line JSON record with `{ event: "connected", atom: config.atomName, sessionId, runtimeId }`, close the client, and `process.exit(0)`.
3. Add `export * from "./atom-template.js"` and `export * from "./env.js"` to `src/runtime/index.ts`.

Verification:
- `npm run typecheck` passes.
- Running `agents/dummy-atom/index.ts` via `tsx` with all required env vars set connects, logs the `connected` event, and exits 0.
- Running it with one env var missing exits non-zero and the error message names every missing variable.

Stop Condition:
- Both run modes (success and missing-env) behave as described above; no other runtime code is written.

---

### Task 4: Document the template handoff to plan 2

Goal: Add a one-line note to `agents/dummy-atom/README.md` pointing at plan 2, so the next agent that loads this scaffold knows where the loop body comes from.

Context To Load:
- `agents/dummy-atom/README.md`

Allowed Write Scope:
- `agents/dummy-atom/README.md`

Out Of Scope:
- Any source file
- Any other README

Steps:
1. Add a `Next` section at the bottom of the README with one bullet: `- Plan 2 (atom-template-runtime-loop) extends startAtom with the Coral MCP tool registry, model loop, and termination conditions.`

Verification:
- The README ends with the new `Next` section.

Stop Condition:
- The note is present. No other changes.
