# Fixture 01 — atoms-runtime receive seed

**Source:** `.worktrees/atoms-runtime` (branch `atoms-runtime`, commit `ea3df49`), Coral session `cd34fd31-7067-473c-b799-ab68e1138e41` from 2026-04-17 12:11:57Z.

**Status:** packaged from existing artifacts on 2026-04-18. No fresh server run was required — the receive-path evidence is already captured in the Gen 2 debug iters and RunArtifact.

## What this fixture asserts

The Gen 2 runtime delivers the puppet seed `atom_request` to the addressed atom **via the initial system prompt**, not via the `coral_wait_for_message` MCP tool. Specifically:

1. When `trends` (the addressed atom) starts its first iteration, its system prompt contains a `<resource uri="coral://state">…</resource>` block. That block embeds the open thread (`pairwise-smoke`) and the puppet's seed message, including its `mentionAgentNames: ["trends"]`. See `trends-iter-0.json` field `stateResource`.
2. `trends` reacts to the seed in the same first iteration, choosing `agentkit_get_coingecko_trending_tokens_action` as its first tool call. No `coral_wait_for_message` is required for `trends` to discover the seed. See `trends-iter-0.json` field `toolCalls`.
3. When `info` (a peer atom not addressed by the seed) starts its first iteration, its system prompt contains the **same** `coral://state` resource — including the same thread + seed message — but the seed's mentions do not include `info`. See `info-iter-0.json` field `stateResource`.
4. `info` consequently chooses `coral_wait_for_message({ currentUnixTime, maxWaitMs: 5 })` as its first action — correct behavior for an atom that has nothing addressed to it. See `info-iter-0.json` field `toolCalls`.

## What this fixture does NOT cover

- **Successful send.** The Gen 2 runtime never calls `coral_send_message` from either atom — that's the failure mode this generation was diagnosed with. `trends` loops on Agent Kit calls without finalizing; `info` loops on `coral_wait_for_message` waiting for a handoff that never arrives. This fixture is intentionally scoped to receive only. Send is fixture-2's job (compliance-demo Kotlin trace).
- **Successful mid-flight receive via wait tool.** Because `trends` never sends, `info`'s `coral_wait_for_message` calls all time out, so this fixture does not show what a successful resolution of `coral_wait_for_message` looks like over the wire. Also fixture-2's job.
- **Coral Server log lines.** Server logs from the original 2026-04-17 run were not preserved (Gradle stdout, not file-rotated). If we need them later, we re-capture from a fresh atoms-runtime run.

## The contract any future TS runtime must satisfy (from this fixture)

A new pi-mono (or other) atom implementation passes this fixture if:

1. **The agent's first iteration sees the puppet seed in its initial system prompt** under a `coral://state` resource block, with the thread it belongs to and the message's mentions intact.
2. **The atom addressed in `mentions` reacts on iteration 0** — picks an appropriate first tool call based on the seed content (for `trends` + the seed in `puppet-seed.json`, that's an Agent Kit market-discovery call). Does **not** call `coral_wait_for_message` first.
3. **The peer atom not in `mentions`** does not react on iteration 0 (no Agent Kit calls); it correctly enters a wait state.

These three predicates are what pi-mono attempt 1 violated. See `docs/decomposition/ts-coral-framework/pi-mono-pairwise-first-run.md`.

## Files in this fixture

| File | What it is |
|---|---|
| `puppet-seed.json` | The clean atom_request envelope the puppet posts to the thread. Extracted from the molecule definition; equivalent to `runartifact.json` field `task.seed`. |
| `trends-iter-0.json` | Verbatim debug-iter-0 from `market-trends` for session `cd34fd31`. Shows seed delivery via state resource + immediate Agent Kit reaction. The `stateResource` field is the key evidence. |
| `info-iter-0.json` | Verbatim debug-iter-0 from `token-info` for session `cd34fd31`. Shows the same seed visible in state resource, peer atom waits correctly. |
| `runartifact.json` | Verbatim RunArtifact for session `cd34fd31`. Aggregate view: 25 trends tool calls, 20 info `coral_wait_for_message` calls, no `coral_send_message`, failure_modes `[message_non_execution, handoff_missing]`. Receive worked; send didn't. |

## Mechanism notes (what the Gen 2 runtime actually does)

The receive mechanism is implemented in the Gen 2 runtime's resource expansion pass. Pseudocode of the contract:

```
on atom start:
  state = coral.fetchAgentState(agentId, sessionId)
  systemPrompt = atom.systemPrompt + expand(<resource uri="coral://instruction">) + expand(<resource uri="coral://state">{state})
  agent.start(systemPrompt, ...)
```

Where `state` includes `threadsAndMessages` — every open thread the agent participates in, plus all messages in those threads (including any seed posted before atom start). This is the bytes the model sees on iteration 0.

Pi-mono attempt 1 broke this contract by relying on the model to call `coral_wait_for_message` to discover messages, instead of pre-loading the state resource into the system prompt.

## How to use this fixture

When implementing or reviewing a future runtime:

1. Replicate the molecule + seed: same atoms, same puppet seed envelope.
2. After the atom's first iteration, capture the equivalent of `iter-0.json` (system prompt + first tool call).
3. Diff against `trends-iter-0.json` and `info-iter-0.json`. The `stateResource` field must contain the seed message; the first `toolCalls` entry must match the per-atom expectation in "The contract" section above.
4. Failure to satisfy any of the three predicates blocks the runtime from advancing to fixture-2.
