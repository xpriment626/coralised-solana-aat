export interface AgentKitAtomSelection {
  atomName: string;
  plugins: string[];
  allowedActions: string[];
}

export interface ActionFilterRule {
  actionName: string;
  enabled: boolean;
  reason?: string;
}

export function defineAtomSelection(
  selection: AgentKitAtomSelection
): AgentKitAtomSelection {
  return selection;
}
