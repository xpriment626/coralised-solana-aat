import { defineMolecule } from "./manifest.js";

export const marketSignalPairwiseMolecule = defineMolecule({
  name: "market-signal-pairwise",
  description:
    "Minimal two-atom pairwise test: puppet seed → market-trends → token-info. " +
    "Exercises the mention-driven handoff path without a central coordinator.",
  atoms: [
    { atom: "market-trends", name: "trends" },
    { atom: "token-info", name: "info" },
  ],
  groups: [["trends", "info", "puppet"]],
  seed: {
    agent: "puppet",
    threadName: "pairwise-smoke",
    message: {
      kind: "atom_request",
      task_id: "pairwise-smoke",
      from: "puppet",
      to: "trends",
      capability: "market-trends",
      input: {
        ask: "What tokens are trending on Solana right now? Hand off promising candidates to token-info for metadata.",
      },
    },
    mentions: ["trends"],
  },
  runtime: {
    ttlMs: 5 * 60_000,
    holdAfterExitMs: 30_000,
  },
  evaluation: {
    testQuestions: [
      "Did market-trends call at least one agentkit.* tool?",
      "Did market-trends hand off to token-info via coral_send_message rather than through a coordinator?",
      "Did token-info call GET_COINGECKO_TOKEN_INFO_ACTION with a candidate surfaced by market-trends?",
    ],
    successSignals: [
      "At least one agentkit.* tool call per atom.",
      "An atom_request or atom_result message from trends mentions info.",
      "An atom_result from info references the token(s) trends surfaced.",
    ],
    failureSignals: [
      "Either atom only produces assistant text without any tool call (message_non_execution).",
      "No message from trends mentions info (handoff_missing).",
      "Info replies without referencing trends' candidates (context_lost).",
    ],
  },
});
