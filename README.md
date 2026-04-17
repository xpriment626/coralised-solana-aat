# Solana Coralised Agents

This repository is in a rewrite phase.

The previous skills-first implementation has been archived in Git as:

- Commit: `95e92e3` (`archive: checkpoint skills-first architecture`)
- Tag: `archive/skills-first-architecture`

That version generated one Coral agent per Solana skill and then added protocol tools after the fact. The postmortem in `docs/debugging-logs/postmortem-skills-first-architecture.md` explains why that produced agents that could discuss protocols but could not reliably execute multi-agent workflows.

## New Direction

The new architecture keeps the original thesis but changes the ownership boundary:

- SendAI `solana-agent-kit` owns Solana protocol actions.
- This repo owns Coral coordination, capability-atom agents, molecule experiments, policy middleware, and runtime behavior.
- Skills documentation becomes reference material, not agent identity.

The current experimental question is not production efficiency. It is whether tightly scoped capability agents can be recomposed through Coral into useful workflows without collapsing back into one conventional agent that owns all tools.

## Target Shape

```text
src/
  runtime/       Coral task loop and MCP coordination runtime
  agent-kit/     SendAI Agent Kit plugin loading, filtering, and tool adaptation
  policies/      approval, simulation, spend, rate-limit, and action-risk gates
  atoms/         typed capability-atom manifests
  molecules/     typed molecule experiment manifests

agents/
  market-trends/
  token-info/
  market-price/
  oracle-price/
  wallet-assets/

molecules/
  market-signal/

docs/
  experiments/capability-atoms/
  debugging-logs/
    postmortem-skills-first-architecture.md
```

## Rewrite Sequence

1. Archive and tag the old implementation.
2. Remove the generated skill-first agent surface from the active tree.
3. Inventory Agent Kit actions into smallest viable capability atoms.
4. Scaffold atom agents and one molecule experiment.
5. Pause for manual review before choosing whether to implement atoms, runtime, or a hybrid vertical slice first.
6. Add wallet/policy middleware before reintroducing signing or transaction-submitting actions.
7. Compare atom/molecule behavior against a conventional single-agent baseline only after the Coral pattern has been honestly tested.

## Current Status

Only the atom/molecule rewrite skeleton is active. There are no runnable Coral agents yet.
