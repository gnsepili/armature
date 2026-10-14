/**
 * Writes the published JSON Schemas to schemas/. Run with `pnpm schemas`;
 * CI checks that the committed files match (`pnpm schemas --check`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonSchemas } from "../packages/schema/src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "schemas");
const check = process.argv.includes("--check");
mkdirSync(outDir, { recursive: true });

let stale = 0;
for (const [file, schema] of Object.entries(jsonSchemas())) {
  const path = join(outDir, file);
  const text = `${JSON.stringify(schema, null, 2)}\n`;
  if (check) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {}
    if (current !== text) {
      console.error(`stale: schemas/${file}`);
      stale++;
    }
  } else {
    writeFileSync(path, text);
    console.log(`wrote schemas/${file}`);
  }
}
if (stale) {
  console.error("run `pnpm schemas` and commit the result");
  process.exit(1);
}
