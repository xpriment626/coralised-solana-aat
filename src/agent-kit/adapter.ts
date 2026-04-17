import { tool } from "ai";
import { z } from "zod";

import { redactSecrets } from "../runtime/debug.js";
import type { LocalTool, LocalToolRegistry } from "../runtime/tools.js";
import {
  errorEnvelope,
  normalizeAgentKitResult,
  type AgentKitResultEnvelope,
} from "./envelope.js";
import type { AgentKitAction, AgentKitAgent } from "./types.js";

export interface AdaptParams {
  registry: AgentKitAction[];
  allowlist: string[];
  agent: AgentKitAgent;
  pluginByAction?: Record<string, string>;
  secretsFromEnv?: string[];
}

/**
 * Project a subset of Agent Kit actions into a LocalToolRegistry.
 *
 * Each adapted tool's `execute`:
 *   1. runs the action's handler inside try/catch
 *   2. normalizes the raw return value into AgentKitResultEnvelope
 *   3. catches thrown errors into a structured error envelope
 *   4. runs the final envelope through redactSecrets before returning
 *
 * Tool names are prefixed `agentkit.<action_lowercased>` to avoid colliding
 * with Coral MCP tools and to make provenance visible in logs.
 */
export function adaptAgentKitActions(
  params: AdaptParams
): LocalToolRegistry {
  const byName = new Map<string, AgentKitAction>();
  for (const action of params.registry) {
    byName.set(action.name, action);
  }

  const registry: LocalToolRegistry = {};
  const secrets = params.secretsFromEnv ?? [];

  for (const actionName of params.allowlist) {
    const action = byName.get(actionName);
    if (!action) {
      console.warn(
        JSON.stringify({
          event: "agentkit-action-not-found",
          actionName,
          note:
            "Action name is in atom allowlist but missing from Agent Kit registry. " +
            "Verify the required plugin was registered via agent.use(plugin).",
        })
      );
      continue;
    }

    const plugin = params.pluginByAction?.[actionName] ?? "unknown";
    // OpenAI tool names must match ^[a-zA-Z0-9_-]+$ — dots are rejected.
    const toolName = `agentkit_${action.name.toLowerCase()}`;
    const parameters = action.schema ?? z.object({});

    const wrapped: LocalTool = tool({
      description:
        action.description ?? `Agent Kit action ${action.name}`,
      parameters,
      execute: async (input: unknown) => {
        let envelope: AgentKitResultEnvelope;
        try {
          const raw = await action.handler(
            params.agent,
            (input ?? {}) as Record<string, unknown>
          );
          envelope = normalizeAgentKitResult({
            action: action.name,
            plugin,
            result: raw,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          envelope = errorEnvelope({
            action: action.name,
            plugin,
            result: undefined,
            message,
          });
        }
        return redactSecrets(envelope, secrets);
      },
    });

    registry[toolName] = wrapped;
  }

  return registry;
}
