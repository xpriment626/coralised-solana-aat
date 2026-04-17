export type AtomRisk = "read" | "quote" | "sign" | "submit" | "payment" | "admin";

export interface AtomActionRef {
  packageName: string;
  actionName: string;
  risk: AtomRisk;
}

export interface AtomManifest {
  name: string;
  purpose: string;
  actions: AtomActionRef[];
  accepts: string[];
  returns: string[];
  handoffs: string[];
}

export function defineAtom(manifest: AtomManifest): AtomManifest {
  return manifest;
}
