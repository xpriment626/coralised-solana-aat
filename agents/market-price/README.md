# market-price

Capability atom for CoinGecko price data via Solana token address.

Agent Kit actions (read-only):

- `GET_COINGECKO_TOKEN_PRICE_DATA_ACTION`

Declared handoffs:

- `oracle-price` — Pyth oracle comparison
- `token-info` — when token identity is ambiguous

References:

- Plan: `docs/superpowers/plans/market-data-atoms.md`
- Spec: `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md`
- Manifest: `src/atoms/market-data.ts` (`marketPriceAtom`)
