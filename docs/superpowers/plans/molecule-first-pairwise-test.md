# Molecule: First Pairwise Test

Design Source: `docs/superpowers/specs/2026-04-17-capability-atoms-molecule-composition-runtime-design.md`

Depends On:
- `docs/superpowers/plans/market-data-atoms.md` — `market-trends` and `token-info` atoms must be launchable.
- `docs/superpowers/plans/molecule-template-and-compiler.md` — the compiler emits the session request this plan runs.

Scope Summary: Run the first Coral-observable pairwise handoff: seed puppet → `market-trends` → `token-info`. Produce a small seed runner that uses the Coral REST API to create a session from a compiled template, post the seed message, and record the resulting thread. No baseline comparison, no molecule graph beyond two atoms.

This milestone exercises the **mention-driven path**, not a chat-style back-and-forth: the puppet sends a single `atom_request` via `coral_send_message`, atoms observe it through `coral://state` refresh inside their own loops, work autonomously, hand off by sending more Coral messages, and terminate when an `atom_result` is emitted. The Koog-parity `FOLLOWUP_USER_PROMPT` nudge just keeps an atom's loop productive while it waits for mentions — it does not drive task progress. `EXTRA_INITIAL_USER_PROMPT` stays empty; there is no turn-0 override from the molecule.

---

## Tasks

### Task 1: Narrow `market-signal` template to the pairwise shape

Goal: Add a second, minimal molecule template (`market-signal-pairwise`) that references only `market-trends` and `token-info`, declares one group containing both atoms plus the puppet, and sets a short `ttlMs`.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-molecule-composition-runtime-design.md` (First Pairwise Molecule, Seed And Puppet Model)
- `src/molecules/market-signal.ts`
- `src/molecules/manifest.ts`

Allowed Write Scope:
- `src/molecules/market-signal-pairwise.ts` (new file)
- `src/molecules/index.ts`

Out Of Scope:
- Any atom directory
- The full five-atom `market-signal` template — leave it intact for plan 8 to use later

Steps:
1. Create `market-signal-pairwise` using `defineMolecule` / `MoleculeTemplate`. Atoms: one `market-trends` instance named `trends` and one `token-info` instance named `info`. For each atom's `options`, leave `EXTRA_INITIAL_USER_PROMPT` empty and `FOLLOWUP_USER_PROMPT` unset (the atom's own manifest default applies). Groups: `[["trends", "info", "puppet"]]`. Seed: from `puppet`, thread name `pairwise-smoke`, initial `atom_request` asking for trending tokens and mentioning `trends`. Runtime: `ttlMs: 5 * 60_000`, `holdAfterExitMs: 30_000`.
2. Export from `src/molecules/index.ts`.

Verification:
- `npm run typecheck` passes.
- `validateMoleculeTemplate(marketSignalPairwiseMolecule)` returns without throwing.

Stop Condition:
- Template exists, validates, and compiles to a `CreateSessionRequest` without errors when passed to `compileMoleculeToSession`.

---

### Task 2: Seed runner script

Goal: A small CLI script that compiles the pairwise template, creates a Coral session via REST, posts the seed message, and prints the thread ID for Console inspection.

Context To Load:
- `docs/superpowers/specs/2026-04-17-capability-atoms-molecule-composition-runtime-design.md` (Seed And Puppet Model, Console Path)
- User memory: `reference_coral_rest_api.md` (session/puppet/thread endpoints)
- `src/molecules/compile.ts`
- `src/molecules/market-signal-pairwise.ts`

Allowed Write Scope:
- `scripts/run-pairwise.ts` (new file)
- `package.json` (add an `npm run pairwise` script entry)

Out Of Scope:
- Any automatic evaluation / scoring — that is plan 8
- Any atom code
- Runtime internals

Steps:
1. `scripts/run-pairwise.ts` should:
   - read `CORAL_API_URL` from env
   - compile `marketSignalPairwiseMolecule` to a session request
   - POST the session request to `${CORAL_API_URL}/api/sessions` (exact path per the reference memory)
   - POST a puppet seed message from the `puppet` agent creating the `pairwise-smoke` thread with the `atom_request` body, mentioning `trends`
   - poll the thread endpoint for 2 minutes (every 5s) and print each new message as it arrives
   - on TTL expiry or when an `atom_result` from `info` appears, stop polling and print a summary line with the session ID, thread ID, and the final message count
2. Add `"pairwise": "tsx scripts/run-pairwise.ts"` to `package.json` scripts.

Verification:
- `npm run typecheck` passes.
- `npm run pairwise` against a local Coral Server with the two atoms registered prints the session and thread IDs and at least two messages (the seed + one atom response). If the pairwise handoff fails, the script still exits cleanly with a non-zero code and prints what it observed.

Stop Condition:
- Script runs end-to-end without throwing, exits with 0 on observed handoff and non-zero otherwise. Console-visible session and thread remain available for manual inspection.

---

### Task 3: Capture the first run as a decomposition note

Goal: Document the outcome of the first live pairwise run using the decomposition-note template. This is the primary experimental artifact from this plan.

Context To Load:
- `CLAUDE.md` (decomposition note shape)
- The output of `npm run pairwise` from Task 2
- `.coral-debug/` artifacts produced by the two atoms

Allowed Write Scope:
- `docs/decomposition/capability-atoms/pairwise-first-run.md` (new file)

Out Of Scope:
- Any source change
- Editing prior decomposition notes

Steps:
1. Using the decomposition-note template, capture: Context (why this run, linking to this plan), Observations (what messages appeared, how many tool calls each atom made, whether the handoff was initiated by `market-trends` or by the puppet, any failure modes from the evaluation spec's taxonomy), Open Questions, Hypotheses, Links (session/thread IDs, debug artifact paths).
2. Tag any failure modes with the exact labels from `2026-04-17-capability-atoms-evaluation-failure-modes-design.md` Failure Mode Taxonomy.

Verification:
- The note exists and uses every section of the decomposition-note template.
- Any failure mode mentioned uses a label that appears in the evaluation spec verbatim.

Stop Condition:
- The note is written, whether the run succeeded or failed. Both outcomes are valid experimental data.
