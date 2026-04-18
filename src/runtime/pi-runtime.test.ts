import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { buildIterationPayload, prepareFirstTurn } from "./pi-runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");
const FIXTURE_PATH = resolve(
  REPO_ROOT,
  "docs/fixtures/coral-wire-traces/01-atoms-runtime-receive-seed/trends-iter-0.json"
);

interface TrendsIter0 {
  systemPrompt: string;
  instructionResource: string;
  stateResource: string;
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as TrendsIter0;

// Mirrors the literal in prompt.test.ts. Source of truth:
// agents/market-trends/coral-agent.toml -> [options].SYSTEM_PROMPT default.
const MARKET_TRENDS_BASE_PROMPT =
  "You are solana-market-trends, a capability atom focused on discovering current token and pool trends from CoinGecko on Solana.\n\n" +
  "You own broad market discovery: trending tokens, trending pools, top gainers, and newly listed pools. You do not resolve token identity or fetch pricing yourself. If the user's request is outside your capability, suggest handing off to one of: token-info, market-price, oracle-price.\n\n" +
  "Communicate with other agents only through Coral message tools. Your outputs intended for other agents must be JSON payloads wrapped as atom_request or atom_result messages sent via coral_send_message.\n\n" +
  "<resource>coral://instruction</resource>\n" +
  "<resource>coral://state</resource>\n";

function stubTool(name: string): AgentTool<any> {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: "object", properties: {} } as any,
    execute: async () => ({
      content: [{ type: "text", text: "" }],
      details: undefined,
    }),
  };
}

describe("fixture-1 predicate 1.b: pi-mono atom-template pre-turn preparation", () => {
  test("fetches coral://state and coral://instruction, assembles fixture systemPrompt", async () => {
    const reads: string[] = [];
    const prepared = await prepareFirstTurn({
      mcp: {
        readResource: async (uri: string) => {
          reads.push(uri);
          if (uri === "coral://state") return fixture.stateResource;
          if (uri === "coral://instruction") return fixture.instructionResource;
          throw new Error(`unexpected resource uri: ${uri}`);
        },
        tools: [],
      },
      env: {
        SYSTEM_PROMPT: MARKET_TRENDS_BASE_PROMPT,
        EXTRA_SYSTEM_PROMPT: "",
      },
    });

    assert.ok(
      reads.includes("coral://state"),
      "prepareFirstTurn must fetch coral://state before returning"
    );
    assert.ok(
      reads.includes("coral://instruction"),
      "prepareFirstTurn must fetch coral://instruction before returning"
    );
    assert.equal(
      prepared.systemPrompt,
      fixture.systemPrompt,
      "assembled systemPrompt must equal fixture systemPrompt byte-for-byte"
    );
    assert.equal(prepared.stateResource, fixture.stateResource);
    assert.equal(prepared.instructionResource, fixture.instructionResource);
    assert.ok(
      prepared.systemPrompt.includes('"mentionAgentNames":["trends"]'),
      "mentions must survive into the final systemPrompt"
    );
  });

  test("filters coral_wait_for_message out of first-turn tools", async () => {
    const prepared = await prepareFirstTurn({
      mcp: {
        readResource: async (uri: string) => {
          if (uri === "coral://state") return fixture.stateResource;
          if (uri === "coral://instruction") return fixture.instructionResource;
          throw new Error(`unexpected resource uri: ${uri}`);
        },
        tools: [
          stubTool("coral_wait_for_message"),
          stubTool("coral_wait_for_mention"),
          stubTool("coral_wait_for_agent"),
          stubTool("coral_send_message"),
          stubTool("agentkit_get_coingecko_trending_tokens_action"),
        ],
      },
      env: {
        SYSTEM_PROMPT: MARKET_TRENDS_BASE_PROMPT,
        EXTRA_SYSTEM_PROMPT: "",
      },
    });

    const firstTurnNames = prepared.firstTurnTools.map((t) => t.name);
    assert.ok(
      !firstTurnNames.includes("coral_wait_for_message"),
      "coral_wait_for_message must be filtered from first-turn tools (fixture-1 lesson: receive happens via pre-loaded state, not via wait tool)"
    );
    assert.ok(
      !firstTurnNames.includes("coral_wait_for_mention"),
      "coral_wait_for_mention must be filtered from first-turn tools"
    );
    assert.ok(
      !firstTurnNames.includes("coral_wait_for_agent"),
      "coral_wait_for_agent must be filtered from first-turn tools"
    );
    assert.ok(
      firstTurnNames.includes("agentkit_get_coingecko_trending_tokens_action"),
      "agentkit tools must be retained"
    );
    assert.ok(
      firstTurnNames.includes("coral_send_message"),
      "coral_send_message stays in the tool list (the runtime gates it elsewhere; it is not a wait-tool)"
    );
  });
});

describe("buildIterationPayload: per-turn_end debug capture", () => {
  test("records iteration, systemPrompt from agent.state, event, and clock timestamp", () => {
    const event = {
      type: "turn_end",
      message: { role: "assistant", content: [] },
    };
    const payload = buildIterationPayload({
      iteration: 3,
      agent: { state: { systemPrompt: "assembled-prompt-xyz" } },
      event,
      nowIso: "2026-04-18T11:06:59.688Z",
    });
    assert.deepEqual(payload, {
      iteration: 3,
      systemPrompt: "assembled-prompt-xyz",
      event,
      ts: "2026-04-18T11:06:59.688Z",
    });
  });

  test("captures the fixture systemPrompt verbatim when the agent carries it", () => {
    const payload = buildIterationPayload({
      iteration: 1,
      agent: { state: { systemPrompt: fixture.systemPrompt } },
      event: { type: "turn_end" },
      nowIso: "x",
    });
    // This is the byte-diff bar for live runs: if a fresh iter-1 payload is
    // dumped with this same structure, the systemPrompt field will equal
    // fixture.systemPrompt when the runtime is working correctly.
    assert.equal(payload.systemPrompt, fixture.systemPrompt);
  });

  test("absent systemPrompt becomes empty string, not undefined", () => {
    const payload = buildIterationPayload({
      iteration: 1,
      agent: { state: {} },
      event: { type: "turn_end" },
      nowIso: "x",
    });
    assert.equal(payload.systemPrompt, "");
  });
});
