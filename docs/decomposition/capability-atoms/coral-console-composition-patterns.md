# Coral Console Composition Patterns

This note summarizes what the Coral Console and Coral Server imply for composing atom agents into molecule workflows.

Sources reviewed:

- `https://github.com/Coral-Protocol/console`
- `https://github.com/Coral-Protocol/coral-server`

## Short Answer

The Console is mostly a developer experience layer over Coral Server's session API. It does not remove runtime configuration. It hides it behind agent registry lookup, default runtime selection, editable agent options, templates, and `POST /api/v1/local/session`.

The server owns the important runtime behavior:

- resolving `coral-agent.toml` files into registry agents
- validating requested agent options and runtimes
- constructing an `AgentGraph`
- linking agents through groups
- creating one `SessionAgent` per graph agent
- exposing one MCP server per session agent
- injecting Coral connection environment variables into each runtime
- launching each selected executable/docker/function/prototype runtime
- maintaining threads, messages, agent status, events, and state resources

The Console makes this feel lightweight because it serializes graph/session choices into a reusable request payload.

## Console Compatibility Requirement

For this repo, Console support is not optional. Many internal demos and proof-of-concept reviews start in Coral Console, so early atom and molecule work should preserve that path.

Practical requirements:

- Every atom should have a valid `coral-agent.toml` that Coral Server can discover.
- Every atom should expose a normal Coral runtime provider, initially `executable` unless there is a specific reason to use another runtime.
- Required options should be declared in the manifest so Console can render them.
- Prompts should be overrideable at session creation time.
- Molecule templates should map cleanly to Console's session graph model: agents, groups, options, prompts, plugins, runtime settings.
- Pairwise tests may use a harness, but the same atom pair should be runnable as a Console-created session.
- Debugging should rely on Console-visible threads/messages/status wherever possible, with local logs as supporting artifacts.

This means the local molecule compiler should avoid inventing concepts that cannot later be represented as `CreateSessionRequest`.

## Template Shape

Console templates are local-storage records with a small wrapper:

```ts
type TemplateV1 = {
  name: string;
  description?: string;
  version: 1;
  updated: number;
  trusted?: boolean;
  payload: {
    version: number;
    data: string;
  };
};
```

The `payload.data` string is the actual `CreateSessionRequest`.

This matters because "save as template" is not a separate orchestration layer. It is a saved session graph request.

## Session Request Shape

The key payload shape is:

```text
CreateSessionRequest
  agentGraphRequest
    agents[]
      id: registry agent id
      name: session-local agent name
      description
      provider: local | remote_request
      runtime: executable | docker | function | prototype
      options
      systemPrompt
      plugins
      customToolAccess
      blocking
    groups[][]
    customTools
  namespaceProvider
  execution
    immediate | defer
    runtimeSettings
```

For this repo, a "molecule template" should probably compile down to the same conceptual shape:

- selected atoms
- session-local names
- group membership
- per-atom options
- per-atom prompt override
- custom tools if needed
- execution settings

## Group Semantics

In Coral Server, groups create communication links between agents. They do not encode a workflow sequence. If a group contains `A`, `B`, and `C`, the server links each agent to the other agents in the group.

Consequences:

- Group membership is the communication topology.
- Sequencing still has to come from prompts, messages, wait tools, or deterministic runtime code.
- A molecule should not be represented only as "agents in one group" if the experiment needs stricter handoff evaluation.
- A molecule can use groups to define who can talk, and message contracts to define what should happen.

## Runtime Ownership

Runtime behavior lives below the Console.

For executable agents, the server:

- finds the executable relative to `coral-agent.toml`, absolute path, or `PATH`
- passes configured arguments
- runs the process in the agent directory
- builds environment variables such as `CORAL_CONNECTION_URL`, `CORAL_AGENT_ID`, `CORAL_AGENT_SECRET`, `CORAL_SESSION_ID`, `CORAL_API_URL`, and `CORAL_RUNTIME_ID`

For prototype agents, the server itself runs a Koog loop:

- connect to the agent's Coral MCP endpoint
- load Coral MCP tools
- load configured additional MCP tool servers
- refresh `<resource>coral://instruction</resource>` and `<resource>coral://state</resource>`
- call the LLM for tool calls
- execute tool calls
- append tool results
- repeat for configured iterations

This is why Console testing feels smoother than manual process management: the server has enough registry/runtime information to launch and supervise agents once a session request exists.

## Puppet Control

The Console also uses the server's puppet API to masquerade as an agent for testing:

- create thread
- close thread
- send message
- add/remove participant
- kill agent runtime

This is important for this repo because a molecule test harness can use the same concept. We do not need a full orchestrator just to start a test. A puppet or seed agent can create the initial thread and inject the initial task, then the atoms can handle the rest through Coral messages.

## What This Teaches The Atom Experiment

1. Atom manifests should stay registry-like.
   - Each atom should declare capability, runtime, required options, prompt contract, and tool access.

2. Molecules should be templates, not hardcoded workflows.
   - A molecule should be a saved graph/session plan: atom instances, groups, prompts, options, and runtime settings.

3. Runtime config should be generated.
   - The developer should compose atoms quickly, but the generated session request still needs explicit runtime/provider/options under the hood.

4. Groups are topology, not behavior.
   - A two-agent molecule with both agents in one group only proves they can communicate. It does not prove a workflow unless prompts/message contracts force observable handoffs.

5. A puppet initiator is a useful test primitive.
   - Start with a harness that creates a thread, posts an `atom_request`, and watches messages. Avoid making the harness synthesize the final answer unless the experiment is specifically testing orchestration.

6. Console-style templates are the right north star for fast composition.
   - For this repo, a local `molecules/*.json` or `molecules/*.ts` template format should eventually compile into Coral session requests.

7. Console compatibility is an acceptance criterion.
   - A molecule that only works through a bespoke local runner is a weaker result than one that can be launched, observed, and manually poked from Console.

## Near-Term Recommendation

Before building the TS runtime, define a minimal molecule template format:

```ts
type MoleculeTemplate = {
  name: string;
  description?: string;
  atoms: Array<{
    atom: string;
    name: string;
    prompt?: string;
    options?: Record<string, unknown>;
    blocking?: boolean;
  }>;
  groups: string[][];
  seed?: {
    agent: string;
    threadName: string;
    message: unknown;
    mentions: string[];
  };
  runtime: {
    ttlMs: number;
    holdAfterExitMs?: number;
  };
  console: {
    exportTemplate: boolean;
  };
};
```

Then implement an adapter that can later emit a real Coral `CreateSessionRequest` and, preferably, a Console-importable template wrapper.

The first molecule should still be tiny:

```text
puppet seed -> market-trends -> token-info
```

The test should record whether `market-trends` can hand off to `token-info` through Coral without a hidden central coordinator.

The same test should be representable as:

```text
Console template -> session graph -> puppet seed message -> observable agent messages
```
