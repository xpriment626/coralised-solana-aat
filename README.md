# Solana Agent-as-Tool Library

A library of 40 Coralised agents, each wrapping a specific [Solana Skill](https://www.solanaskills.com/) into a single-purpose, independently deployable unit that can coordinate with any other agent in a CoralOS session.

Each agent runs the Vercel AI SDK with `gpt-5.4-mini`, connects to the Coral server via MCP, and communicates through Coral's thread-based messaging system.

---

## What is CoralOS?

CoralOS is an open-source runtime for multi-agent systems. At its core is the **Coral Server** — a communication hub that lets AI agents discover each other, exchange messages, and coordinate on tasks without a central orchestrator dictating every interaction.

Think of it like a group chat platform for AI agents. Agents join sessions, create topic-specific threads, send messages, mention each other, and wait for replies. The server handles authentication, message routing, and session lifecycle. The agents handle everything else.

The protocol is transport-agnostic — agents connect to the server over MCP (Model Context Protocol), which means any framework that can speak MCP can participate: LangChain agents, Vercel AI SDK agents, Claude Code, Codex, or a simple Python script.

### The coordination primitives

Every agent in a Coral session gets a standard set of MCP tools:

| Tool | What it does |
|------|-------------|
| `coral_create_thread` | Open a new conversation thread with a topic and initial participants |
| `coral_send_message` | Post a message to a thread, optionally @mentioning specific agents |
| `coral_wait_for_mention` | Block until another agent mentions you (in any thread) |
| `coral_wait_for_message` | Block until a message matching filters arrives |
| `coral_wait_for_agent` | Block until a specific agent sends a message |
| `coral_add_participant` | Invite another agent into an existing thread |
| `coral_remove_participant` | Remove an agent from a thread |
| `coral_close_thread` | Close a thread when the work is done |

These are simple primitives. The power is in what they enable when combined.

---

## Why multilateral communication matters

Most multi-agent systems today use one of three patterns:

### Sequential (pipeline)

```
User → Agent A → Agent B → Agent C → Agent D → Output
```

Agent A processes the input, passes its output to Agent B, and so on. Each agent sees only what the previous agent gave it.

**The problem:** Agent C cannot ask Agent A a clarifying question. If Agent B produced ambiguous output, Agent C has to guess — and that guess propagates to Agent D. There is no feedback loop. In practice, one weak link in the chain degrades the entire pipeline, and the agents have no way to self-correct.

### Parallel (fan-out / fan-in)

```
           ┌→ Worker A ─┐
Orchestrator → Worker B ─→ Orchestrator → Output
           └→ Worker C ─┘
```

An orchestrator dispatches subtasks to workers, collects results, and synthesises a final output. Workers run concurrently but cannot talk to each other.

**The problem:** If Worker A discovers something that would change Worker B's approach, there is no channel for that information. The orchestrator is a bottleneck — every piece of coordination must flow through it. And the topology is fixed at design time: adding a new worker means modifying the orchestrator.

### Hierarchical (tree)

```
         Supervisor
        /    |     \
     Lead A  Lead B  Lead C
     / \       |      / \
    W1  W2    W3    W4  W5
```

A deeper version of parallel, where supervisors delegate to sub-supervisors. Still one-directional. Still no peer-to-peer communication between branches.

**The problem:** If W1 (under Lead A) and W4 (under Lead C) are working on related subtasks, their only path of communication is up through Lead A → Supervisor → Lead C → W4. In a real team, W1 would just walk over to W4's desk and ask.

### Multilateral (Coral's model)

```
     ┌──── Thread: "Token Analysis" ────┐
     │  Jupiter ↔ CoinGecko ↔ Pyth      │
     └───────────────────────────────────┘
     ┌──── Thread: "Risk Assessment" ────┐
     │  Kamino ↔ MarginFi ↔ Pyth         │
     └───────────────────────────────────┘
     ┌──── Thread: "Execution Plan" ─────┐
     │  Jupiter ↔ Helius ↔ Squads        │
     └───────────────────────────────────┘
```

Any agent can create a thread, invite any other agent, and start a conversation. Agents communicate directly — no mandatory routing through a supervisor. Threads are topic-scoped, so an agent can participate in multiple concurrent conversations about different aspects of a task.

**What this enables:**
- **Clarification loops.** If the Jupiter agent gets an ambiguous swap request, it can create a thread with the Pyth agent to verify current prices before responding — without the requesting agent needing to know that happened.
- **Dynamic topology.** The conversation structure isn't hardcoded. Agents decide at runtime who they need to talk to based on the actual problem, not a predetermined graph.
- **Concurrent coordination.** Multiple threads can run in parallel, with overlapping participants. The CoinGecko agent can be answering a price query in one thread while the Pyth agent is providing a feed update in another, both feeding into the same higher-level task.
- **Self-correction.** An agent that receives surprising or contradictory data can go back and ask for clarification, verify with a second source, or flag the inconsistency — all within the session, all without human intervention.

---

## Why "agents as tools"?

This library uses a specific pattern: each Solana skill is wrapped in its own independently deployable agent. Not a tool within a monolithic agent. Not a subagent within a parent. A standalone, Coralised agent.

Here's why that matters:

### Composability without coupling

In a typical orchestrator-subagent system, the parent agent defines which subagents exist and how they interact. Want to swap out the swap aggregator? You modify the parent. Want to add a new capability? You modify the parent. The parent becomes a god object that knows about everything.

With agents-as-tools, each agent is a self-contained unit:

```
agents/
├── jupiter-swap/     ← knows about Jupiter, nothing else
├── helius/           ← knows about Helius, nothing else
├── pyth/             ← knows about Pyth, nothing else
└── kamino/           ← knows about Kamino, nothing else
```

You can compose them into any workflow by simply including them in a Coral session. The workflow is defined by which agents are in the session and how they're prompted — not by a hardcoded orchestration layer.

### Mix and match across workflows

The same `solana-jupiter-swap` agent can participate in:
- A DeFi portfolio rebalancing workflow (alongside Kamino, Pyth, and Helius)
- A token launch monitoring pipeline (alongside PumpFun, CoinGecko, and CT Alpha)
- An interactive trading assistant (alongside Phantom Connect and CoinGecko)

No code changes. No reconfiguration. The agent is the same every time — what changes is the session it's placed into and the other agents it coordinates with.

### Independent development and deployment

Each agent in this library can be:
- Updated independently (bump the version, re-link)
- Tested independently (spin up a Coral server with just that agent)
- Replaced independently (swap in a different implementation of the same skill)
- Versioned independently (run v1 and v2 side by side)

This is the same principle behind microservices, applied to AI agents.

---

## Architecture

```
solana-aat-library/
├── package.json              # Shared dependencies (ai, @ai-sdk/openai, @modelcontextprotocol/sdk)
├── tsconfig.json
├── shared/
│   └── coral-loop.ts         # The reusable agent runtime
├── agents/
│   ├── jupiter-swap/
│   │   ├── coral-agent.toml  # Coral manifest (name, version, runtime config)
│   │   ├── startup.sh        # Entrypoint called by Coral server
│   │   └── index.ts          # Agent code — system prompt + runCoralAgent()
│   ├── helius/
│   │   ├── coral-agent.toml
│   │   ├── startup.sh
│   │   └── index.ts
│   └── ... (40 agents total)
├── scripts/
│   ├── generate-agents.ts    # Agent scaffolding generator
│   └── link-all.sh           # Bulk-link all agents to ~/.coral/agents/
└── README.md
```

### How each agent works

1. **Coral server launches the agent** via `startup.sh` (the `executable` runtime).
2. **Startup injects environment variables:** `CORAL_CONNECTION_URL`, `CORAL_AGENT_ID`, `CORAL_SESSION_ID`, etc.
3. **The agent fetches its Solana Skill** — each agent has a `skillUrl` pointing to its `SKILL.md` in the [sendaifun/skills](https://github.com/sendaifun/skills) repo. This is fetched once at boot and appended to the system prompt, giving the LLM authoritative reference material (API endpoints, SDK patterns, code examples, error handling, gotchas) rather than relying on training data alone.
4. **The agent connects** to the Coral MCP server and discovers `coral_*` coordination tools.
5. **Tools are bridged** into the Vercel AI SDK so the LLM (gpt-5.4-mini) can call them natively.
6. **Main loop:** `coral_wait_for_mention` → LLM processes the mention → responds via `coral_send_message` → waits again.

The shared runtime ([shared/coral-loop.ts](shared/coral-loop.ts)) handles steps 2–6. Each agent only needs to provide its system prompt, skill URL, and call `runCoralAgent()`. If the skill fetch fails (network issue, repo down), the agent logs a warning and continues with just its base domain knowledge.

---

## Quick start

### Prerequisites

- Node.js 18+
- An OpenAI API key (for gpt-5.4-mini)

### 1. Install dependencies

```bash
cd solana-aat-library
npm install
```

### 2. Link agents to your local Coral registry

This creates symlinks in `~/.coral/agents/` so that any Coral server running on your machine discovers the agents:

```bash
bash scripts/link-all.sh
```

### 3. Start a Coral server

Using npx (no local clone needed):

```bash
npx coralos-dev@1.1.0-SNAPSHOT-18 server start -- --auth.keys=dev --console.console-release-version="v0.3.10"
```

Or if you have the server cloned locally:

```bash
cd /path/to/coral-server
CONFIG_FILE_PATH=./config.toml ./gradlew run
```

### 4. Create a session

Once the server is running, create a session that includes the agents you want. You can do this via the Coral Studio UI or the REST API:

```bash
curl -X POST http://localhost:5555/api/v1/local/session \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev" \
  -d '{
    "agents": [
      {
        "name": "solana-jupiter-swap",
        "options": {
          "OPENAI_API_KEY": "sk-..."
        }
      },
      {
        "name": "solana-pyth",
        "options": {
          "OPENAI_API_KEY": "sk-..."
        }
      },
      {
        "name": "solana-helius",
        "options": {
          "OPENAI_API_KEY": "sk-..."
        }
      }
    ]
  }'
```

The server will launch each agent, inject the Coral connection, and the agents will begin waiting for mentions.

---

## Agents

### DeFi Protocols

| Agent | Skill | What it does |
|-------|-------|-------------|
| `solana-jupiter-swap` | Jupiter | Token swaps, limit orders, DCA, route optimisation |
| `solana-raydium` | Raydium | AMM/CLMM pools, swaps, liquidity, LaunchLab |
| `solana-orca` | Orca | Whirlpools concentrated liquidity, position management |
| `solana-meteora` | Meteora | DLMM, DAMM, bonding curves, Alpha Vaults |
| `solana-pumpfun` | PumpFun | Token launches, bonding curves, PumpSwap AMM |
| `solana-kamino` | Kamino | Lending, borrowing, liquidity strategies, leverage |
| `solana-marginfi` | MarginFi | Lending, borrowing, flash loans, looping |
| `solana-sanctum` | Sanctum | Liquid staking, LST swaps, Infinity pool |
| `solana-lulo` | Lulo | Lending aggregation, automated yield optimisation |
| `solana-lavarage` | Lavarage | Leveraged trading up to 12x on any SPL token |
| `solana-ranger-finance` | Ranger | Perps aggregation across Drift, Flash, Adrena, Jupiter |
| `solana-glam` | GLAM | Tokenised vaults, treasury, DeFi strategy management |

### Infrastructure & RPC

| Agent | Skill | What it does |
|-------|-------|-------------|
| `solana-helius` | Helius | RPC, DAS API, WebSockets, Laserstream, webhooks |
| `solana-quicknode` | QuickNode | RPC, DAS API, gRPC streaming, priority fees |
| `solana-carbium` | Carbium | Bare-metal RPC, gRPC, DEX aggregation, MEV protection |

### Oracles & Market Data

| Agent | Skill | What it does |
|-------|-------|-------------|
| `solana-pyth` | Pyth | Real-time price feeds, confidence intervals, CPI |
| `solana-switchboard` | Switchboard | Oracle feeds, VRF randomness, Surge streaming |
| `solana-coingecko` | CoinGecko | Token prices, DEX pools, OHLCV, trade history |
| `solana-metengine-data` | MetEngine | Smart money analytics, Polymarket, Hyperliquid |

### NFTs & Digital Assets

| Agent | Skill | What it does |
|-------|-------|-------------|
| `solana-metaplex` | Metaplex | Core NFTs, compressed NFTs, Candy Machine, Umi |

### Core SDK & Dev Tools

| Agent | Skill | What it does |
|-------|-------|-------------|
| `solana-kit` | @solana/kit | Modern Solana SDK — RPC, transactions, signers |
| `solana-kit-migration` | Migration | web3.js v1 → @solana/kit migration guidance |
| `solana-surfpool` | Surfpool | Testing environment with mainnet forking |
| `solana-svm` | SVM | Solana architecture internals and protocol |
| `solana-pinocchio` | Pinocchio | Zero-copy high-performance program development |
| `solana-agent-kit` | Agent Kit | SendAI's 60+ action toolkit for AI agents |

### Wallet & Auth

| Agent | Skill | What it does |
|-------|-------|-------------|
| `solana-phantom-connect` | Phantom SDK | Wallet connection, social login, signing |
| `solana-phantom-wallet-mcp` | Phantom MCP | Wallet operations across chains |
| `solana-squads` | Squads | Multisig, smart accounts, treasury management |

### Cross-chain

| Agent | Skill | What it does |
|-------|-------|-------------|
| `solana-debridge` | deBridge | Bridging between Solana and EVM chains |

### Trading & Intelligence

| Agent | Skill | What it does |
|-------|-------|-------------|
| `solana-dflow` | DFlow | Spot trading, prediction markets, streaming |
| `solana-helius-dflow` | Helius+DFlow | Trading apps with Helius infrastructure |
| `solana-helius-phantom` | Helius+Phantom | Frontend apps with Helius+Phantom |
| `solana-ct-alpha` | CT Alpha | Crypto Twitter intelligence, trending tokens |

### Privacy & Advanced

| Agent | Skill | What it does |
|-------|-------|-------------|
| `solana-light-protocol` | Light | ZK Compression, rent-free tokens (200x cheaper) |
| `solana-inco-svm` | Inco | Encrypted balances, private transfers |
| `solana-magicblock` | MagicBlock | Ephemeral Rollups, sub-10ms latency |
| `solana-manifest` | Manifest | On-chain order book DEX |

### Security

| Agent | Skill | What it does |
|-------|-------|-------------|
| `solana-vulnhunter` | VulnHunter | Vulnerability detection, variant analysis |
| `solana-code-recon` | Code Recon | Security audit preparation, trust boundary mapping |

---

## Example workflows

These aren't built into the library — they're examples of what you can compose by including the right agents in a session.

### DeFi portfolio rebalancing

**Agents:** `solana-pyth`, `solana-jupiter-swap`, `solana-kamino`, `solana-helius`

An interface agent (or human via Coral Studio) asks for a portfolio rebalance. Pyth provides current prices. Kamino checks lending positions and health factors. Jupiter finds optimal swap routes. Helius handles transaction submission with priority fee estimation. The agents coordinate through threads — Pyth feeds prices to both Jupiter and Kamino, who then coordinate on execution order to avoid slippage.

### Token launch monitoring

**Agents:** `solana-pumpfun`, `solana-coingecko`, `solana-ct-alpha`, `solana-helius`

CT Alpha monitors Crypto Twitter for trending tokens. When it detects a signal, it creates a thread with CoinGecko and PumpFun to get on-chain data (bonding curve position, liquidity, trading volume). Helius provides real-time transaction streaming for the token. All data feeds into a shared thread where agents can cross-reference signals.

### Cross-chain swap with multisig approval

**Agents:** `solana-jupiter-swap`, `solana-debridge`, `solana-squads`, `solana-pyth`

Pyth provides price quotes on both source and destination chains. Jupiter handles the Solana-side swap. deBridge handles the bridge transaction. Squads wraps the whole thing in a multisig approval flow so the treasury team must sign off before execution. The agents negotiate the optimal execution path through direct thread-based communication.

---

## Adding a new agent

1. Add your agent definition to [scripts/generate-agents.ts](scripts/generate-agents.ts)
2. Run `npx tsx scripts/generate-agents.ts` to regenerate
3. Link the new agent: `cd agents/your-agent && npx @coral-protocol/coralizer@latest link .`

Or create manually:

```
agents/your-agent/
├── coral-agent.toml   # edition = 3, name, version, description, runtime, options
├── startup.sh         # Bootstrap script (Coral injects CORAL_* env vars)
└── index.ts           # Import runCoralAgent from shared, provide system prompt
```

---

## Configuration

Each agent accepts options via `coral-agent.toml`. Currently all agents require:

| Option | Type | Description |
|--------|------|-------------|
| `OPENAI_API_KEY` | string (secret) | OpenAI API key for gpt-5.4-mini |

Options are injected as environment variables by the Coral server at runtime. Never hardcode API keys — they're passed through the session creation API.

---

## License

MIT
