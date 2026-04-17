# token-info

Capability atom for token identity and metadata lookup via CoinGecko.

Agent Kit actions (read-only):

- `GET_COINGECKO_TOKEN_INFO_ACTION`

Declared handoffs:

- `market-price` — CoinGecko price data
- `oracle-price` — Pyth oracle verification

References:

- Plan: `docs/superpowers/plans/market-data-atoms.md`
- Spec: `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md`
- Manifest: `src/atoms/market-data.ts` (`tokenInfoAtom`)
