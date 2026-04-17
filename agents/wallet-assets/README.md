# wallet-assets

Capability atom for wallet asset inventory via Helius DAS.

Agent Kit actions (read-only):

- `FETCH_ASSETS_BY_OWNER`

Declared handoffs:

- `token-info` — asset identity enrichment
- `market-price` — fungible token pricing

This atom is relevant to portfolio-context experiments, not pure market discovery.

References:

- Plan: `docs/superpowers/plans/market-data-atoms.md`
- Spec: `docs/superpowers/specs/2026-04-17-capability-atoms-agent-kit-compatibility-design.md`
- Manifest: `src/atoms/market-data.ts` (`walletAssetsAtom`)
