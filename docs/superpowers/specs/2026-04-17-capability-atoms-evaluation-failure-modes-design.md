# Capability Atoms: Evaluation And Failure Modes Design

**Date:** 2026-04-17
**Status:** Draft
**Scope:** Define how the capability-atoms experiment will judge success, failure, and tradeoffs against conventional single-agent tool calling.

---

## Decomposition Index

This design is grounded in the following decomposition notes:

- `docs/decomposition/capability-atoms/README.md` — experiment hypothesis, first molecule, and current success/failure signals.
- `docs/decomposition/capability-atoms/coral-koog-runtime-patterns.md` — runtime failure modes and Koog parity target.
- `docs/decomposition/capability-atoms/coral-console-composition-patterns.md` — Console observability and composition requirements.
- `docs/decomposition/capability-atoms/implementation-options.md` — sequencing considerations for implementation.
- `docs/debugging-logs/postmortem-skills-first-architecture.md` — historical failure mode to avoid repeating.

Related design specs:

- `2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md`
- `2026-04-17-capability-atoms-agent-kit-compatibility-design.md`
- `2026-04-17-capability-atoms-molecule-composition-runtime-design.md`

## Plan Index

Island plans executing this spec:

- `docs/superpowers/plans/evaluation-artifacts-and-observability.md` — failure-mode taxonomy published as a decomposition-note reference, `RunArtifact` schema + writer, harness that derives artifacts from atom debug logs + Coral thread messages. Baseline comparison is explicitly deferred per this spec.

## Problem

The experiment can fail in subtle ways. A demo may appear to work because a harness, seed agent, prompt, or hidden runtime helper quietly performed orchestration that should have belonged to the atoms. Conversely, the atom pattern may fail operationally while still producing useful information about Coral's design boundaries.

The evaluation design must make failure legible. The goal is not to force the atom/molecule thesis to win. The goal is to determine when it works, when it collapses into a conventional single agent, and what support Coral agents need to make the pattern viable.

## Goals

1. Define success and failure criteria for single atoms, pairwise tests, and molecule tests.
2. Distinguish atom-driven handoff from harness-driven orchestration.
3. Preserve Console-visible evidence for internal review.
4. Compare atom/molecule behavior against a conventional single-agent baseline at the right time.
5. Produce reusable failure-mode documentation for future Coral patterns.

## Non-Goals

- Do not create implementation plans in this spec.
- Do not define production SLOs.
- Do not require quantitative benchmarks before the first vertical slice.
- Do not evaluate signing/transaction workflows until read-only market-data atoms are stable.

## Evaluation Levels

### Level 1: Single Atom

Question:

```text
Can one atom run as a Coral agent and use its own tools?
```

Evidence:

- Console launch succeeds.
- Coral MCP connection succeeds.
- `coral://instruction` and `coral://state` are consumed.
- Local tool call succeeds.
- Coral message send succeeds.
- Debug trace explains each iteration.

Failure examples:

- agent starts but never connects
- agent talks about tools instead of calling them
- agent cannot send a structured Coral message
- agent only works through a local harness

### Level 2: Pairwise Atom Test

Question:

```text
Can one atom hand off useful work to another atom through Coral?
```

Evidence:

- seed message is visible in a thread
- first atom calls its own tools
- first atom sends structured result with handoff
- second atom receives or observes the handoff
- second atom calls its own tools
- second atom sends structured result
- harness records but does not perform domain work

Failure examples:

- first atom returns final answer without handoff when handoff is required
- second atom never notices the handoff
- handoff loses task ID or required context
- agents loop mentions without progress
- harness has to directly invoke the second atom's domain work

### Level 3: Molecule Test

Question:

```text
Can multiple atoms produce a useful workflow result without a hidden central coordinator?
```

Evidence:

- molecule launches from a Console-compatible template
- all required atoms are visible and configured
- groups match intended communication topology
- intermediate thread messages are inspectable
- final result references intermediate atom outputs
- failures are reported as structured partial/error results

Failure examples:

- one atom effectively becomes the coordinator for all domain work
- every successful run requires deterministic handoff code outside agents
- latency/cost grows beyond practical limits
- result quality is worse than single-agent baseline without compensating composability benefits

## Console Evidence Requirement

Every evaluated run should prefer Console-visible artifacts:

- session graph
- agent status
- thread creation
- messages
- mentions
- wait behavior when visible
- runtime stop/exit state

Local artifacts are supporting evidence:

- prompt traces
- tool call traces
- normalized tool results
- harness observations
- failure classification

An experiment that cannot be reconstructed from Console-visible session state should be marked as incomplete for demo readiness.

## Failure Mode Taxonomy

Use these labels in run notes:

- `runtime_connection_failure`: agent does not connect to Coral MCP.
- `resource_refresh_failure`: agent does not consume Coral instruction/state resources.
- `tool_non_execution`: agent describes actions instead of calling tools.
- `message_non_execution`: agent writes assistant text but does not send Coral messages.
- `handoff_missing`: expected handoff does not occur.
- `handoff_context_loss`: handoff occurs but loses task/input context.
- `handoff_loop`: agents repeatedly mention or ask each other without progress.
- `boundary_violation`: atom calls or requests work outside its capability.
- `hidden_orchestration`: harness/runtime performs domain sequencing that should be agent-visible.
- `console_incompatibility`: run cannot be launched or inspected through Console.
- `single_agent_dominance`: conventional single-agent tool caller clearly performs better on relevant axes.

## Baseline Comparison

Do not compare against a conventional single-agent baseline before the atom pattern has had a fair implementation.

Baseline comparison becomes useful after:

- the TS single-agent template reaches Koog parity for one atom
- Agent Kit read-only tools work for at least two atoms
- one pairwise handoff test runs through Console-compatible session setup

Baseline dimensions:

- task success
- output quality
- latency
- token/cost overhead
- debugging clarity
- composability/reuse
- implementation complexity
- Console demo quality

The atom pattern does not need to beat the baseline on every axis. It does need to show a real advantage on recomposition, observability, specialization, or failure isolation.

## Run Artifact Shape

Each evaluated run should eventually produce a small artifact with:

```json
{
  "run_id": "string",
  "date": "YYYY-MM-DD",
  "level": "single_atom | pairwise | molecule | baseline",
  "template": "string",
  "console_compatible": true,
  "agents": [],
  "task": {},
  "observed_messages": [],
  "tool_calls": [],
  "success": true,
  "failure_modes": [],
  "notes": []
}
```

This is a design target, not an implementation plan.

## Acceptance Criteria

- Each design/implementation phase has a clear success/failure standard.
- Pairwise tests can identify whether handoff was atom-driven or harness-driven.
- Console incompatibility is treated as a first-class failure mode.
- Failure modes are specific enough to inform future Coral patterns.
- The eventual single-agent baseline comparison has clear timing and dimensions.

