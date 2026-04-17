import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Walks up from `startDir` looking for a .env file. Parses `KEY=VALUE` lines
 * (ignoring comments and blanks) and returns them as an object. Values keep
 * any surrounding quotes intact — callers strip if they need to. Does NOT
 * mutate `process.env`.
 */
export function loadDotEnv(startDir: string = process.cwd()): Record<string, string> {
  const path = findDotEnv(startDir);
  if (!path) return {};
  const text = readFileSync(path, "utf-8");
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function findDotEnv(startDir: string): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
