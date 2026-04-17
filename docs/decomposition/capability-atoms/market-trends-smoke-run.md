# market-trends smoke run

## Context

This note captures the attempted Console smoke test for the `market-trends`
atom, per task 3 of `docs/superpowers/plans/market-data-atoms.md`. The goal
was to launch the atom via Coral Console and observe: MCP connection, at
least one `agentkit.*` tool call, one `atom_result` message, and clean exit.

The atom structural work (bootstrap helper + five atom directories +
manifests) landed in the worktree branch `atoms-runtime`. Live execution
against Coral Server requires agent-registry discovery, which was not
configurable from inside the worktree.

## Observations

- Coral Server is running locally at `http://localhost:5555` (auth key
  `local`).
- The registry endpoint `GET /api/v1/registry` lists nine agents, none of
  which are the capability atoms in this plan. Current entries: `ruby-claude`,
  `agent-codex`, `brandouble-agent`, `aqua-claude`, `puppet`, `socket`,
  `echo`, `seed`, `tool`.
- Agent discovery is configured via `registry.local_agents` in
  `/Users/bambozlor/Desktop/product-lab/coral-server/config.toml`. The
  running server only scans four external paths (outside this repo); no REST
  endpoint allows runtime-adding local agents (`RegistryApi.kt` exposes GETs
  only).
- An ESM-load failure in Agent Kit's transitive dependency
  `@bonfida/spl-name-service@3.0.21` (broken relative import of `borsh`)
  blocked the default ESM import path. The worktree works around it by
  loading Agent Kit via `createRequire` (CJS) in `src/atoms/bootstrap.ts`.
- Dependency-level verification (Node + CJS) confirmed:
  `agent.use(MiscPlugin)` exposes `GET_COINGECKO_TRENDING_TOKENS_ACTION`
  and the rest of the atom allowlist. `agent.use(TokenPlugin)` is required
  for `PYTH_FETCH_PRICE` (oracle-price).

## Open Questions

- Should the repo add a helper script that amends
  `coral-server/config.toml` or writes a per-project `registry` override,
  so smoke tests can be run without manual config edits?
- Does Coral Server support a developer-mode `local` registry path that
  doesn't require a restart (e.g. via CLI flag) to pick up new atoms?
- Is the `createRequire`-based plugin load durable, or should this repo
  pin `@bonfida/spl-name-service` to a version whose ESM build resolves
  `borsh` correctly?

## Hypotheses

- Pointing `registry.local_agents` at the worktree's `agents/` directory
  and restarting Coral Server will be sufficient to register the five new
  atoms — no other wiring should be required because manifests already
  declare the required options, runtime, and prompt surface.
- The first end-to-end Console run will expose at least one of the
  failure modes catalogued in
  `docs/superpowers/specs/2026-04-17-capability-atoms-evaluation-failure-modes-design.md`
  (likely `message_non_execution` if the atom emits assistant text instead
  of sending an `atom_result`).

## Links

- Plan: `docs/superpowers/plans/market-data-atoms.md`
- Spec: `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md`
- Coral config: `/Users/bambozlor/Desktop/product-lab/coral-server/config.toml`
- Worktree: `.worktrees/atoms-runtime` on branch `atoms-runtime`

## Proposed follow-up to unblock

Add to `registry.local_agents` in `coral-server/config.toml` (paths must
point at the **worktree** — the main repo does not yet have the bootstrap
helper at `src/atoms/bootstrap.ts` and the agent `index.ts` files):

```
"/Users/bambozlor/Desktop/product-lab/solana-aat-library/.worktrees/atoms-runtime/agents/market-trends",
"/Users/bambozlor/Desktop/product-lab/solana-aat-library/.worktrees/atoms-runtime/agents/token-info",
"/Users/bambozlor/Desktop/product-lab/solana-aat-library/.worktrees/atoms-runtime/agents/market-price",
"/Users/bambozlor/Desktop/product-lab/solana-aat-library/.worktrees/atoms-runtime/agents/oracle-price",
"/Users/bambozlor/Desktop/product-lab/solana-aat-library/.worktrees/atoms-runtime/agents/wallet-assets",
```

After the branch merges to master, update the paths to drop `.worktrees/atoms-runtime/`.

Then restart Coral Server and re-run `GET /api/v1/registry` to confirm
the five atoms appear. Once confirmed, open Console, create a one-agent
session with `market-trends`, supply `COINGECKO_API_KEY` + `MODEL_API_KEY`,
send a puppet message asking for trending tokens, and fill in the
Observations section above with the actual run result.
