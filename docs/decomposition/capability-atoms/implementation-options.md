# Implementation Options

This is the pause point before implementation. The next step should be chosen after manual review.

## Option A: Start With Atoms

Implement `market-trends` and `token-info` first with minimal runtime support.

Pros:

- Fastest way to test whether tiny capability agents actually call their tools.
- Makes atom boundaries concrete early.
- Pairwise behavior becomes visible quickly.

Cons:

- Runtime mistakes may be duplicated across atoms.
- Message contracts may drift before we standardize them.

Best when the priority is learning from real Coral behavior immediately.

## Option B: Start With Runtime

Implement a generic Coral atom runtime before any Agent Kit action wiring.

Pros:

- Establishes one place for wait/respond/retry/state behavior.
- Reduces repeated scaffolding.
- Makes later atoms easier to add.

Cons:

- Risks designing runtime abstractions without enough behavioral evidence.
- Delays the first honest molecule test.

Best when the priority is preventing a second architecture rewrite.

## Option C: Hybrid Vertical Slice

Implement just enough runtime to support two atoms, then wire `market-trends` and `token-info`.

Pros:

- Keeps runtime grounded in real behavior.
- Produces a quick pairwise Coral test.
- Avoids overbuilding before the molecule shape is known.

Cons:

- Some early runtime code will likely be revised after the first molecule test.

Recommended starting point.

## First Review Decision

Choose one of:

1. Implement `market-trends` + `token-info` with a minimal runtime.
2. Implement the runtime shell first with mocked tools.
3. Implement a two-atom hybrid vertical slice, then expand to the full `market-signal` molecule.
