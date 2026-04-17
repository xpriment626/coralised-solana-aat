import type { MoleculeTemplate } from "./manifest.js";
import { validateMoleculeTemplate } from "./manifest.js";

// Mirrors the Coral Server DTO `SessionRequest`. We only model the fields the
// compiler emits; optional fields Coral fills in (annotations, budget, etc.)
// are left off unless declared.

export interface RegistrySourceIdentifier {
  type: "local";
}
export interface RegistryAgentIdentifier {
  name: string;
  version: string;
  registrySourceId: RegistrySourceIdentifier;
}

export type AgentOptionValue =
  | { type: "string"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "i32"; value: number }
  | { type: "i64"; value: number }
  | { type: "u32"; value: number }
  | { type: "u64"; value: string }
  | { type: "f64"; value: number }
  | { type: "list[string]"; value: string[] };

export interface GraphAgentRequest {
  id: RegistryAgentIdentifier;
  name: string;
  description?: string;
  options?: Record<string, AgentOptionValue>;
  systemPrompt?: string;
  blocking?: boolean;
  customToolAccess?: string[];
  provider: {
    type: "local";
    runtime: "executable" | "function" | "docker" | "prototype";
  };
  annotations?: Record<string, string>;
}

export interface AgentGraphRequest {
  agents: GraphAgentRequest[];
  groups: string[][];
  customTools?: Record<string, unknown>;
}

export type SessionNamespaceProvider =
  | { type: "use_existing"; name: string }
  | {
      type: "create_if_not_exists";
      namespaceRequest: {
        name: string;
        deleteOnLastSessionExit?: boolean;
        annotations?: Record<string, string>;
      };
    };

export type SessionRequestExecution =
  | {
      mode: "immediate";
      runtimeSettings?: {
        ttl?: number;
        extendedEndReport?: boolean;
        persistenceMode?: "none" | "rolling" | "full";
      };
    }
  | { mode: "defer" };

export interface CreateSessionRequest {
  agentGraphRequest: AgentGraphRequest;
  namespaceProvider: SessionNamespaceProvider;
  execution: SessionRequestExecution;
  annotations?: Record<string, string>;
}

const AGENT_VERSION_DEFAULT = "0.1.0";

function toAgentOptionValue(raw: unknown): AgentOptionValue {
  if (typeof raw === "string") return { type: "string", value: raw };
  if (typeof raw === "boolean") return { type: "bool", value: raw };
  if (typeof raw === "number") {
    if (Number.isInteger(raw)) {
      if (raw >= 0 && raw < 2 ** 32) return { type: "u32", value: raw };
      return { type: "i64", value: raw };
    }
    return { type: "f64", value: raw };
  }
  if (Array.isArray(raw) && raw.every((v) => typeof v === "string")) {
    return { type: "list[string]", value: raw as string[] };
  }
  throw new Error(
    `Unsupported molecule option value type: ${JSON.stringify(raw)}. ` +
      `Extend AgentOptionValue to handle this type before compiling.`
  );
}

function toGraphAgent(
  atom: MoleculeTemplate["atoms"][number]
): GraphAgentRequest {
  const options: Record<string, AgentOptionValue> = {};
  if (atom.options) {
    for (const [key, value] of Object.entries(atom.options)) {
      options[key] = toAgentOptionValue(value);
    }
  }
  return {
    id: {
      name: atom.atom,
      version: AGENT_VERSION_DEFAULT,
      registrySourceId: { type: "local" },
    },
    name: atom.name,
    options: Object.keys(options).length > 0 ? options : undefined,
    systemPrompt: atom.prompt,
    blocking: atom.blocking,
    provider: { type: "local", runtime: "executable" },
  };
}

/**
 * Compile a validated `MoleculeTemplate` into the Coral Server REST
 * `SessionRequest` shape. The output is a plain JSON-serializable object —
 * compilation does not hit the network. Execution is a separate step handled
 * by the seed runner (plan 7).
 */
const DEBUG_AGENT_DEFINITIONS: Record<string, GraphAgentRequest> = {
  puppet: {
    id: {
      name: "puppet",
      version: "1.0.0",
      registrySourceId: { type: "local" },
    },
    name: "puppet",
    description: "Debug puppet used to seed threads and inject messages.",
    provider: { type: "local", runtime: "function" },
  },
  seed: {
    id: {
      name: "seed",
      version: "1.0.0",
      registrySourceId: { type: "local" },
    },
    name: "seed",
    description: "Debug seed used to send an initial scripted message.",
    provider: { type: "local", runtime: "function" },
  },
};

export function compileMoleculeToSession(
  template: MoleculeTemplate
): CreateSessionRequest {
  const validated = validateMoleculeTemplate(template);

  const atomAgents: GraphAgentRequest[] = validated.atoms.map(toGraphAgent);

  // Collect every name referenced in groups / seed and, for recognized debug
  // agents (puppet, seed), ensure they appear in the session graph. Coral
  // requires group members to correspond to session agents.
  const referenced = new Set<string>();
  for (const group of validated.groups) for (const m of group) referenced.add(m);
  if (validated.seed) referenced.add(validated.seed.agent);

  const atomNames = new Set(atomAgents.map((a) => a.name));
  const debugAgents: GraphAgentRequest[] = [];
  for (const name of referenced) {
    if (atomNames.has(name)) continue;
    const def = DEBUG_AGENT_DEFINITIONS[name];
    if (def) debugAgents.push(def);
  }

  const agents = [...atomAgents, ...debugAgents];
  const groups = validated.groups.map((group) => [...group]);

  const annotations: Record<string, string> = {
    molecule: validated.name,
    moleculeVersion: "1",
  };

  const runtimeSettings: NonNullable<
    Extract<SessionRequestExecution, { mode: "immediate" }>["runtimeSettings"]
  > = { ttl: validated.runtime.ttlMs };

  return {
    agentGraphRequest: {
      agents,
      groups,
      // customTools intentionally omitted — plan 6 stays read-only; later work
      // can emit hand-written tools via this field.
    },
    namespaceProvider: {
      type: "create_if_not_exists",
      namespaceRequest: {
        name: `molecule-${validated.name}`,
        deleteOnLastSessionExit: true,
        annotations,
      },
    },
    execution: {
      mode: "immediate",
      runtimeSettings,
    },
    annotations,
  };
}
