import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path of the playground's static assets. Works from source
 * (packages/playground/src -> ../public) and from the bundled CLI
 * (dist/index.js with assets copied to dist/playground).
 */
export function playgroundDir(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const candidate of [join(here, "..", "public"), join(here, "playground")]) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  throw new Error(`Armature playground assets not found near ${here}`);
}
