# Agent Kit Market-Data Atom Inventory

Inventory source:

- Repository: `sendaifun/solana-agent-kit`
- Local review path: `/tmp/solana-agent-kit-review`
- Branch: `v2`
- Commit: `d452e54`

This inventory covers the first read-only market-data experiment. It is intentionally scoped to actions that can stress Coral coordination without wallet signing.

## Proposed Atoms

| Atom | Purpose | Agent Kit actions | Package | Risk |
| --- | --- | --- | --- | --- |
| `market-trends` | Identify broad market movement and fresh pool activity. | `GET_COINGECKO_TRENDING_TOKENS_ACTION`, `GET_COINGECKO_TRENDING_POOLS_ACTION`, `GET_COINGECKO_TOP_GAINERS`, `GET_COINGECKO_LATEST_POOLS` | `@solana-agent-kit/plugin-misc` | read |
| `token-info` | Resolve token context and metadata for specific assets. | `GET_COINGECKO_TOKEN_INFO_ACTION` | `@solana-agent-kit/plugin-misc` | read |
| `market-price` | Return current CoinGecko price data for token addresses. | `GET_COINGECKO_TOKEN_PRICE_DATA_ACTION` | `@solana-agent-kit/plugin-misc` | read |
| `oracle-price` | Return oracle price for symbols supported by Pyth. | `PYTH_FETCH_PRICE` | `@solana-agent-kit/plugin-token` | read |
| `wallet-assets` | Return wallet asset inventory through Helius DAS. | `FETCH_ASSETS_BY_OWNER` | `@solana-agent-kit/plugin-misc` | read |

## Atom Boundaries

### `market-trends`

Owns market discovery, not per-token enrichment. It can answer:

- what tokens are trending
- what pools are trending
- what tokens are top gainers
- what pools are newly listed

It should hand off token-specific questions to `token-info` or price questions to `market-price` / `oracle-price`.

### `token-info`

Owns token identity and metadata lookup. It should normalize and explain what a token is, but should not claim fresh market pricing unless another atom supplied it.

### `market-price`

Owns CoinGecko token price data by token address. It is useful for broad token pricing but should expose missing data clearly and should not present itself as an oracle.

### `oracle-price`

Owns Pyth oracle lookup by token symbol. It is useful for price verification and confidence checks, especially for majors. It should be expected to have incomplete long-tail coverage.

### `wallet-assets`

Owns Helius DAS wallet inventory. It is relevant for portfolio-context experiments, not pure market discovery. Helius DAS may include cached token price info, but the first molecule should treat that as context and use `market-price` or `oracle-price` for explicit price checks.

## First Molecule Candidate

`market-signal`:

1. Ask `market-trends` for current trending tokens, top gainers, and latest pools.
2. Select one or more candidate tokens from the trend result.
3. Ask `token-info` for identity/metadata context.
4. Ask `market-price` for CoinGecko price data.
5. Ask `oracle-price` for Pyth verification where the symbol is supported.
6. Optionally ask `wallet-assets` whether a supplied wallet has exposure to those assets.

## Pairwise Runtime Checks

Before the full molecule, useful pair tests are:

- `market-trends` -> `token-info`: trend result enrichment
- `token-info` -> `market-price`: known token price lookup
- `market-price` -> `oracle-price`: price disagreement or oracle-coverage check
- `wallet-assets` -> `market-price`: wallet token exposure pricing

## Open Questions

- Should `market-trends` choose candidates itself, or should that be a separate `candidate-selector` atom?
- Should token normalization be part of `token-info`, or should it become its own atom once routing gets harder?
- Does a molecule need an explicit synthesis atom, or should the requester/puppet synthesize the final result?
- How much structured schema should be enforced in Coral messages before the runtime becomes too heavy?
