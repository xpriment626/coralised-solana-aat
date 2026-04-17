# oracle-price

Capability atom for Pyth oracle price verification by token symbol.

Agent Kit actions (read-only):

- `PYTH_FETCH_PRICE`

Declared handoffs:

- `market-price` — CoinGecko comparison
- `token-info` — when symbol or token identity is ambiguous

References:

- Plan: `docs/superpowers/plans/market-data-atoms.md`
- Spec: `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md`
- Manifest: `src/atoms/market-data.ts` (`oraclePriceAtom`)
