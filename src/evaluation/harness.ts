import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { RunArtifact } from "./run-artifact.js";

interface BuildRunArtifactAtomRef {
  registryName: string; // the atom type, matches .coral-debug/<name>/
  sessionName: string; // the agent name in this session/graph
}

interface BuildRunArtifactParams {
  sessionId: string;
  threadId: string;
  atoms: BuildRunArtifactAtomRef[];
  level: RunArtifact["level"];
  template: string;
  task: Record<string, unknown>;
  coralApiUrl: string;
  coralAuthKey?: string;
  debugDir?: string;
  notes?: string[];
}

interface IterationPayload {
  iteration: number;
  toolCalls?: Array<{ toolName: string; args?: unknown }>;
  toolResults?: Array<{ toolName: string; result: unknown }>;
  finalized?: boolean;
}

interface ThreadMessage {
  id: string;
  senderName?: string;
  content?: string;
}

async function readAtomIterations(
  debugDir: string,
  atom: string,
  sessionId: string
): Promise<IterationPayload[]> {
  // Atoms run with cwd = agents/<name>/, so their `.coral-debug/` sits under
  // the atom directory. When invoked from the repo root the harness needs to
  // check the per-atom path in addition to the unified one.
  const candidates = [
    join(debugDir, atom, sessionId),
    join("agents", atom, ".coral-debug", atom, sessionId),
  ];
  for (const dir of candidates) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    const jsonFiles = entries.filter((e) => e.endsWith(".json"));
    if (jsonFiles.length === 0) continue;
    const results: IterationPayload[] = [];
    for (const file of jsonFiles) {
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const parsed = JSON.parse(raw) as IterationPayload;
        results.push(parsed);
      } catch {
        // skip corrupt artifact files
      }
    }
    results.sort((a, b) => (a.iteration ?? 0) - (b.iteration ?? 0));
    return results;
  }
  return [];
}

async function fetchThreadMessages(
  coralApiUrl: string,
  coralAuthKey: string | undefined,
  sessionId: string,
  threadId: string
): Promise<ThreadMessage[]> {
  const headers: Record<string, string> = {};
  if (coralAuthKey) headers.Authorization = `Bearer ${coralAuthKey}`;

  // Coral Server exposes thread content through the extended session state
  // endpoint; thread-level endpoints are GET-only for specific thread/msg
  // lookups, so the harness uses the state endpoint for completeness.
  // Namespace is not known here; caller must supply it via session state.
  // The caller passes the namespace as part of the state URL prefix if
  // needed — we fall back to scanning all namespaces.
  const namespaces = await getJson<Array<{ name: string }>>(
    coralApiUrl,
    coralAuthKey,
    "/api/v1/local/namespace"
  ).catch(() => [] as Array<{ name: string }>);

  for (const ns of namespaces) {
    const state = await getJson<{
      threads?: Array<{ id: string; messages?: ThreadMessage[] }>;
    }>(
      coralApiUrl,
      coralAuthKey,
      `/api/v1/local/session/${encodeURIComponent(ns.name)}/${encodeURIComponent(sessionId)}/extended`
    ).catch(() => null);
    if (!state || !state.threads) continue;
    const thread = state.threads.find((t) => t.id === threadId);
    if (thread && thread.messages) return thread.messages;
  }
  return [];
}

async function getJson<T>(
  apiUrl: string,
  authKey: string | undefined,
  path: string
): Promise<T> {
  const headers: Record<string, string> = {};
  if (authKey) headers.Authorization = `Bearer ${authKey}`;
  const res = await fetch(`${apiUrl}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function classifyFailureModes(
  toolCallsByAgent: Map<string, Array<{ toolName: string }>>,
  observedMessages: ThreadMessage[],
  expectedAtomResultFrom: string | null
): string[] {
  const labels = new Set<string>();

  for (const [agent, calls] of toolCallsByAgent.entries()) {
    if (calls.length === 0) {
      labels.add("tool_non_execution");
    }
    const coralMessageCalls = calls.filter(
      (c) => c.toolName === "coral_send_message"
    );
    if (coralMessageCalls.length === 0) {
      labels.add("message_non_execution");
    }
    // agent unused variable silencer
    void agent;
  }

  if (expectedAtomResultFrom) {
    const hasAtomResultFromExpected = observedMessages.some((msg) => {
      if (msg.senderName !== expectedAtomResultFrom) return false;
      if (typeof msg.content !== "string") return false;
      try {
        const parsed = JSON.parse(msg.content);
        return parsed && parsed.kind === "atom_result";
      } catch {
        return false;
      }
    });
    if (!hasAtomResultFromExpected) labels.add("handoff_missing");
  }

  return Array.from(labels);
}

export async function buildRunArtifact(
  params: BuildRunArtifactParams
): Promise<RunArtifact> {
  const debugDir = params.debugDir ?? ".coral-debug";

  const toolCalls: RunArtifact["tool_calls"] = [];
  const toolCallsByAgent = new Map<string, Array<{ toolName: string }>>();
  for (const atom of params.atoms) {
    const iterations = await readAtomIterations(
      debugDir,
      atom.registryName,
      params.sessionId
    );
    const perAgent: Array<{ toolName: string }> = [];
    for (const iter of iterations) {
      for (const call of iter.toolCalls ?? []) {
        toolCalls.push({
          agent: atom.sessionName,
          toolName: call.toolName,
          iteration: iter.iteration,
          finalized: iter.finalized,
        });
        perAgent.push({ toolName: call.toolName });
      }
    }
    toolCallsByAgent.set(atom.sessionName, perAgent);
  }

  const messages = await fetchThreadMessages(
    params.coralApiUrl,
    params.coralAuthKey,
    params.sessionId,
    params.threadId
  );

  // For pairwise, the expected atom_result sender is the last atom (session name).
  const expectedAtomResultFrom =
    params.level === "pairwise" && params.atoms.length > 0
      ? params.atoms[params.atoms.length - 1]!.sessionName
      : null;

  const failureModes = classifyFailureModes(
    toolCallsByAgent,
    messages,
    expectedAtomResultFrom
  );

  const observedAtomResult = messages.some((msg) => {
    if (typeof msg.content !== "string") return false;
    try {
      const parsed = JSON.parse(msg.content);
      return parsed && parsed.kind === "atom_result";
    } catch {
      return false;
    }
  });

  const today = new Date().toISOString().slice(0, 10);

  return {
    run_id: `${params.template}-${params.sessionId}`,
    date: today,
    level: params.level,
    template: params.template,
    console_compatible: true,
    agents: params.atoms.map((a) => a.sessionName),
    task: params.task,
    observed_messages: messages.map((m) => ({
      id: m.id,
      sender: m.senderName,
      content: m.content,
    })),
    tool_calls: toolCalls,
    success: observedAtomResult && failureModes.length === 0,
    failure_modes: failureModes,
    notes: params.notes ?? [],
  };
}
