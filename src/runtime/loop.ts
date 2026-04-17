import { generateText, type CoreMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import type { CoralEnv } from "./env.js";
import { writeIterationArtifact } from "./debug.js";
import { buildSystemPrompt, buildUserTurn } from "./prompt.js";
import type { LocalToolRegistry } from "./tools.js";

export class ToolFailureBudgetExceeded extends Error {
  constructor(public toolName: string, public failureCount: number) {
    super(
      `Tool "${toolName}" failed ${failureCount} times in a row — aborting loop to avoid runaway.`
    );
    this.name = "ToolFailureBudgetExceeded";
  }
}

export interface RunLoopConfig {
  client: Client;
  registry: LocalToolRegistry;
  env: CoralEnv;
  atomName: string;
}

export type RunLoopEndReason = "max-iterations" | "finalized";

export interface RunLoopResult {
  iterations: number;
  reason: RunLoopEndReason;
  finalizedAt?: number;
}

const FAILURE_BUDGET = 3;

interface RuntimeOptions {
  maxIterations: number;
  iterationDelayMs: number;
  maxTokens: number;
  modelProvider: string;
  modelId: string;
  modelApiKey: string;
  modelProviderUrlOverride: string | undefined;
}

function readModelOptions(): RuntimeOptions {
  const modelApiKey = process.env.MODEL_API_KEY;
  if (!modelApiKey) {
    throw new Error(
      "Missing MODEL_API_KEY — required to instantiate the model provider. " +
        "Set this via the coral-agent.toml option or env when running standalone."
    );
  }
  return {
    maxIterations: Number(process.env.MAX_ITERATIONS ?? 20),
    iterationDelayMs: Number(process.env.ITERATION_DELAY_MS ?? 0),
    maxTokens: Number(process.env.MAX_TOKENS ?? 4096),
    modelProvider: process.env.MODEL_PROVIDER ?? "openai",
    modelId: process.env.MODEL_ID ?? "gpt-4o-mini",
    modelApiKey,
    modelProviderUrlOverride: process.env.MODEL_PROVIDER_URL_OVERRIDE || undefined,
  };
}

function resolveModel(opts: RuntimeOptions) {
  if (opts.modelProvider !== "openai") {
    throw new Error(
      `MODEL_PROVIDER="${opts.modelProvider}" is not yet supported by the atom runtime. ` +
        `Only "openai" is wired in this milestone; add provider support when needed.`
    );
  }
  const provider = createOpenAI({
    apiKey: opts.modelApiKey,
    baseURL: opts.modelProviderUrlOverride,
  });
  return provider(opts.modelId);
}

async function readCoralResource(client: Client, uri: string): Promise<string> {
  try {
    const response = await client.readResource({ uri });
    const contents = response.contents ?? [];
    return contents
      .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
      .join("\n");
  } catch {
    return "";
  }
}

function detectAtomResultFinalization(
  toolCalls: Array<{ toolName: string; args: unknown }>
): boolean {
  for (const call of toolCalls) {
    if (call.toolName !== "coral_send_message") continue;
    const args = call.args as Record<string, unknown> | undefined;
    if (!args) continue;
    const content = args.content;
    if (typeof content !== "string") continue;
    try {
      const parsed = JSON.parse(content);
      if (parsed && parsed.kind === "atom_result") return true;
    } catch {
      // non-JSON messages aren't finalization signals
    }
  }
  return false;
}

export async function runLoop(config: RunLoopConfig): Promise<RunLoopResult> {
  const opts = readModelOptions();
  const model = resolveModel(opts);
  const secretsFromEnv = [
    opts.modelApiKey,
    config.env.CORAL_AGENT_SECRET,
    process.env.COINGECKO_API_KEY ?? "",
    process.env.HELIUS_API_KEY ?? "",
    process.env.SOLANA_PRIVATE_KEY ?? "",
  ].filter(Boolean);

  const messages: CoreMessage[] = [{ role: "system", content: "" }];

  let lastFailedTool: string | null = null;
  let consecutiveFailures = 0;

  for (let i = 0; i < opts.maxIterations; i++) {
    const instructionResource = await readCoralResource(
      config.client,
      "coral://instruction"
    );
    const stateResource = await readCoralResource(
      config.client,
      "coral://state"
    );

    const systemPrompt = buildSystemPrompt({
      systemPrompt: config.env.SYSTEM_PROMPT,
      extraSystemPrompt: config.env.EXTRA_SYSTEM_PROMPT,
      instructionResource,
      stateResource,
    });
    messages[0] = { role: "system", content: systemPrompt };

    const userTurn = buildUserTurn({
      iteration: i,
      extraInitialUserPrompt: config.env.EXTRA_INITIAL_USER_PROMPT,
      followupUserPrompt: config.env.FOLLOWUP_USER_PROMPT,
    });
    messages.push({ role: "user", content: userTurn });

    const step = await generateText({
      model,
      messages,
      tools: config.registry,
      toolChoice: "required",
      maxSteps: 1,
      maxTokens: opts.maxTokens,
    });

    messages.push(...step.response.messages);

    const toolCalls = step.toolCalls.map((c) => ({
      toolName: (c as { toolName: string }).toolName,
      args: (c as { args: unknown }).args,
    }));
    const toolResults = step.toolResults.map((r) => ({
      toolName: (r as { toolName: string }).toolName,
      result: (r as { result: unknown }).result,
    }));

    const finalized = detectAtomResultFinalization(toolCalls);

    if (step.toolResults.length === 0) {
      const pseudoName = "<no-tool-call>";
      if (lastFailedTool === pseudoName) {
        consecutiveFailures += 1;
      } else {
        lastFailedTool = pseudoName;
        consecutiveFailures = 1;
      }
      if (consecutiveFailures >= FAILURE_BUDGET) {
        await writeIterationArtifact({
          atomName: config.atomName,
          sessionId: config.env.CORAL_SESSION_ID,
          iteration: i,
          secretsFromEnv,
          payload: {
            iteration: i,
            systemPrompt,
            userTurn,
            instructionResource,
            stateResource,
            toolCalls,
            toolResults,
            finalized: false,
            error: "no-tool-call failure budget exceeded",
          },
        });
        throw new ToolFailureBudgetExceeded(pseudoName, consecutiveFailures);
      }
    } else {
      for (const result of step.toolResults) {
        const toolName = (result as { toolName: string }).toolName;
        const raw = (result as { result: unknown }).result;
        const errored =
          raw != null &&
          typeof raw === "object" &&
          (("isError" in raw && (raw as { isError: boolean }).isError === true) ||
            ("error" in raw && (raw as { error: unknown }).error !== undefined));

        if (errored) {
          if (lastFailedTool === toolName) {
            consecutiveFailures += 1;
          } else {
            lastFailedTool = toolName;
            consecutiveFailures = 1;
          }
          if (consecutiveFailures >= FAILURE_BUDGET) {
            await writeIterationArtifact({
              atomName: config.atomName,
              sessionId: config.env.CORAL_SESSION_ID,
              iteration: i,
              secretsFromEnv,
              payload: {
                iteration: i,
                systemPrompt,
                userTurn,
                instructionResource,
                stateResource,
                toolCalls,
                toolResults,
                finalized: false,
                error: `tool "${toolName}" failure budget exceeded`,
              },
            });
            throw new ToolFailureBudgetExceeded(toolName, consecutiveFailures);
          }
        } else {
          lastFailedTool = null;
          consecutiveFailures = 0;
        }
      }
    }

    await writeIterationArtifact({
      atomName: config.atomName,
      sessionId: config.env.CORAL_SESSION_ID,
      iteration: i,
      secretsFromEnv,
      payload: {
        iteration: i,
        systemPrompt,
        userTurn,
        instructionResource,
        stateResource,
        toolCalls,
        toolResults,
        finalized,
      },
    });

    if (finalized) {
      return { iterations: i + 1, reason: "finalized", finalizedAt: i };
    }

    if (opts.iterationDelayMs > 0) {
      await new Promise((r) => setTimeout(r, opts.iterationDelayMs));
    }
  }

  return { iterations: opts.maxIterations, reason: "max-iterations" };
}
