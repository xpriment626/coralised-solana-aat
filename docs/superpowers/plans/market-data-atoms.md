# Market Data Atoms

Design Source: `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md`

Depends On:
- `docs/superpowers/plans/atom-template-prompt-message-debug.md` — atoms need the full template (runtime loop + prompt/message contract) before they can run.
- `docs/superpowers/plans/agent-kit-action-adapter.md` — atoms consume the adapter to pull in Agent Kit actions.

Scope Summary: Stand up the five market-data atoms from `src/atoms/market-data.ts` as real Coral-launchable agents: `market-trends`, `token-info`, `market-price`, `oracle-price`, `wallet-assets`. Each atom gets its own directory with `coral-agent.toml`, `index.ts`, `tools.ts`, and README. No molecule wiring, no signing atoms.

---

## Tasks

### Task 1: Shared atom bootstrap helper

Goal: Extract the copy-pasted wiring (`startAtom` call + adapter instantiation + manifest lookup) into one helper so each atom's `index.ts` is ~10 lines.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md` (Credentials And Options)
- `src/atoms/market-data.ts` (atom manifests already define purpose, actions, handoffs — reuse)
- `src/agent-kit/adapter.ts`
- `src/runtime/atom-template.ts`

Allowed Write Scope:
- `src/atoms/bootstrap.ts` (new file)

Out Of Scope:
- Any atom directory (next tasks)
- Runtime internals

Steps:
1. Export `bootstrapAtom({ atomName })`. The helper should:
   - locate the atom manifest in `marketDataAtoms` by `atomName` and throw if not found
   - build an Agent Kit agent using the credentials from env (RPC URL, CoinGecko API key, Helius key, etc.) — the Agent Kit constructor exact shape depends on the package; confirm via its README and wire the minimum required config
   - call `adaptAgentKitActions({ registry, allowlist: manifest.actions.map(a => a.actionName), agent })`
   - call `startAtom({ atomName, tools })` — no `capability` field is passed; the atom's capability text lives in its `coral-agent.toml` `SYSTEM_PROMPT` value, matching Koog
2. The helper must throw a single structured error listing all missing credentials if required keys are absent (mirror the pattern from `readCoralEnv`).

Verification:
- `npm run typecheck` passes.
- Calling `bootstrapAtom({ atomName: "bogus" })` throws a clear "unknown atom" error.

Stop Condition:
- `bootstrapAtom` exists, is exported from `src/atoms/index.ts`, and handles the five manifest names from `marketDataAtoms`.

---

### Task 2: Scaffold five atom directories

Goal: Create one directory per atom with four files each, all delegating to `bootstrapAtom`.

Context To Load:
- `src/atoms/market-data.ts` (each atom's purpose and action list drives its manifest options)
- `agents/dummy-atom/` (reference scaffold from plan 1)
- `src/atoms/bootstrap.ts` (from Task 1)

Allowed Write Scope:
- `agents/market-trends/coral-agent.toml`
- `agents/market-trends/index.ts`
- `agents/market-trends/tools.ts`
- `agents/market-trends/README.md` (exists — update only to reference this plan and the capability description)
- Same four files under each of: `agents/token-info/`, `agents/market-price/`, `agents/oracle-price/`, `agents/wallet-assets/`

Out Of Scope:
- `agents/market-intelligence/` (exists but is not in the atom set — leave untouched)
- `agents/dummy-atom/` (reference scaffold, do not modify here)
- Any runtime or adapter code

Steps:
1. For each of the five atoms:
   - `index.ts`: import `bootstrapAtom` and call it with the atom name. Nothing else.
   - `tools.ts`: placeholder — export nothing, or re-export from `src/atoms/market-data.ts` the matching manifest if convenient. The real tools come through the adapter at runtime; this file exists only so the atom directory shape matches plan 1's contract and a future maintainer sees where tools would go if an atom needed hand-written additions.
   - `coral-agent.toml`: copy the dummy-atom manifest and update `name`, `summary`, `description`, and the capability-specific options block. For atoms that need API keys (CoinGecko → `COINGECKO_API_KEY`, Helius for `wallet-assets` → `HELIUS_API_KEY`, Pyth-backed `oracle-price` typically needs no key), surface the keys as manifest options visible to Console. Author each atom's `SYSTEM_PROMPT` default to include: the atom's identity line (`You are solana-<atomName>, a capability atom focused on <purpose>`), the handoff hints from the manifest (`If the user's request is outside your capability, suggest handing off to one of: <handoffs>`), and the two resource tags verbatim. This mirrors Koog's default `SYSTEM_PROMPT` shape. Leave `EXTRA_INITIAL_USER_PROMPT` default empty and `FOLLOWUP_USER_PROMPT` at the Koog default string — the first milestone exercises the mention-driven path and does not need custom prompt orchestration.
   - `README.md`: update to one short paragraph describing the atom's capability, its Agent Kit actions, and its declared handoffs (copied from the manifest). Link to this plan and the agent-kit-compatibility spec.
2. Confirm each atom's allowed action list matches `src/atoms/market-data.ts` exactly — do not diverge.

Verification:
- `npm run typecheck` passes for all five atom `index.ts` files.
- `ls agents/<atom>/` for each atom lists the four expected files.
- Each `coral-agent.toml` parses as valid TOML.

Stop Condition:
- All five atoms have complete directory contents, each `index.ts` is a one-line delegation to `bootstrapAtom`, and each manifest surfaces its required credentials as options.

---

### Task 3: Live smoke test through Coral Console

Goal: Validate that at least one atom (`market-trends`) can be registered with a local Coral Server, added to a Console session, launched, and produces a single successful tool call that gets sent as an `atom_result`.

Context To Load:
- `docs/decomposition/capability-atoms/coral-console-composition-patterns.md`
- `agents/market-trends/coral-agent.toml`
- `agents/market-trends/index.ts`

Allowed Write Scope:
- `docs/decomposition/capability-atoms/market-trends-smoke-run.md` (new file — a decomposition-style run log capturing what happened, not a design change)

Out Of Scope:
- Any source or atom directory change — this task only runs the code produced in Tasks 1–2
- Wiring any molecule
- Changes to other atoms

Steps:
1. Start local Coral Server per `docs/decomposition/capability-atoms/coral-console-composition-patterns.md`. Point its agent discovery path at `agents/`.
2. Open the Console, create a one-agent session with `market-trends`, supply the required `COINGECKO_API_KEY` via the manifest option, and launch.
3. Send the agent a puppet message asking for current trending tokens.
4. Observe: connection, at least one `agentkit.*` tool call, one `atom_result` message in the thread, and clean process exit.
5. Write the run log to `docs/decomposition/capability-atoms/market-trends-smoke-run.md` using the decomposition-note template from CLAUDE.md. If any failure mode from the evaluation spec applies, tag it.

Verification:
- The run log exists and lists: what was observed, any failure modes encountered, and whether the atom sent an `atom_result` or only assistant text.

Stop Condition:
- One successful end-to-end Console run documented, OR a documented failure mode with a clear follow-up (which becomes an input to plan 8's evaluation work). Either outcome satisfies the task — the point is the observation, not forcing success.
