# Molecule Template and Compiler

Design Source: `docs/superpowers/specs/2026-04-17-capability-atoms-molecule-composition-runtime-design.md`

Depends On:
- `docs/superpowers/plans/atom-template-prompt-message-debug.md` — molecule sessions target atoms that follow the full template contract.
- `docs/superpowers/plans/agent-kit-action-adapter.md` — so the referenced atoms have real tools when the compiler emits a session request.

Scope Summary: Define the `MoleculeTemplate` TypeScript type, write a validator for it, and build a compiler that emits a Coral `CreateSessionRequest`. No Console `TemplateV1` wrapper — the Console `TemplateV1` format is a localStorage/download convenience (`payload.data` is just `JSON.stringify(CreateSessionRequest)`) and the REST session endpoint accepts the raw request directly, so wrapping adds no value for programmatic runs. If an internal reviewer wants a shareable Console template later, they can launch via REST once and save from Console's own UI. No seed/puppet runner and no live test either — those are plan 7.

---

## Tasks

### Task 1: Type and validator

Goal: Move the existing `src/molecules/manifest.ts` scaffold to the fuller `MoleculeTemplate` contract from the spec, with a Zod validator that catches structural errors early.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-molecule-composition-runtime-design.md` (Molecule Template Contract)
- `src/molecules/manifest.ts`
- `src/molecules/market-signal.ts`

Allowed Write Scope:
- `src/molecules/manifest.ts`
- `src/molecules/market-signal.ts`
- `src/molecules/index.ts`

Out Of Scope:
- `src/runtime/` or `src/agent-kit/`
- Any atom directory
- The compiler itself (Task 2)

Steps:
1. Replace the current `MoleculeManifest` with the `MoleculeTemplate` shape from the spec: `name`, `description?`, `atoms[]` (each with `atom`, `name`, `prompt?`, `options?`, `blocking?`), `groups[][]`, `seed?`, `runtime`, `console`.
2. Export a `MoleculeTemplateSchema` Zod schema validating the above, plus `validateMoleculeTemplate(template)` that throws a structured error on failure.
3. Update `market-signal.ts` to use the new shape — preserve the existing fields (purpose, testQuestions, successSignals, failureSignals) as `description` text and a separate `evaluation` field (add `evaluation?` to the type). The evaluation data is read by plan 8.

Verification:
- `npm run typecheck` passes.
- `validateMoleculeTemplate(marketSignalMolecule)` returns without throwing.

Stop Condition:
- Type, schema, validator, and the updated `market-signal` template exist and typecheck.

---

### Task 2: Compiler to `CreateSessionRequest`

Goal: Compile a validated `MoleculeTemplate` into the Coral Server `CreateSessionRequest` shape — the same body the Coral REST API accepts.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-molecule-composition-runtime-design.md` (Compilation Target)
- `docs/decomposition/capability-atoms/coral-console-composition-patterns.md`
- User memory: `reference_coral_rest_api.md` (session/puppet/thread endpoint shapes — the compiler emits what the session endpoint accepts)
- `src/molecules/manifest.ts` (from Task 1)

Allowed Write Scope:
- `src/molecules/compile.ts` (new file)
- `src/molecules/index.ts` (add exports)

Out Of Scope:
- Actually calling the Coral REST API — the compiler emits a plain object
- Console template export (Task 3)
- Seed/puppet execution (plan 7)

Steps:
1. Export `compileMoleculeToSession(template: MoleculeTemplate): CreateSessionRequest`.
2. Populate `agentGraphRequest.agents` from `template.atoms` (each atom entry becomes a graph agent with its `name`, `atom` as the registered agent type, prompt/option overrides carried through).
3. Populate `agentGraphRequest.groups` from `template.groups`.
4. Set `execution.mode` and `execution.runtimeSettings` from `template.runtime` (ttlMs, holdAfterExitMs).
5. Include `namespaceProvider` with a stable default and an annotation `{ molecule: template.name, moleculeVersion: "1" }`.
6. Do not populate `customTools` — this plan stays read-only; document the field as reserved for a later plan.

Verification:
- `npm run typecheck` passes.
- A sanity exercise compiles `marketSignalMolecule` and checks that `agents.length === 5`, `groups.length === template.groups.length`, and the annotation is present. Revert scratch code before finishing.

Stop Condition:
- Compiler produces a structurally valid `CreateSessionRequest` for the existing `market-signal` template without hitting the network.

---

### Task 3: Drop the `console.exportTemplate` field from the template type

Goal: Remove the now-unused `console.exportTemplate` field so the type doesn't carry dead surface area. Future work can re-add a Console-template exporter if reviewers start asking for downloadable JSON.

Context To Load:
- `src/molecules/manifest.ts` (from Task 1)
- `src/molecules/market-signal.ts`

Allowed Write Scope:
- `src/molecules/manifest.ts`
- `src/molecules/market-signal.ts`

Out Of Scope:
- Any compiler or atom code
- Any Console-integration logic — explicitly deferred

Steps:
1. Remove the `console` field from `MoleculeTemplate` and its Zod schema.
2. Remove the `console: { exportTemplate: true }` line from `marketSignalMolecule`.
3. Leave a short comment in `manifest.ts` capturing the reasoning: "Console `TemplateV1` wrapper intentionally omitted. `TemplateV1` is a Console-side localStorage/download format where `payload.data` is `JSON.stringify(CreateSessionRequest)`; the REST session endpoint accepts the raw `CreateSessionRequest` directly, so the wrapper adds no value for programmatic runs. Re-add when/if downloadable Console templates become a requirement." The comment self-documents so future agents don't need conversation context to understand the decision.

Verification:
- `npm run typecheck` passes.
- `grep -rn "exportTemplate" src/` returns nothing.

Stop Condition:
- The field is gone from both the type and the sample template. Comment is in place.
