import { jsonSchema, tool } from "ai";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import type { LocalTool, LocalToolRegistry } from "./tools.js";

// MCP tools expose JSON Schema input shapes; the AI SDK's jsonSchema() helper
// accepts them directly, so we avoid pulling @types/json-schema just for this.
type MinimalJsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
} & Record<string, unknown>;

// OpenAI tool-parameter validation rejects integer bounds larger than
// JS_MAX_SAFE_INTEGER. Coral's MCP tools use Kotlin Long (i64), which
// JSON-Schema-serializes with maximum = Long.MAX_VALUE (9.22e18). Also
// minimum = Long.MIN_VALUE breaks the same check. We strip those out and
// leave other constraints intact.
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MIN_SAFE = Number.MIN_SAFE_INTEGER;

function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (
        (key === "maximum" || key === "exclusiveMaximum") &&
        typeof value === "number" &&
        value > MAX_SAFE
      ) {
        continue;
      }
      if (
        (key === "minimum" || key === "exclusiveMinimum") &&
        typeof value === "number" &&
        value < MIN_SAFE
      ) {
        continue;
      }
      out[key] = sanitizeSchema(value);
    }
    return out;
  }
  return schema;
}

export async function discoverCoralTools(
  client: Client
): Promise<LocalToolRegistry> {
  const response = await client.listTools();
  const registry: LocalToolRegistry = {};

  for (const mcpTool of response.tools) {
    const rawSchema =
      (mcpTool.inputSchema as unknown as MinimalJsonSchema) ?? {
        type: "object",
        properties: {},
      };
    const schema = jsonSchema(sanitizeSchema(rawSchema) as MinimalJsonSchema);

    const wrapped: LocalTool = tool({
      description: mcpTool.description ?? `Coral MCP tool ${mcpTool.name}`,
      parameters: schema,
      execute: async (args: unknown) => {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: (args ?? {}) as Record<string, unknown>,
        });
        return result;
      },
    });

    registry[mcpTool.name] = wrapped;
  }

  return registry;
}
