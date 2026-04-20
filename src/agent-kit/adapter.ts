import type { AgentTool } from "@mariozechner/pi-agent-core";
import { redactSecrets, sanitizeJsonSchema } from "pi-coral-agent";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

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
 * Project a subset of Agent Kit actions into a list of pi-mono AgentTools.
 *
 * Each adapted tool's `execute`:
 *   1. runs the action's handler inside try/catch
 *   2. normalizes the raw return value into AgentKitResultEnvelope
 *   3. catches thrown errors into a structured error envelope
 *   4. runs the final envelope through redactSecrets before returning
 *
 * Tool names are prefixed `agentkit_<action_lowercased>` to avoid colliding
 * with Coral MCP tools and to make provenance visible in logs. Parameter
 * schemas come from each action's zod definition and are projected to JSON
 * Schema via zod-to-json-schema so pi-mono / the LLM providers accept them.
 */
export function adaptAgentKitActions(params: AdaptParams): AgentTool<any>[] {
  const byName = new Map<string, AgentKitAction>();
  for (const action of params.registry) {
    byName.set(action.name, action);
  }

  const tools: AgentTool<any>[] = [];
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
    const toolName = `agentkit_${action.name.toLowerCase()}`;
    const zodSchema = action.schema ?? z.object({});
    const jsonSchema = sanitizeJsonSchema(
      zodToJsonSchema(zodSchema, { target: "openApi3" })
    );

    const tool: AgentTool<any> = {
      name: toolName,
      label: toolName,
      description:
        action.description ?? `Agent Kit action ${action.name}`,
      parameters: jsonSchema as any,
      execute: async (_toolCallId, input) => {
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
        const redacted = redactSecrets(envelope, secrets);
        return {
          content: [{ type: "text", text: JSON.stringify(redacted) }],
          details: undefined,
        };
      },
    };

    tools.push(tool);
  }

  return tools;
}
