import { z } from "zod";
import type { LocalToolRegistry } from "./tools.js";

export const AtomRequestSchema = z.object({
  kind: z.literal("atom_request"),
  task_id: z.string(),
  from: z.string(),
  to: z.string(),
  capability: z.string(),
  input: z.record(z.unknown()).default({}),
});
export type AtomRequest = z.infer<typeof AtomRequestSchema>;

export const AtomResultSchema = z.object({
  kind: z.literal("atom_result"),
  task_id: z.string(),
  agent: z.string(),
  status: z.enum(["success", "partial", "error"]),
  result: z.record(z.unknown()).default({}),
  handoffs: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
});
export type AtomResult = z.infer<typeof AtomResultSchema>;

export type AtomMessagePayload = AtomRequest | AtomResult;

export function atomRequest(
  partial: Omit<AtomRequest, "kind">
): AtomRequest {
  return AtomRequestSchema.parse({ kind: "atom_request", ...partial });
}

export function atomResult(partial: Omit<AtomResult, "kind">): AtomResult {
  return AtomResultSchema.parse({ kind: "atom_result", ...partial });
}

export interface SendAtomMessageOptions {
  threadId: string;
  mentions?: string[];
}

export async function sendAtomMessage(
  registry: LocalToolRegistry,
  payload: AtomMessagePayload,
  options: SendAtomMessageOptions
): Promise<unknown> {
  const tool = registry["coral_send_message"];
  if (!tool || typeof tool.execute !== "function") {
    throw new Error(
      "coral_send_message tool is not available in the registry. " +
        "Ensure the atom has connected to Coral MCP and discovered server tools before sending messages."
    );
  }

  // Validate by re-parsing against the matching schema — throws on shape drift.
  if (payload.kind === "atom_request") {
    AtomRequestSchema.parse(payload);
  } else {
    AtomResultSchema.parse(payload);
  }

  const args = {
    threadId: options.threadId,
    content: JSON.stringify(payload),
    mentions: options.mentions ?? [],
  };

  return tool.execute(args, {
    toolCallId: `atom-message-${Date.now()}`,
    messages: [],
  });
}
