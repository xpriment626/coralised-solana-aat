# Capability Atoms: Molecule Composition Runtime Design

**Date:** 2026-04-17
**Status:** Draft
**Scope:** Design how capability atoms are composed into molecule workflows while preserving Coral Console compatibility and avoiding hidden orchestration.

---

## Decomposition Index

This design is grounded in the following decomposition notes:

- `docs/decomposition/capability-atoms/coral-console-composition-patterns.md` — Console templates, session graph shape, groups, puppet control.
- `docs/decomposition/capability-atoms/coral-koog-runtime-patterns.md` — runtime behavior that atom agents should already provide.
- `docs/decomposition/capability-atoms/agent-kit-market-data-atom-inventory.md` — first atom set and market-signal molecule candidate.
- `docs/decomposition/capability-atoms/README.md` — experiment hypothesis and success/failure signals.

Related design specs:

- `2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md`
- `2026-04-17-capability-atoms-agent-kit-compatibility-design.md`
- `2026-04-17-capability-atoms-evaluation-failure-modes-design.md`

## Plan Index

Island plans executing this spec:

- `docs/superpowers/plans/molecule-template-and-compiler.md` — `MoleculeTemplate` type + validator, compiler to `CreateSessionRequest`, Console template export wrapper.
- `docs/superpowers/plans/molecule-first-pairwise-test.md` — narrowed `market-signal-pairwise` template, seed runner CLI, first pairwise run captured as a decomposition note.

## Problem

The experiment is not simply to build a workflow runner. The experiment is to test whether small Coral agents can behave as capability atoms that compose into useful workflow molecules.

Coral Console already provides a composition model: select agents, configure options/prompts, arrange groups, save a template, and launch sessions from that template. The molecule runtime in this repo should learn from that model instead of inventing a parallel composition system that cannot be used in internal demos.

The core question is:

```text
Can molecule definitions compile into Coral session graphs and still leave meaningful handoff behavior to the atoms?
```

## Goals

1. Define a local molecule template format for atom composition.
2. Keep molecule templates mappable to Coral `CreateSessionRequest`.
3. Support Console-importable template export.
4. Support pairwise tests with puppet/seed initiation.
5. Record whether handoffs happen through Coral messages rather than hidden runtime orchestration.

## Non-Goals

- Do not design the internal single-agent tool loop here.
- Do not design Agent Kit tool adaptation here.
- Do not implement a general workflow DSL.
- Do not create implementation task plans in this spec.
- Do not add a central molecule coordinator as the default path.

## Design Principles

1. **Molecules are session graph templates.** A molecule is primarily agents, groups, prompts, options, runtime settings, and seed behavior.

2. **Groups are topology, not sequence.** Group membership defines who can communicate. Prompts, messages, and wait tools define behavior.

3. **The harness may seed, observe, and score.** It should not synthesize the workflow result unless the experiment is specifically testing a coordinator.

4. **Console compatibility is a hard constraint.** Any molecule worth testing should be representable as a Console-created session.

5. **Composition must preserve atom boundaries.** A molecule template can configure atoms but should not grant one atom all tools just to make the workflow easier.

## Molecule Template Contract

Initial local shape:

```ts
type MoleculeTemplate = {
  name: string;
  description?: string;
  atoms: Array<{
    atom: string;
    name: string;
    prompt?: string;
    options?: Record<string, unknown>;
    blocking?: boolean;
  }>;
  groups: string[][];
  seed?: {
    agent: string;
    threadName: string;
    message: unknown;
    mentions: string[];
  };
  runtime: {
    ttlMs: number;
    holdAfterExitMs?: number;
  };
  console: {
    exportTemplate: boolean;
  };
};
```

This format should intentionally mirror Coral's session graph concepts instead of introducing a separate workflow DSL.

## Compilation Target

The molecule compiler should emit:

1. A Coral `CreateSessionRequest`.
2. Optionally, a Console `TemplateV1` wrapper around that session request.
3. Optional local test metadata for harness-only concerns.

The `CreateSessionRequest` should include:

- `agentGraphRequest.agents`
- `agentGraphRequest.groups`
- `agentGraphRequest.customTools`, if required
- `namespaceProvider`
- `execution.mode`
- `execution.runtimeSettings`
- annotations identifying molecule name/version

Harness-only fields should not be required for the Console path.

## Seed And Puppet Model

The first pairwise tests should use a puppet or seed agent to create the initial thread and message.

The seed action may:

- create a thread
- add relevant atom participants
- send the initial `atom_request`
- mention the first target atom
- observe resulting messages

The seed action should not:

- decide which domain tools to call
- enrich intermediate results
- execute handoffs on behalf of atoms
- synthesize the final molecule output by default

This makes the test practical without hiding whether atom-to-atom handoff works.

## First Pairwise Molecule

Initial molecule:

```text
puppet seed -> market-trends -> token-info
```

Expected behavior:

1. Seed creates a market-signal thread and sends an `atom_request` to `market-trends`.
2. `market-trends` calls its own trend/pool/gainer tools.
3. `market-trends` sends an `atom_result` with candidate tokens and a handoff to `token-info`.
4. `token-info` uses its own token lookup tools.
5. `token-info` sends a structured enrichment result back to the same thread.
6. The harness records the message chain and whether the handoff was atom-driven.

## Console Path

The same pairwise test should be runnable from Console:

```text
Console template -> session graph -> puppet seed message -> observable atom messages
```

Console users should be able to:

- load/import the molecule template
- inspect atom names, prompts, options, and groups
- launch the session
- see runtime status
- open the thread
- inspect structured messages
- manually send follow-up messages through puppet controls if needed

## Runtime Boundaries

The molecule runtime may own:

- template validation
- session request compilation
- Console template export
- seed message creation
- observation and artifact capture
- failure classification

The molecule runtime must not own:

- domain tool selection
- token enrichment logic
- hidden routing decisions beyond seed initiation
- fallback synthesis that masks atom failure

Any deterministic helper that performs handoff should be explicitly marked as orchestration and evaluated separately from the atom/molecule thesis.

## Risks

- A molecule template format can slowly become a workflow DSL if sequencing fields are added too early.
- Puppet seeding can become a hidden coordinator if it does more than initialize and observe.
- Console compatibility can be lost if local-only fields become required for the happy path.
- Groups may make all atoms visible to each other but still fail to produce useful handoffs.
- Pairwise success may not scale to larger molecule workflows.

## Acceptance Criteria

- A molecule template can describe the first two-atom test.
- The template can compile to a Coral-style session request.
- The template can be exported in a Console-importable wrapper.
- A puppet seed can initialize the test without performing domain work.
- The resulting session exposes relevant threads/messages/status in Console.
- The test artifact can distinguish atom-driven handoff from harness-driven orchestration.

