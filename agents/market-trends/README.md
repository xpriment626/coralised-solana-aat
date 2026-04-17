# market-trends

Capability atom for broad market discovery.

Agent Kit actions:

- `GET_COINGECKO_TRENDING_TOKENS_ACTION`
- `GET_COINGECKO_TRENDING_POOLS_ACTION`
- `GET_COINGECKO_TOP_GAINERS`
- `GET_COINGECKO_LATEST_POOLS`

Primary handoffs:

- `token-info` for token identity and metadata
- `market-price` for CoinGecko address-based price data
- `oracle-price` for Pyth verification where supported
