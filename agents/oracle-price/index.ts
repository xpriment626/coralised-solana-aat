import { runAtom } from "pi-coral-agent";

import { buildOraclePriceTools } from "./tools.js";

const { tools, secretsFromEnv } = buildOraclePriceTools();

runAtom({ tools, secretsFromEnv }).catch((err) => {
  console.error("[oracle-price] fatal:", err);
  process.exit(1);
});
