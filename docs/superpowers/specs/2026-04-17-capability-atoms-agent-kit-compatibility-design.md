# Capability Atoms: Agent Kit Compatibility Design

**Date:** 2026-04-17
**Status:** Draft
**Scope:** Design how SendAI Agent Kit actions/plugins are decomposed, adapted, and exposed to TypeScript Coral atom agents.

---

## Decomposition Index

This design is grounded in the following decomposition notes:

- `docs/decomposition/capability-atoms/agent-kit-market-data-atom-inventory.md` — initial market-data action decomposition.
- `docs/decomposition/capability-atoms/implementation-options.md` — early implementation sequencing options.
- `docs/decomposition/capability-atoms/README.md` — atom/molecule experiment framing.
- `docs/debugging-logs/postmortem-skills-first-architecture.md` — rationale for relying on maintained tools instead of hand-rolled protocol fetches.

Related design specs:

- `2026-04-17-capability-atoms-single-agent-template-koog-parity-design.md`
- `2026-04-17-capability-atoms-molecule-composition-runtime-design.md`
- `2026-04-17-capability-atoms-evaluation-failure-modes-design.md`

## Plan Index

Island plans executing this spec:

- `docs/superpowers/plans/agent-kit-action-adapter.md` — install Agent Kit, adapter that projects allowed actions into `LocalTool` entries, normalized result envelope.
- `docs/superpowers/plans/market-data-atoms.md` — `bootstrapAtom` helper and the five market-data atom directories (`market-trends`, `token-info`, `market-price`, `oracle-price`, `wallet-assets`).

## Problem

SendAI Agent Kit provides maintained Solana actions, schemas, wallet integration, and framework adapters. The previous architecture ignored most of that surface and hand-rolled protocol tools after wrapping skills as agents.

The new architecture should use Agent Kit as the tool/action substrate while preserving the experiment's atom boundary: one agent should own a small capability, not the entire plugin or workflow.

The compatibility problem has three parts:

1. Agent Kit actions must be adapted into the TypeScript atom runtime.
2. Action groups must be decomposed into smallest viable atom capabilities.
3. Credential and wallet requirements must remain visible to Coral Console and safe for local testing.

## Goals

1. Define how Agent Kit actions become local tools inside atom agents.
2. Preserve Agent Kit schemas and descriptions wherever possible.
3. Keep atom boundaries explicit even when Agent Kit plugins expose broad action sets.
4. Support read-only market-data atoms before signing/transaction atoms.
5. Keep credentials and wallet options compatible with Coral manifests and Console sessions.

## Non-Goals

- Do not design the single-agent Coral loop here.
- Do not design molecule session graph composition here.
- Do not implement wallet signing or policy middleware in this design.
- Do not decide long-term production wallet provider selection.
- Do not create implementation task plans in this spec.

## Design Principles

1. **Agent Kit owns protocol execution.** This repo should avoid reimplementing protocol clients when Agent Kit already provides actions.

2. **Atoms own curated action subsets.** A plugin may contain many actions, but an atom should expose only the actions required for its capability.

3. **Schemas should survive adaptation.** Zod schemas, parameter descriptions, and action names should be preserved or transformed mechanically.

4. **Console-visible configuration wins.** Required API keys, model keys, RPC URLs, and wallet options should be declared in `coral-agent.toml` when they are required for Console demos.

5. **Start read-only.** Market data and metadata actions are the safest integration surface for proving runtime behavior before transaction execution.

## Atom Decomposition Model

Agent Kit integrations should be inventoried into capability atoms using this structure:

```text
plugin/integration
  -> action inventory
  -> action risk classification
  -> smallest useful capability clusters
  -> atom manifest candidates
  -> molecule candidates
```

For market data, the initial clusters are:

- `market-trends`: trending tokens, top gainers, trending pools, latest pools
- `token-info`: token lookup, token metadata, token context
- `market-price`: current/recent token price data
- `oracle-price`: oracle-backed price verification
- `wallet-assets`: wallet asset context where useful for market signal tests

The decomposition should be revisited whenever an action cluster only makes sense as part of another action sequence. That may indicate the boundary is too narrow.

## Action Adapter Contract

The adapter should convert Agent Kit actions into the runtime's local tool format without manually rewriting each schema.

Expected adapter responsibilities:

- receive Agent Kit agent/action registry
- select actions by atom manifest allowlist
- expose tool name, description, input schema, and execute function
- normalize tool results into JSON-serializable values
- preserve action errors with structured failure output
- redact secrets from error/debug output

The adapter should not:

- decide which peer agent receives a handoff
- merge unrelated actions for convenience
- silently expose every action in a plugin
- bypass policy/risk metadata for signing actions

## Credentials And Options

Every required credential should have an explicit owner.

Examples:

- model provider key: single-agent runtime option
- CoinGecko Pro API key: market-data atom option
- Solana RPC URL: runtime or Agent Kit environment option
- wallet secret/provider config: signing atom option, deferred until signing atoms are in scope

Console compatibility means required values should be declared in `coral-agent.toml` options whenever the agent cannot run without them. Local `.env` files can provide defaults for developer convenience but should not be the only configuration path.

## Read-Only First Boundary

The first Agent Kit compatibility slice should avoid transaction signing.

Allowed early action types:

- market data reads
- token metadata reads
- pool/trending reads
- oracle price reads
- wallet asset reads, if no signing is required

Deferred action types:

- swaps
- staking
- lending/borrowing
- NFT minting
- token transfers
- governance or multisig execution

Deferred actions need policy middleware, wallet provider design, simulation strategy, and approval gates.

## Tool Result Contract

Agent Kit action results should be normalized before they enter model context.

Recommended shape:

```json
{
  "tool": "action_name",
  "status": "success | error",
  "data": {},
  "warnings": [],
  "source": {
    "plugin": "string",
    "action": "string"
  }
}
```

This keeps model-visible results stable even if upstream action return shapes vary.

## Console Compatibility

Agent Kit compatibility must not require a custom harness-only configuration path.

Each atom using Agent Kit should expose:

- required API keys as manifest options
- runtime/model options as manifest options
- capability-specific toggles as manifest options where useful
- prompt override support
- clear descriptions so Console users understand what the atom can do

If an atom cannot be configured from Console, it should be considered incomplete for internal demos.

## Risk Areas

- Agent Kit adapters may assume a single-agent tool loop, while this project restricts action subsets per atom.
- Some plugin actions may be too coupled to split into useful atoms.
- Schema conversions may lose descriptions or optional/default metadata.
- API key handling can drift into `.env`-only behavior if not manifest-driven.
- Read-only atoms may pass early tests but hide signing-agent complexity.

## Acceptance Criteria

- A market-data atom can load only its allowed Agent Kit actions.
- Tool schemas are preserved well enough for the model to call actions correctly.
- Required credentials are visible as Coral manifest options.
- Tool results are normalized and safe to append to model context.
- The same atom can run through Console and through a local test harness with equivalent configuration.
- The design leaves clear extension points for later signing/policy work without implementing them now.

