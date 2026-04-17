# Failure Mode Taxonomy

## Context

Reference copy of the failure-mode taxonomy defined in
`docs/superpowers/specs/2026-04-17-capability-atoms-evaluation-failure-modes-design.md`.
Pulled out into a standalone note so decomposition notes and run logs can
cite these labels without having to link the whole design spec.

The taxonomy is authoritative. New labels should originate in the spec
or a new decomposition note proposing an addition; run logs should not
invent labels silently.

## Observations

The labels below are copied verbatim from the evaluation spec's
"Failure Mode Taxonomy" section. Definitions are one-line summaries; for
nuance consult the spec.

- `runtime_connection_failure` — agent does not connect to Coral MCP.
- `resource_refresh_failure` — agent does not consume Coral instruction/state resources.
- `tool_non_execution` — agent describes actions instead of calling tools.
- `message_non_execution` — agent writes assistant text but does not send Coral messages.
- `handoff_missing` — expected handoff does not occur.
- `handoff_context_loss` — handoff occurs but loses task/input context.
- `handoff_loop` — agents repeatedly mention or ask each other without progress.
- `boundary_violation` — atom calls or requests work outside its capability.
- `hidden_orchestration` — harness/runtime performs domain sequencing that should be agent-visible.
- `console_incompatibility` — run cannot be launched or inspected through Console.
- `single_agent_dominance` — conventional single-agent tool caller clearly performs better on relevant axes.

## Open Questions

- `handoff_context_loss` and `handoff_missing` both describe handoff
  failures; is the partial-context case (A mentions B but passes only half
  the expected fields) its own label or just a weaker `handoff_context_loss`?
- `boundary_violation` could plausibly split into "atom called an
  out-of-scope tool" vs "atom requested an out-of-scope handoff"; revisit
  if the first pairwise run observations make the distinction load-bearing.
- `single_agent_dominance` is a comparative label that only becomes
  applicable after the baseline comparison gate (per the spec). Leave as-is
  for now.

## Hypotheses

(Empty — this note is pure reference. Hypotheses belong in per-run notes
that cite these labels.)

## Links

- Governing spec: `docs/superpowers/specs/2026-04-17-capability-atoms-evaluation-failure-modes-design.md`
- First decomposition notes using this taxonomy:
  `docs/decomposition/capability-atoms/market-trends-smoke-run.md`,
  `docs/decomposition/capability-atoms/pairwise-first-run.md`
