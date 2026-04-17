# market-trends

Capability atom for broad Solana market discovery via CoinGecko.

Agent Kit actions (read-only):

- `GET_COINGECKO_TRENDING_TOKENS_ACTION`
- `GET_COINGECKO_TRENDING_POOLS_ACTION`
- `GET_COINGECKO_TOP_GAINERS`
- `GET_COINGECKO_LATEST_POOLS`

Declared handoffs:

- `token-info` — token identity and metadata
- `market-price` — CoinGecko address-based price data
- `oracle-price` — Pyth verification where supported

References:

- Plan: `docs/superpowers/plans/market-data-atoms.md`
- Spec: `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md`
- Manifest: `src/atoms/market-data.ts` (`marketTrendsAtom`)
