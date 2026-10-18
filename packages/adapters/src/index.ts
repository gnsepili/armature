import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Bumped whenever a template change alters generated output. Recorded in armature.lock. */
export const TEMPLATE_VERSION = "1";

/** Source checkout keeps templates next to src/; the bundled CLI copies them next to dist/index.js. */
function templatesRoot(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const candidate of [join(here, "..", "templates"), join(here, "templates")])
    if (existsSync(join(candidate, "common"))) return candidate;
  throw new Error(`Armature templates not found near ${here}; the installation looks incomplete`);
}

/** Ordered template layers for a framework: shared files first, then the adapter's own. */
export function templateLayers(framework: string): string[] {
  const root = templatesRoot();
  const layer = join(root, framework);
  if (!existsSync(layer)) throw new Error(`no templates for framework ${framework}`);
  return [join(root, "common"), layer];
}
