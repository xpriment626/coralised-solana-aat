import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

import { redactSecrets } from "pi-coral-agent";

export const FAILURE_MODE_LABELS = [
  "runtime_connection_failure",
  "resource_refresh_failure",
  "tool_non_execution",
  "message_non_execution",
  "handoff_missing",
  "handoff_context_loss",
  "handoff_loop",
  "boundary_violation",
  "hidden_orchestration",
  "console_incompatibility",
  "single_agent_dominance",
] as const;
export type FailureModeLabel = (typeof FAILURE_MODE_LABELS)[number];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const RunArtifactSchema = z
  .object({
    run_id: z.string().min(1),
    date: z.string().regex(DATE_PATTERN, "date must be YYYY-MM-DD"),
    level: z.enum(["single_atom", "pairwise", "molecule", "baseline"]),
    template: z.string().min(1),
    console_compatible: z.boolean(),
    agents: z.array(z.string()).default([]),
    task: z.record(z.unknown()).default({}),
    observed_messages: z
      .array(
        z.object({
          id: z.string(),
          sender: z.string().optional(),
          content: z.string().optional(),
        })
      )
      .default([]),
    tool_calls: z
      .array(
        z.object({
          agent: z.string(),
          toolName: z.string(),
          iteration: z.number().int().nonnegative().optional(),
          finalized: z.boolean().optional(),
        })
      )
      .default([]),
    success: z.boolean(),
    // Accept any string but warn on unknown labels (soft validation).
    failure_modes: z.array(z.string()).default([]),
    notes: z.array(z.string()).default([]),
  })
  .strict();
export type RunArtifact = z.infer<typeof RunArtifactSchema>;

export interface WriteRunArtifactOptions {
  outDir?: string;
  secretsFromEnv?: string[];
}

export async function writeRunArtifact(
  artifact: RunArtifact,
  options: WriteRunArtifactOptions = {}
): Promise<string> {
  const parsed = RunArtifactSchema.parse(artifact);

  const unknownLabels = parsed.failure_modes.filter(
    (label) => !(FAILURE_MODE_LABELS as readonly string[]).includes(label)
  );
  if (unknownLabels.length > 0) {
    console.warn(
      JSON.stringify({
        event: "run-artifact-unknown-labels",
        run_id: parsed.run_id,
        labels: unknownLabels,
        note:
          "These labels are not in the failure-mode taxonomy. " +
          "Either update the taxonomy note/spec or fix the label.",
      })
    );
  }

  const outDir = options.outDir ?? ".coral-runs";
  const outPath = join(outDir, `${parsed.run_id}.json`);
  await mkdir(dirname(outPath), { recursive: true });
  const redacted = redactSecrets(parsed, options.secretsFromEnv ?? []);
  await writeFile(outPath, JSON.stringify(redacted, null, 2), "utf-8");
  return outPath;
}
