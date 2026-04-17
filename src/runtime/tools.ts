import { tool, type Tool } from "ai";
import { z } from "zod";

// Deliberately permissive: the AI SDK's Tool<PARAMETERS, RESULT> generics are
// invariant in places (experimental_toToolResultContent), and atom tools vary
// across capabilities. Registries keep the shape uniform without constraining
// the per-tool RESULT type.
export type LocalTool = Tool<any, any>;
export type LocalToolRegistry = Record<string, LocalTool>;

// OpenAI's tool-call schema requires names matching ^[a-zA-Z0-9_-]+$ —
// dots and other separators are rejected, even though Coral MCP and
// Agent Kit are happy with them. Enforce the tighter pattern here.
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const noopTool: LocalTool = tool({
  description:
    "Smoke-test tool for atom templates. Echoes its input; always returns status:ok.",
  parameters: z.object({
    echo: z.string().default("ping"),
  }),
  execute: async ({ echo }) => ({ status: "ok", echo }),
});
export const NOOP_TOOL_NAME = "atom_noop";

export function buildLocalRegistry(tools: LocalToolRegistry): LocalToolRegistry {
  for (const name of Object.keys(tools)) {
    if (!NAME_PATTERN.test(name)) {
      throw new Error(
        `Invalid local tool name "${name}": must match ${NAME_PATTERN}. ` +
          `Tool names must be Coral-safe (lowercase alphanumeric, dot, underscore, hyphen).`
      );
    }
  }
  return Object.freeze({ ...tools });
}

export function mergeRegistries(
  local: LocalToolRegistry,
  coral: LocalToolRegistry
): LocalToolRegistry {
  for (const name of Object.keys(local)) {
    if (name in coral) {
      throw new Error(
        `Local tool name "${name}" collides with a Coral MCP tool. ` +
          `Rename the local tool — Coral tool names are reserved.`
      );
    }
  }
  return Object.freeze({ ...coral, ...local });
}
