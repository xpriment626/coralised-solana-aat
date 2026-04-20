import { runAtom } from "pi-coral-agent";

import { buildMarketPriceTools } from "./tools.js";

const { tools, secretsFromEnv } = buildMarketPriceTools();

runAtom({ tools, secretsFromEnv }).catch((err) => {
  console.error("[market-price] fatal:", err);
  process.exit(1);
});
