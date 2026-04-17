import { defineMolecule } from "./manifest.js";

export const marketSignalMolecule = defineMolecule({
  name: "market-signal",
  purpose:
    "Test whether independent read-only market-data atoms can compose through Coral into a useful market signal workflow.",
  atoms: ["market-trends", "token-info", "market-price", "oracle-price", "wallet-assets"],
  testQuestions: [
    "Can trend results be enriched by a separate token-info atom?",
    "Can market and oracle prices be compared without one agent owning both tools?",
    "Can optional wallet exposure context join the workflow without becoming the orchestrator?",
  ],
  successSignals: [
    "Atoms call their own tools.",
    "At least two atoms exchange structured intermediate results.",
    "The final workflow result is inspectable and not just a prose relay.",
  ],
  failureSignals: [
    "Atoms defer action to each other without executing.",
    "Mentions or handoffs loop indefinitely.",
    "A single coordinator becomes necessary for every step.",
  ],
});
