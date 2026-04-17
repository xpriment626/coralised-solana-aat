export interface MoleculeManifest {
  name: string;
  purpose: string;
  atoms: string[];
  testQuestions: string[];
  successSignals: string[];
  failureSignals: string[];
}

export function defineMolecule(manifest: MoleculeManifest): MoleculeManifest {
  return manifest;
}
