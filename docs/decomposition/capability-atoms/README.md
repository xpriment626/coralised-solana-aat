# Capability Atoms Decomposition

This repo is testing whether Coral can support the pattern:

```text
capability atoms + Coral coordination = workflow molecules
```

The experiment intentionally decomposes SendAI Agent Kit actions into narrowly scoped standalone agents. This is less efficient than a conventional single agent with many tools, but efficiency is not the first objective. The first objective is to learn whether the Coral pattern is viable, where it fails, and what runtime support it needs.

Console compatibility is part of the experiment boundary. Pairwise tests may use local scripts or harness helpers, but the atoms themselves should remain usable from Coral Console sessions because many internal demos and proof-of-concept reviews start there.

## Working Hypothesis

Small agents with singular capabilities can be recomposed into multiple workflows if each atom has:

- a narrow purpose
- a clear input contract
- a structured output contract
- explicit handoff guidance
- minimal hidden orchestration behavior

## First Molecule

The first molecule is `market-signal`.

It should combine:

- `market-trends` for trending tokens, pools, top gainers, and latest pools
- `token-info` for token lookup and metadata context
- `market-price` for CoinGecko token price data
- `oracle-price` for Pyth oracle verification where supported
- `wallet-assets` for optional wallet exposure context through Helius DAS

## Success Signals

- Atom agents can be registered, launched, inspected, and manually exercised through Coral Console.
- Two or more atoms can complete a useful workflow through Coral messages.
- Atoms call their own tools instead of describing what they would do.
- Handoffs are legible and bounded.
- Intermediate results are inspectable by a human reviewer.
- The same atom can participate in at least two molecule sketches without code changes.

## Failure Signals

- Agents repeatedly talk about actions instead of executing them.
- Handoffs loop or lose task state.
- A hidden coordinator becomes mandatory for every useful workflow.
- Task latency or cost grows beyond what the pattern can justify.
- Capability boundaries are too narrow to produce reusable behavior.
- A conventional single-agent tool caller clearly dominates on every relevant axis.
- The setup only works through a custom local harness and cannot be composed or observed from Coral Console.
