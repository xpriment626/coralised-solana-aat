# dummy-atom

Reference scaffold for the TypeScript capability-atom template. Real atoms copy this shape.

This directory is the canonical example for `docs/superpowers/plans/atom-template-manifest-and-environment.md`. Every atom directory should contain exactly these files:

- `README.md` — one-paragraph capability description (this file)
- `coral-agent.toml` — Coral Server manifest, Console-visible options
- `index.ts` — one-line delegation to the runtime bootstrap
- `tools.ts` — placeholder for atom-specific local tool additions (added in plan 2)

The dummy atom is for Console smoke tests only. It has no capability surface beyond the built-in `atom.noop` tool added in plan 2.

## Next

- Plan 2 (atom-template-runtime-loop) extends `startAtom` with the Coral MCP tool registry, model loop, and termination conditions.
