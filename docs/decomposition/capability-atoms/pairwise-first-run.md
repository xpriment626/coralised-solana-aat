# pairwise-first-run

## Context

First end-to-end run of the `market-signal-pairwise` molecule (per
`docs/superpowers/plans/molecule-first-pairwise-test.md`). Two atoms
(`trends` = market-trends, `info` = token-info) plus a `puppet` seed.
Launched from the atoms-runtime worktree through Coral Server at
`http://localhost:5555`. Session id
`cd34fd31-7067-473c-b799-ab68e1138e41` (and earlier runs
`918d...`, `fae9...`, `93ee...`, used while fixing schema incompatibilities).

## Observations

### Flow

1. Coral Server accepted the compiled `SessionRequest` and launched both
   atoms via the `executable` runtime (`npx --yes tsx index.ts`).
2. Both atoms opened MCP connections over `streamable_http` within ~2s of
   launch and emitted `{event:"connected", ...}` in their stdout logs.
3. Puppet seed was posted into the `pairwise-smoke` thread, mentioning
   `trends`.
4. Neither atom sent a single message into the thread across 20
   iterations. Both atoms exited with `atom-budget-exhausted`.
5. Only thread message ever observed: the puppet seed.

### Tool-call breakdown (from .coral-runs artifact, 46 calls total)

| agent  | tool                                             | count |
|--------|--------------------------------------------------|-------|
| trends | agentkit_get_coingecko_trending_tokens_action    | 8     |
| trends | agentkit_get_coingecko_trending_pools_action     | 6     |
| trends | agentkit_get_coingecko_top_gainers               | 6     |
| trends | agentkit_get_coingecko_latest_pools              | 6     |
| info   | coral_wait_for_message                           | 20    |

trends never called `coral_send_message`. info never called anything
except `coral_wait_for_message`, which timed out every iteration because
nothing was ever sent.

### Failure mode classification

The harness tagged:

- `message_non_execution` — both atoms failed to send Coral messages,
  so no inter-agent visibility.
- `handoff_missing` — trends never sent an `atom_result`; info never
  received a handoff.

No `tool_non_execution` — both atoms did call tools; that failure mode
is correctly absent.

### Upstream issues discovered and patched during debugging

These were blockers exposed by the first real runs. Each landed as a
small fix in the worktree:

1. **Manifest fields `readme` and `[agent.license]` are required**
   (Coral `UnresolvedRegistryAgentInfo.kt`). All six atom manifests
   (5 market-data + dummy) now include both.
2. **Manifest `transport` must be `sse` or `streamable_http`**, not
   `stdio` (Coral `McpTransportType.kt`). Flipped to `streamable_http`.
3. **Coral MCP tool schemas contain Kotlin Long bounds** (default
   `System.currentTimeMillis()` serializes with `maximum = Long.MAX_VALUE`),
   which OpenAI rejects as "numeric value … too large". `src/runtime/coral-tools.ts`
   now strips `maximum`/`minimum` bounds that exceed `Number.MAX_SAFE_INTEGER`.
4. **Tool names must match OpenAI's `^[a-zA-Z0-9_-]+$`** — dots are
   rejected. Renamed `agentkit.<action>` → `agentkit_<action>` and
   `atom.noop` → `atom_noop`.
5. **Harness debug-dir resolution** — atoms write to `agents/<name>/.coral-debug/`
   because their cwd is the atom directory. Harness now checks both
   `./.coral-debug/<name>/` and `agents/<name>/.coral-debug/<name>/`.
6. **Harness atom-name mapping** — needed both registry name
   (match debug dir) and session name (appear in artifact/thread).
   Signature changed to `atoms: Array<{registryName, sessionName}>`.

### Session-level smoke signals (all passing)

- agent discovery: five atoms registered after config pointed at worktree
  `agents/` paths.
- session creation, puppet thread creation, puppet seed message all
  work via REST.
- MCP connection + tool discovery + initial model call + tool execution
  + debug artifact write: all work.
- Coral API option-passing delivers secrets to the atom process (verified
  the `***` masked log line for `MODEL_API_KEY` and `COINGECKO_API_KEY`).

## Open Questions

- The trends prompt tells the model to use `coral_send_message` for
  inter-agent comms, but the model is greedy on data tools. Does the
  prompt need a stronger "after at most N data fetches, emit an
  atom_result" rule, or should the runtime itself intervene (e.g. switch
  `toolChoice` to `"auto"` plus a stop-if-no-message-sent-by-turn-N
  guard)?
- info waits forever. Should atoms default to short `maxWaitMs` on
  `coral_wait_for_message`, or should the runtime limit budget more
  aggressively when the only tool call is a wait?
- CoinGecko API returned `error_code: 10011` (rate limit) on the first
  call. Agent Kit wrapped it as `status: "success"` with the error body
  inside `data`, so the runtime didn't see a failure and kept retrying.
  The envelope classifier could upgrade `error_code` present inside
  `data` to a warning, but that risks over-eager classification.

## Hypotheses

- The next prompt-surface iteration should pivot atoms from "do what
  you can" to an explicit mini state machine: on mention → read state
  → run capability → send result → wait. With `toolChoice: "required"`,
  the model always calls *some* tool, so a state machine encoded in
  the prompt has a realistic shot at steering it toward messaging.
- Keeping `toolChoice: "required"` but shortening the atom's allowed
  tool surface on follow-up turns (e.g. after one successful data
  fetch, drop agentkit tools and leave only coral tools) would
  force messaging without new prompt engineering.

## Links

- Plan: `docs/superpowers/plans/molecule-first-pairwise-test.md`
- Spec: `docs/superpowers/specs/2026-04-17-capability-atoms-molecule-composition-runtime-design.md`
- Failure-mode taxonomy: `docs/decomposition/capability-atoms/failure-mode-taxonomy.md`
- Seed runner: `scripts/run-pairwise.ts`
- Run artifact: `.coral-runs/market-signal-pairwise-cd34fd31-7067-473c-b799-ab68e1138e41.json`
- Per-iteration debug artifacts: `agents/market-trends/.coral-debug/market-trends/cd34fd31-.../`, `agents/token-info/.coral-debug/token-info/cd34fd31-.../`
- Coral Server config (now includes worktree paths):
  `/Users/bambozlor/Desktop/product-lab/coral-server/config.toml`
