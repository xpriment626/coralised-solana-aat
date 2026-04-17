import {
  compileMoleculeToSession,
  marketSignalPairwiseMolecule,
} from "../src/molecules/index.js";
import { buildRunArtifact, writeRunArtifact } from "../src/evaluation/index.js";
import { loadDotEnv } from "./lib/env-file.js";

// Load .env from the repo root before reading any env vars so direct
// invocation picks up MODEL_API_KEY / COINGECKO_API_KEY / HELIUS_API_KEY
// without the caller having to export them.
const dotenv = loadDotEnv();
for (const [k, v] of Object.entries(dotenv)) {
  if (!process.env[k]) process.env[k] = v;
}
// Friendly alias — .env files commonly use OPENAI_API_KEY for the model
// provider key; the atom manifests expect MODEL_API_KEY.
if (!process.env.MODEL_API_KEY && process.env.OPENAI_API_KEY) {
  process.env.MODEL_API_KEY = process.env.OPENAI_API_KEY;
}

interface SessionIdentifier {
  sessionId: string;
  namespace: string;
}
interface ThreadOutput {
  thread: { id: string; [k: string]: unknown };
}

const CORAL_API_URL = process.env.CORAL_API_URL ?? "http://localhost:5555";
const CORAL_AUTH_KEY = process.env.CORAL_AUTH_KEY ?? "local";
const POLL_INTERVAL_MS = 5_000;
const POLL_DURATION_MS = 2 * 60_000;

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${CORAL_AUTH_KEY}`,
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${CORAL_API_URL}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `POST ${path} failed: ${res.status} ${res.statusText}\n${text}`
    );
  }
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${CORAL_API_URL}${path}`, { headers: headers() });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `GET ${path} failed: ${res.status} ${res.statusText}\n${text}`
    );
  }
  return JSON.parse(text) as T;
}

// atom → required option keys (kept in sync with each atom's coral-agent.toml)
const ATOM_REQUIRED_OPTIONS: Record<string, string[]> = {
  "market-trends": ["MODEL_API_KEY", "COINGECKO_API_KEY"],
  "token-info": ["MODEL_API_KEY", "COINGECKO_API_KEY"],
  "market-price": ["MODEL_API_KEY", "COINGECKO_API_KEY"],
  "oracle-price": ["MODEL_API_KEY"],
  "wallet-assets": ["MODEL_API_KEY", "HELIUS_API_KEY"],
};

function injectSecretsIntoSessionRequest(
  req: ReturnType<typeof compileMoleculeToSession>
): ReturnType<typeof compileMoleculeToSession> {
  const missing: string[] = [];
  for (const agent of req.agentGraphRequest.agents) {
    const atomType = agent.id.name;
    const required = ATOM_REQUIRED_OPTIONS[atomType];
    if (!required) continue; // debug agents (puppet/seed) don't need keys
    const options = { ...(agent.options ?? {}) };
    for (const key of required) {
      if (options[key]) continue; // already set by template
      const value = process.env[key];
      if (!value) {
        missing.push(`${agent.name} (${atomType}).${key}`);
        continue;
      }
      options[key] = { type: "string", value };
    }
    agent.options = options;
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing env values for required atom options: ${missing.join(", ")}. ` +
        `Set them in .env or export before running.`
    );
  }
  return req;
}

async function main() {
  const template = marketSignalPairwiseMolecule;
  const sessionRequest = injectSecretsIntoSessionRequest(
    compileMoleculeToSession(template)
  );

  console.log(
    JSON.stringify({ event: "compiling", molecule: template.name }, null, 0)
  );

  const created = await postJson<SessionIdentifier>(
    "/api/v1/local/session",
    sessionRequest
  );
  console.log(
    JSON.stringify({ event: "session-created", ...created }, null, 0)
  );

  const { sessionId, namespace } = created;

  const seed = template.seed;
  if (!seed) {
    throw new Error(
      `Pairwise template ${template.name} has no seed — aborting.`
    );
  }

  const participantNames = Array.from(
    new Set(template.groups.flat().filter((n) => n !== seed.agent))
  );

  const threadOut = await postJson<ThreadOutput>(
    `/api/v1/puppet/${encodeURIComponent(namespace)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(seed.agent)}/thread`,
    { threadName: seed.threadName, participantNames }
  );
  const threadId = threadOut.thread.id;
  console.log(JSON.stringify({ event: "thread-created", threadId }, null, 0));

  await postJson<unknown>(
    `/api/v1/puppet/${encodeURIComponent(namespace)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(seed.agent)}/thread/message`,
    {
      threadId,
      content: JSON.stringify(seed.message),
      mentions: seed.mentions ?? [],
    }
  );
  console.log(
    JSON.stringify({ event: "seed-message-sent", threadId }, null, 0)
  );

  const seenMessageIds = new Set<string>();
  const pollStart = Date.now();
  let observedAtomResult = false;

  while (Date.now() - pollStart < POLL_DURATION_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const state = await getJson<{
        threads?: Array<{
          id: string;
          messages?: Array<{
            id: string;
            senderName?: string;
            content?: string;
            [k: string]: unknown;
          }>;
        }>;
      }>(
        `/api/v1/local/session/${encodeURIComponent(namespace)}/${encodeURIComponent(sessionId)}/extended`
      );
      const thread = state.threads?.find((t) => t.id === threadId);
      if (!thread) continue;
      for (const msg of thread.messages ?? []) {
        if (seenMessageIds.has(msg.id)) continue;
        seenMessageIds.add(msg.id);
        console.log(
          JSON.stringify(
            {
              event: "thread-message",
              id: msg.id,
              sender: msg.senderName,
              content: msg.content,
            },
            null,
            0
          )
        );
        // Heuristic: parse JSON content, check for atom_result kind from info.
        if (typeof msg.content === "string") {
          try {
            const parsed = JSON.parse(msg.content);
            if (
              parsed &&
              parsed.kind === "atom_result" &&
              msg.senderName === "info"
            ) {
              observedAtomResult = true;
            }
          } catch {
            // non-JSON message — not a finalization signal
          }
        }
      }
      if (observedAtomResult) break;
    } catch (e) {
      console.error(
        JSON.stringify({
          event: "poll-error",
          error: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        event: "run-complete",
        sessionId,
        namespace,
        threadId,
        messageCount: seenMessageIds.size,
        observedAtomResult,
      },
      null,
      0
    )
  );

  try {
    const artifact = await buildRunArtifact({
      sessionId,
      threadId,
      atoms: template.atoms.map((a) => ({
        registryName: a.atom,
        sessionName: a.name,
      })),
      level: "pairwise",
      template: template.name,
      task: { seed: template.seed?.message ?? {} },
      coralApiUrl: CORAL_API_URL,
      coralAuthKey: CORAL_AUTH_KEY,
      notes: [
        `seed agent: ${template.seed?.agent ?? "unknown"}`,
        `observed atom_result: ${observedAtomResult}`,
      ],
    });
    const outPath = await writeRunArtifact(artifact, {
      secretsFromEnv: [
        process.env.MODEL_API_KEY ?? "",
        process.env.COINGECKO_API_KEY ?? "",
        process.env.HELIUS_API_KEY ?? "",
      ].filter(Boolean),
    });
    console.log(JSON.stringify({ event: "run-artifact-written", path: outPath }));
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "run-artifact-failed",
        error: e instanceof Error ? e.message : String(e),
      })
    );
  }

  process.exit(observedAtomResult ? 0 : 2);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      event: "run-failed",
      error: err instanceof Error ? err.message : String(err),
    })
  );
  process.exit(1);
});
