# market-signal molecule

First molecule experiment for capability atoms.

Goal: test whether independent read-only market-data atoms can coordinate through Coral to produce a useful market signal.

Initial atom set:

- `market-trends`
- `token-info`
- `market-price`
- `oracle-price`
- `wallet-assets`

Suggested first test:

1. Ask `market-trends` for current trend candidates.
2. Route one candidate to `token-info`.
3. Route the enriched candidate to `market-price`.
4. Ask `oracle-price` for verification when the token symbol is supported.
5. Record whether the workflow needed a central coordinator or whether atom handoffs were sufficient.
