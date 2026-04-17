# Capability Atoms: Single Agent Template Koog Parity Design

**Date:** 2026-04-17
**Status:** Draft
**Scope:** Design a TypeScript + Vercel AI SDK atom-agent template that behaves like a conventional Coral agent and can be launched through Coral Console.

---

## Decomposition Index

This design is grounded in the following decomposition notes:

- `docs/decomposition/capability-atoms/coral-koog-runtime-patterns.md` — reference behavior from Koog agents and the local compliance demo.
- `docs/decomposition/capability-atoms/coral-console-composition-patterns.md` — Console/session compatibility constraints.
- `docs/decomposition/capability-atoms/README.md` — experiment boundary and success/failure signals.
- `docs/debugging-logs/postmortem-skills-first-architecture.md` — failure mode this template must avoid.

Related future design specs:

- `2026-04-17-capability-atoms-agent-kit-compatibility-design.md`
- `2026-04-17-capability-atoms-molecule-composition-runtime-design.md`
- `2026-04-17-capability-atoms-evaluation-failure-modes-design.md`

## Plan Index

Island plans executing this spec:

- `docs/superpowers/plans/atom-template-manifest-and-environment.md` — template directory shape, `coral-agent.toml` contract, env reader, MCP connect.
- `docs/superpowers/plans/atom-template-runtime-loop.md` — local tool registry, Coral tool discovery, bounded core loop.
- `docs/superpowers/plans/atom-template-prompt-message-debug.md` — system prompt composition, `atom_request`/`atom_result` helpers, debug artifact writer.

## Problem

The previous TypeScript agents were easy to scaffold but did not behave like reliable Coral agents. They leaned on static skill identity and one-shot generation instead of a session-level execution loop. In practice, the agents talked about what they could do instead of using tools and sending Coral messages.

Koog agents that work well in team demos share a stronger runtime shape:

- a valid `coral-agent.toml`
- server-provided runtime options
- Coral MCP connection
- `coral://instruction` and `coral://state` resource refresh
- bounded autonomous loop
- tool-call-oriented model turns
- explicit tool result append
- structured messages sent through Coral tools
- debug traces

The TypeScript atom template must reproduce those properties closely enough that the experiment tests Coral interoperability, not accidental runtime weakness.

## Goals

1. Provide a reusable TypeScript executable-agent template for capability atoms.
2. Keep the agent fully compatible with Coral Server registry discovery and Coral Console session creation.
3. Match the Koog runtime loop where it matters for reliability.
4. Make atom capability boundaries explicit in manifests, prompts, and runtime guardrails.
5. Keep local debugging artifacts available without replacing Console-visible threads/messages/status.

## Non-Goals

- Do not design molecule composition in this spec.
- Do not design Agent Kit action decomposition in this spec.
- Do not create implementation task plans in this spec.
- Do not optimize for production deployment, Docker packaging, or marketplace publishing yet.
- Do not introduce a central workflow coordinator inside the single-agent template.

## Design Principles

1. **A Console-launched agent is the primary target.** Local scripts may help development, but the atom must work when Coral Server launches it from `coral-agent.toml`.

2. **The runtime loop is part of the agent contract.** A valid manifest is not enough. The process must connect, loop, wait, use tools, send messages, and exit predictably.

3. **Coral resources stay server-owned.** The agent should read `coral://instruction` and `coral://state` each iteration rather than baking all coordination behavior into static prompts.

4. **Assistant text is not inter-agent communication.** Any result intended for another agent must be sent with `coral_send_message`.

5. **The template constrains atoms without becoming a workflow engine.** It may reject out-of-bound tools and enforce iteration limits, but it should not decide molecule-level sequencing.

## Agent Manifest Contract

Each atom directory should include a `coral-agent.toml` that Coral Server can discover.

Minimum manifest responsibilities:

- stable agent name and version
- summary and description focused on the atom capability
- executable runtime path and arguments
- required API/model options
- runtime control options:
  - `MAX_ITERATIONS`
  - `ITERATION_DELAY_MS`
  - `MAX_TOKENS`
  - `MODEL_PROVIDER`
  - `MODEL_PROVIDER_URL_OVERRIDE`
  - `MODEL_API_KEY`
  - `MODEL_ID`
  - `SYSTEM_PROMPT`
  - optional extra initial/follow-up prompts
