import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel, type KnownProvider } from "@mariozechner/pi-ai";

import { connectCoralMcp } from "./coral-mcp.js";
import { writeIterationArtifact } from "./debug.js";
import { readCoralEnv } from "./env.js";
import { buildSystemPrompt, buildUserTurn } from "./prompt.js";

export interface PreparedFirstTurnEnv {
  SYSTEM_PROMPT: string;
  EXTRA_SYSTEM_PROMPT: string;
}

export interface PreparedFirstTurnMcp {
  readResource: (uri: string) => Promise<string>;
  tools: AgentTool<any>[];
}

export interface PrepareFirstTurnConfig {
  mcp: PreparedFirstTurnMcp;
  env: PreparedFirstTurnEnv;
}

export interface PreparedFirstTurn {
  systemPrompt: string;
  instructionResource: string;
  stateResource: string;
  firstTurnTools: AgentTool<any>[];
}

// Fixture-1 headline finding: receive happens through the pre-loaded
// coral://state resource expanded into the system prompt, not through
// coral_wait_for_message. Attempt 1 surfaced the wait tools at iter-0 and the
// model latched on to a stale currentUnixTime, missing the seed permanently.
// The first turn therefore excludes every wait primitive.
const FIRST_TURN_TOOL_BLOCKLIST = new Set([
  "coral_wait_for_message",
  "coral_wait_for_mention",
  "coral_wait_for_agent",
]);

export async function prepareFirstTurn(
  config: PrepareFirstTurnConfig
): Promise<PreparedFirstTurn> {
  const [instructionResource, stateResource] = await Promise.all([
    config.mcp.readResource("coral://instruction"),
    config.mcp.readResource("coral://state"),
  ]);

  const systemPrompt = buildSystemPrompt({
    systemPrompt: config.env.SYSTEM_PROMPT,
    extraSystemPrompt: config.env.EXTRA_SYSTEM_PROMPT,
    instructionResource,
    stateResource,
  });

  const firstTurnTools = config.mcp.tools.filter(
    (t) => !FIRST_TURN_TOOL_BLOCKLIST.has(t.name)
  );

  return { systemPrompt, instructionResource, stateResource, firstTurnTools };
}

export interface IterationPayload {
  iteration: number;
  systemPrompt: string;
  event: unknown;
  ts: string;
}

export interface BuildIterationPayloadInput {
  iteration: number;
  /** Structural view of a pi-mono Agent; real Agent satisfies this. */
  agent: { state: { systemPrompt?: string } };
  event: unknown;
  /** Injectable clock — defaults to new Date().toISOString() */
  nowIso?: string;
}

/**
 * Build the per-turn_end debug-artifact payload. Captures the current system
 * prompt so a live run produces byte-diffable evidence against fixture-1's
 * trends-iter-0.json `systemPrompt` field. Predicate 1 is otherwise only
 * inferable from downstream behavior (tool choice + input token count).
 */
export function buildIterationPayload(
  input: BuildIterationPayloadInput
): IterationPayload {
  return {
    iteration: input.iteration,
    systemPrompt: input.agent.state.systemPrompt ?? "",
    event: input.event,
    ts: input.nowIso ?? new Date().toISOString(),
  };
}

export interface RunAtomConfig {
  atomName: string;
  localTools: AgentTool<any>[];
  /** Additional secret values to redact from debug artifacts. */
  secretsFromEnv?: string[];
}

/**
 * End-to-end atom runtime on pi-mono:
 *   1. reads Coral env
 *   2. connects to Coral MCP (streamable HTTP)
 *   3. pre-loads coral://instruction + coral://state into the system prompt
 *      via prepareFirstTurn (fixture-1 predicate 1 + 1.b)
 *   4. spins up a pi-mono Agent with the prepared prompt and first-turn tools
 *      (wait tools filtered — see FIRST_TURN_TOOL_BLOCKLIST)
 *   5. drives one `agent.prompt(initialUserTurn)` and waits for idle
 *   6. writes per-turn_end debug artifacts via writeIterationArtifact
 *
 * This commit deliberately scopes the tool set to first-turn-only: wait tools
 * are not re-admitted after turn 1. That's fine for the trends-only
 * "receive still works" milestone; molecule-era iter-N>0 behavior (peer atom
 * waits, handoff completes) is a follow-up commit with its own fixture.
 */
export async function runAtom(config: RunAtomConfig): Promise<void> {
  const env = readCoralEnv();
  const modelApiKey = process.env.MODEL_API_KEY;
  if (!modelApiKey) {
    throw new Error(
      "Missing MODEL_API_KEY — required to instantiate the pi-mono Agent. " +
        "Set via coral-agent.toml [options] or the env."
    );
  }
  const modelProvider = (process.env.MODEL_PROVIDER ??
    "openai") as KnownProvider;
  const modelId = process.env.MODEL_ID ?? "gpt-4o-mini";

  const coral = await connectCoralMcp(
    env.CORAL_CONNECTION_URL,
    env.CORAL_AGENT_ID
  );

  try {
    const allTools = [...coral.tools, ...config.localTools];

    const prepared = await prepareFirstTurn({
      mcp: { readResource: coral.readResource, tools: allTools },
      env,
    });

    const model = getModel(modelProvider as any, modelId as any);

    const agent = new Agent({
      initialState: {
        systemPrompt: prepared.systemPrompt,
        model,
        tools: prepared.firstTurnTools,
      },
      convertToLlm: (messages) => messages as any,
      getApiKey: async () => modelApiKey,
    });

    const secrets = [
      modelApiKey,
      env.CORAL_AGENT_SECRET,
      ...(config.secretsFromEnv ?? []),
    ].filter((s): s is string => typeof s === "string" && s.length > 0);

    let iteration = 0;
    agent.subscribe(async (ev) => {
      if (ev.type !== "turn_end") return;
      iteration += 1;
      await writeIterationArtifact({
        atomName: config.atomName,
        sessionId: env.CORAL_SESSION_ID,
        iteration,
        secretsFromEnv: secrets,
        payload: buildIterationPayload({ iteration, agent, event: ev }),
      });
    });

    const initialUserTurn = buildUserTurn({
      iteration: 0,
      extraInitialUserPrompt: env.EXTRA_INITIAL_USER_PROMPT,
      followupUserPrompt: env.FOLLOWUP_USER_PROMPT,
    });

    await agent.prompt(initialUserTurn);
    await agent.waitForIdle();
  } finally {
    await coral.close();
  }
}
