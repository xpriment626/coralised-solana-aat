import { runAtom } from "pi-coral-agent";

import { buildTokenInfoTools } from "./tools.js";

const { tools, secretsFromEnv } = buildTokenInfoTools();

runAtom({ tools, secretsFromEnv }).catch((err) => {
  console.error("[token-info] fatal:", err);
  process.exit(1);
});
