import { runAtom } from "pi-coral-agent";

import { buildMarketTrendsTools } from "./tools.js";

const { tools, secretsFromEnv } = buildMarketTrendsTools();

runAtom({ tools, secretsFromEnv }).catch((err) => {
  console.error("[market-trends] fatal:", err);
  process.exit(1);
});
