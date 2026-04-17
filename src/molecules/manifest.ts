import { z } from "zod";

// Console `TemplateV1` wrapper intentionally omitted. `TemplateV1` is a
// Console-side localStorage/download format where `payload.data` is
// `JSON.stringify(CreateSessionRequest)`; the REST session endpoint accepts
// the raw `CreateSessionRequest` directly, so the wrapper adds no value for
// programmatic runs. Re-add when/if downloadable Console templates become
// a requirement.

export const MoleculeAtomSchema = z.object({
  atom: z.string(),
  name: z.string(),
  prompt: z.string().optional(),
  options: z.record(z.unknown()).optional(),
  blocking: z.boolean().optional(),
});
export type MoleculeAtom = z.infer<typeof MoleculeAtomSchema>;

export const MoleculeSeedSchema = z.object({
  agent: z.string(),
  threadName: z.string(),
  message: z.unknown(),
  mentions: z.array(z.string()).default([]),
});
export type MoleculeSeed = z.infer<typeof MoleculeSeedSchema>;

export const MoleculeRuntimeSchema = z.object({
  ttlMs: z.number().int().positive(),
  holdAfterExitMs: z.number().int().nonnegative().optional(),
});
export type MoleculeRuntime = z.infer<typeof MoleculeRuntimeSchema>;

export const MoleculeEvaluationSchema = z.object({
  testQuestions: z.array(z.string()).default([]),
  successSignals: z.array(z.string()).default([]),
  failureSignals: z.array(z.string()).default([]),
});
export type MoleculeEvaluation = z.infer<typeof MoleculeEvaluationSchema>;

export const MoleculeTemplateSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  atoms: z.array(MoleculeAtomSchema).min(1),
  groups: z.array(z.array(z.string()).min(1)).min(1),
  seed: MoleculeSeedSchema.optional(),
  runtime: MoleculeRuntimeSchema,
  evaluation: MoleculeEvaluationSchema.optional(),
});
export type MoleculeTemplate = z.infer<typeof MoleculeTemplateSchema>;

export function defineMolecule(template: MoleculeTemplate): MoleculeTemplate {
  return MoleculeTemplateSchema.parse(template);
}

export function validateMoleculeTemplate(
  template: MoleculeTemplate
): MoleculeTemplate {
  const parsed = MoleculeTemplateSchema.safeParse(template);
  if (!parsed.success) {
    throw new Error(
      `Invalid molecule template "${(template as { name?: string }).name ?? "?"}": ` +
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")
    );
  }
  // Cross-field check: every atom.name referenced in groups and seed must
  // match an atom entry.
  const names = new Set(parsed.data.atoms.map((a) => a.name));
  for (const group of parsed.data.groups) {
    for (const member of group) {
      if (!names.has(member) && !isExternalMember(member)) {
        throw new Error(
          `Group member "${member}" is neither an atom name nor an external participant (puppet/seed). ` +
            `Add it to atoms[] or use a recognized external name.`
        );
      }
    }
  }
  if (parsed.data.seed) {
    const agent = parsed.data.seed.agent;
    if (!names.has(agent) && !isExternalMember(agent)) {
      throw new Error(
        `Seed agent "${agent}" is not an atom or known external participant.`
      );
    }
  }
  return parsed.data;
}

const EXTERNAL_NAMES = new Set(["puppet", "seed"]);
function isExternalMember(name: string): boolean {
  return EXTERNAL_NAMES.has(name);
}
