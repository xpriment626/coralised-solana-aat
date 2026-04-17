# Evaluation Artifacts and Observability

Design Source: `docs/superpowers/specs/2026-04-17-capability-atoms-evaluation-failure-modes-design.md`

Depends On:
- `docs/superpowers/plans/atom-template-prompt-message-debug.md` — the per-iteration debug artifacts are the raw data the harness reads.
- `docs/superpowers/plans/molecule-first-pairwise-test.md` — the first pairwise run is what the observability helpers will classify. Plan 8 can start the static artifacts (schema, taxonomy doc) before plan 7 runs; the harness integration waits on plan 7.

Scope Summary: Produce the persistent evaluation artifacts — the failure-mode taxonomy doc, the run-artifact Zod schema, and a small harness that consumes atom debug logs + Coral thread messages and emits one run artifact per pairwise or molecule run. Baseline comparison is explicitly deferred per the spec.

---

## Tasks

### Task 1: Publish the failure-mode taxonomy as a repo doc

Goal: Lift the spec's Failure Mode Taxonomy into a standalone, linkable document so decomposition notes can reference it without pulling the full spec.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-evaluation-failure-modes-design.md` (Failure Mode Taxonomy, Console Evidence Requirement)

Allowed Write Scope:
- `docs/decomposition/capability-atoms/failure-mode-taxonomy.md` (new file — lives with the other decomposition notes since it's reference material for future runs)

Out Of Scope:
- Any source change
- Editing the evaluation spec

Steps:
1. Create the note with the decomposition-note shape: Context (why this taxonomy exists), Observations (the labels themselves, copied verbatim from the spec with a one-line definition each), Open Questions (labels that may split or merge as we learn), Hypotheses (empty), Links (pointer to the governing spec).
2. Do not invent new labels in this task — the spec is authoritative. Later runs may propose additions via new decomposition notes.

Verification:
- Every label from the spec's taxonomy appears in the note.
- The note follows the decomposition template sections.

Stop Condition:
- Note exists and matches the spec's labels 1:1.

---

### Task 2: Run-artifact schema

Goal: Implement the `RunArtifact` Zod schema from the spec and a helper that writes a validated artifact to disk.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-evaluation-failure-modes-design.md` (Run Artifact Shape, Evaluation Levels)
- `src/runtime/debug.ts` (for redaction — reuse, not duplicate)

Allowed Write Scope:
- `src/evaluation/run-artifact.ts` (new file)
- `src/evaluation/index.ts` (new file)

Out Of Scope:
- Any runtime, atom, or molecule code
- Harness integration (Task 3)

Steps:
1. Define `RunArtifactSchema` in Zod matching the spec exactly: `run_id`, `date` (YYYY-MM-DD), `level` (`single_atom | pairwise | molecule | baseline`), `template`, `console_compatible`, `agents`, `task`, `observed_messages`, `tool_calls`, `success`, `failure_modes` (array of strings — validate against the Task 1 taxonomy at runtime with a soft warning, not a hard failure, to leave room for new labels), `notes`.
2. Export `writeRunArtifact(artifact, { outDir })` which validates, applies `redactSecrets`, and writes `${outDir}/${artifact.run_id}.json`. Default `outDir` is `.coral-runs/`.
3. Add `.coral-runs/` to `.gitignore`.

Verification:
- `npm run typecheck` passes.
- A sanity exercise (reverted before finishing) writes a minimal valid artifact and re-reads it cleanly.
- `.gitignore` contains `.coral-runs/`.

Stop Condition:
- Schema, writer, and gitignore entry exist; the writer rejects malformed artifacts.

---

### Task 3: Harness — derive a run artifact from atom debug logs + Coral thread

Goal: Given a session ID and the list of participating atoms, read each atom's `.coral-debug/` artifacts and the Coral thread messages, and emit a single `RunArtifact`.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-evaluation-failure-modes-design.md` (Console Evidence Requirement, Evaluation Levels)
- `src/runtime/debug.ts`
- `src/evaluation/run-artifact.ts` (from Task 2)
- `scripts/run-pairwise.ts` (from plan 7 — this script will call the harness after a run)

Allowed Write Scope:
- `src/evaluation/harness.ts` (new file)
- `scripts/run-pairwise.ts` (extend only to call the harness after polling ends)

Out Of Scope:
- Any atom or molecule template code
- Any new evaluation level beyond pairwise — single_atom and molecule levels reuse this harness later; don't specialize now
- Baseline comparison — explicitly deferred per the spec

Steps:
1. Export `buildRunArtifact({ sessionId, threadId, atoms, level, template, task, coralApiUrl, debugDir })`. Implementation:
   - for each atom in `atoms`, read every JSON file under `${debugDir}/<atomName>/${sessionId}/` and collect `toolCalls` across iterations
   - fetch the thread messages from `${coralApiUrl}/api/threads/${threadId}/messages` (path per the Coral REST reference memory)
   - fill the `RunArtifact` fields from those sources
   - run a small classifier that maps observed behavior to failure-mode labels (absent `atom_result` → `message_non_execution`; `atom_result` present but no handoff when expected → `handoff_missing`; etc.). Keep this classifier conservative — only tag labels with high-signal rules, leave the rest to the run note author.
2. In `scripts/run-pairwise.ts` after polling ends, call `buildRunArtifact` and pass the result to `writeRunArtifact`. Print the output path.

Verification:
- `npm run typecheck` passes.
- Running `npm run pairwise` end-to-end produces a file under `.coral-runs/` whose contents match the schema and whose `failure_modes` list is either empty or contains labels from the taxonomy.

Stop Condition:
- One real run artifact exists on disk with non-placeholder data from an actual pairwise run, and the decomposition note from plan 7 Task 3 links to it.
