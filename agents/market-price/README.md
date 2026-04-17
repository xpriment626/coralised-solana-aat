# market-price

Capability atom for CoinGecko token price data.

Agent Kit actions:

- `GET_COINGECKO_TOKEN_PRICE_DATA_ACTION`

Primary handoffs:

- `oracle-price` for Pyth comparison
- `token-info` when token identity is ambiguous
