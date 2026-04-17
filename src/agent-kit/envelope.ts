import { z } from "zod";

export const AgentKitResultEnvelopeSchema = z.object({
  tool: z.string(),
  status: z.enum(["success", "error"]),
  data: z.record(z.unknown()),
  warnings: z.array(z.string()),
  source: z.object({
    plugin: z.string(),
    action: z.string(),
  }),
});
export type AgentKitResultEnvelope = z.infer<
  typeof AgentKitResultEnvelopeSchema
>;

export interface NormalizeInput {
  action: string;
  plugin: string;
  result: unknown;
}

/**
 * Normalize a raw Agent Kit action return value into the tool-result envelope
 * defined in 2026-04-17-capability-atoms-agent-kit-compatibility-design.md.
 * Handles the common "soft failure" shapes Agent Kit actions return:
 *   - { ok: false, reason } / { success: false, error }
 *   - { warnings: [...] }
 * Anything else is wrapped as a success envelope with the raw result as data.
 */
export function normalizeAgentKitResult(
  input: NormalizeInput
): AgentKitResultEnvelope {
  const raw = input.result;
  const warnings: string[] = [];
  let status: "success" | "error" = "success";
  let data: Record<string, unknown> = {};

  if (raw == null) {
    data = {};
  } else if (typeof raw !== "object" || Array.isArray(raw)) {
    data = { value: raw };
  } else {
    const obj = raw as Record<string, unknown>;

    if ("warnings" in obj && Array.isArray(obj.warnings)) {
      for (const w of obj.warnings) {
        if (typeof w === "string") warnings.push(w);
        else warnings.push(JSON.stringify(w));
      }
    }

    const okFalse = "ok" in obj && obj.ok === false;
    const successFalse = "success" in obj && obj.success === false;

    if (okFalse || successFalse) {
      const reason =
        (typeof obj.reason === "string" && obj.reason) ||
        (typeof obj.message === "string" && obj.message) ||
        (typeof obj.error === "string" && obj.error) ||
        "Agent Kit action returned a non-success response.";
      warnings.push(reason);
    }

    data = obj;
  }

  const envelope: AgentKitResultEnvelope = {
    tool: `agentkit_${input.action.toLowerCase()}`,
    status,
    data,
    warnings,
    source: {
      plugin: input.plugin,
      action: input.action,
    },
  };

  return AgentKitResultEnvelopeSchema.parse(envelope);
}

export function errorEnvelope(
  input: NormalizeInput & { message: string }
): AgentKitResultEnvelope {
  const envelope: AgentKitResultEnvelope = {
    tool: `agentkit_${input.action.toLowerCase()}`,
    status: "error",
    data: {},
    warnings: [input.message],
    source: {
      plugin: input.plugin,
      action: input.action,
    },
  };
  return AgentKitResultEnvelopeSchema.parse(envelope);
}
