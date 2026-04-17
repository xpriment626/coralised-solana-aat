import { defineMolecule } from "./manifest.js";

export const marketSignalMolecule = defineMolecule({
  name: "market-signal",
  description:
    "Test whether independent read-only market-data atoms can compose through Coral into a useful market signal workflow. " +
    "Five atoms, one group, seed from puppet, read-only.",
  atoms: [
    { atom: "market-trends", name: "market-trends" },
    { atom: "token-info", name: "token-info" },
    { atom: "market-price", name: "market-price" },
    { atom: "oracle-price", name: "oracle-price" },
    { atom: "wallet-assets", name: "wallet-assets" },
  ],
  groups: [
    [
      "market-trends",
      "token-info",
      "market-price",
      "oracle-price",
      "wallet-assets",
      "puppet",
    ],
  ],
  seed: {
    agent: "puppet",
    threadName: "market-signal",
    message: {
      kind: "atom_request",
      task_id: "seed",
      from: "puppet",
      to: "market-trends",
      capability: "market-trends",
      input: {
        ask: "What tokens are trending on Solana right now?",
      },
    },
    mentions: ["market-trends"],
  },
  runtime: {
    ttlMs: 10 * 60_000,
    holdAfterExitMs: 30_000,
  },
  evaluation: {
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
  },
});