- capability-specific options surfaced in Console

The manifest should not hide required runtime values in `.env` if Console needs to render or override them. Environment variables may still be used by local scripts, but the Coral-visible path should be option-driven.

## Runtime Environment Contract

When launched by Coral Server, the TypeScript process should rely on standard Coral environment variables:

- `CORAL_CONNECTION_URL`
- `CORAL_AGENT_ID`
- `CORAL_AGENT_SECRET`
- `CORAL_SESSION_ID`
- `CORAL_API_URL`
- `CORAL_RUNTIME_ID`
- `CORAL_PROMPT_SYSTEM`, when provided

The template should fail fast with clear logs if required Coral connection variables are missing. A local development mode can synthesize configuration only if it is clearly separate from Console/session execution.

## Core Loop

The TS template should mirror the Koog loop:

```text
connect to Coral MCP
discover Coral tools
merge local atom tools
initialize conversation state
repeat maxIterations:
  refresh coral://instruction
  refresh coral://state
  rebuild system prompt
  ask model for tool calls
  execute tool calls
  append tool results
  write debug trace
  stop if budget/iteration/finalization condition is met
close resources
```

The loop is session-level, not mention-level. Waiting for mentions/messages should happen through Coral wait tools inside the loop.

## Prompt Contract

The base system prompt should include:

- agent name
- atom capability and boundaries
- allowed local tools
- structured message contract
- reminder that inter-agent communication must use Coral message tools
- Coral resource placeholders:
  - `<resource>coral://instruction</resource>`
  - `<resource>coral://state</resource>`

Prompt overrides from Console should be additive or explicitly replacing, but the runtime must preserve the Coral resource requirements unless an advanced override intentionally disables them.

## Tool Contract

The template should expose one combined tool registry:

- Coral MCP tools discovered from the server
- local atom tools adapted for Vercel AI SDK

Runtime guardrails should reject:

- local tools not assigned to this atom
- tool calls that violate atom capability boundaries
- repeated failing tool calls above a configured threshold

The template should support a dummy/no-op local tool for Console smoke tests before Agent Kit integration is available.

## Message Contract

Atom outputs should be JSON-first and sent through `coral_send_message`.

Minimum request shape:

```json
{
  "kind": "atom_request",
  "task_id": "string",
  "from": "agent-name",
  "to": "agent-name",
  "capability": "string",
  "input": {}
}
```

Minimum result shape:

```json
{
  "kind": "atom_result",
  "task_id": "string",
  "agent": "agent-name",
  "status": "success | partial | error",
  "result": {},
  "handoffs": [],
  "limitations": []
}
```

The template should not require every atom to know every molecule. It should let the atom emit bounded handoff hints without executing molecule-level orchestration.

## Console Compatibility

The template is acceptable only if an atom can be:

- discovered by Coral Server from `coral-agent.toml`
- added to a Console session
- configured through Console-rendered options
- launched by Coral Server as an executable runtime
- inspected through Console agent status
- observed through Console threads and messages
- manually poked through Console puppet/thread controls

Local harness support is secondary.

## Debugging Contract

The template should write local debug artifacts to a predictable ignored location, but the primary experiment evidence should remain Console-visible where possible.

Local debug artifacts should include:

- prompt/resource snapshots
- tool calls and tool results
- iteration summaries
- final status or failure reason
- token/step counts when available

Debug logs must not contain raw secrets by default.

## Risks

- Vercel AI SDK may not provide a direct equivalent to Koog's `requestLLMOnlyCallingTools`; the implementation may need to approximate with tool-choice constraints.
- A strict tool-call loop may make final summarization awkward unless the message-sending contract is clear.
- Console option handling may push the template toward more manifest boilerplate than local development needs.
- If the template owns too many handoff helpers, it can accidentally become a workflow runtime.

## Acceptance Criteria

- One dummy atom can be launched from Coral Console and connects to Coral MCP.
- The atom refreshes `coral://instruction` and `coral://state`.
- The atom can call at least one local tool and at least one Coral tool.
- The atom sends a structured `atom_result` through `coral_send_message`.
- The same atom can be exercised through a local harness without diverging from Console behavior.
- Debug artifacts are sufficient to compare TS behavior with Koog behavior.

