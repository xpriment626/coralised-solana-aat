import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { discoverCoralTools } from "./coral-tools.js";
import { readCoralEnv } from "./env.js";
import { runLoop, ToolFailureBudgetExceeded } from "./loop.js";
import {
  buildLocalRegistry,
  mergeRegistries,
  noopTool,
  type LocalToolRegistry,
} from "./tools.js";

export interface StartAtomConfig {
  atomName: string;
  tools?: LocalToolRegistry;
}

export async function startAtom(config: StartAtomConfig): Promise<void> {
  let client: Client | undefined;
  let exitCode = 0;

  try {
    const env = readCoralEnv();

    client = new Client(
      { name: config.atomName, version: "0.1.0" },
      { capabilities: {} }
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(env.CORAL_CONNECTION_URL)
    );
    await client.connect(transport);

    console.log(
      JSON.stringify({
        event: "connected",
        atom: config.atomName,
        sessionId: env.CORAL_SESSION_ID,
        runtimeId: env.CORAL_RUNTIME_ID,
      })
    );

    const localRegistry = buildLocalRegistry(
      config.tools ?? { atom_noop: noopTool }
    );
    const coralRegistry = await discoverCoralTools(client);
    const merged = mergeRegistries(localRegistry, coralRegistry);

    const result = await runLoop({
      client,
      registry: merged,
      env,
      atomName: config.atomName,
    });

    if (result.reason === "finalized") {
      console.log(
        JSON.stringify({
          event: "atom-finalized",
          atom: config.atomName,
          iterations: result.iterations,
          finalizedAt: result.finalizedAt,
        })
      );
    } else {
      exitCode = 2;
      console.log(
        JSON.stringify({
          event: "atom-budget-exhausted",
          atom: config.atomName,
          iterations: result.iterations,
        })
      );
    }
  } catch (err) {
    exitCode = 1;
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "Error";
    console.error(
      JSON.stringify({
        event:
          err instanceof ToolFailureBudgetExceeded
            ? "tool-failure-budget-exceeded"
            : "atom-error",
        atom: config.atomName,
        errorName: name,
        error: message,
      })
    );
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        // best-effort shutdown; the exit code already captures the outcome
      }
    }
    process.exit(exitCode);
  }
}
