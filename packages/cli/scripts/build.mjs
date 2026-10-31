// Bundles the CLI into dist/armature.js and copies the assets it reads at runtime:
// project templates (dist/templates), the coding-agent handoff kit (dist/handoff) and the
// playground UI (dist/playground).
// Internal @armature/* packages are bundled; npm dependencies stay external.
import { chmodSync, cpSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
await build({
  entryPoints: [join(root, "src/bin.ts")],
  outfile: join(dist, "armature.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: Object.keys(pkg.dependencies ?? {}),
  legalComments: "none",
  logLevel: "warning",
});
chmodSync(join(dist, "armature.js"), 0o755);
cpSync(join(root, "../adapters/templates"), join(dist, "templates"), { recursive: true });
cpSync(join(root, "../handoff/templates"), join(dist, "handoff"), { recursive: true });
cpSync(join(root, "../playground/public"), join(dist, "playground"), { recursive: true });
console.log(`built ${pkg.name}@${pkg.version} -> dist/armature.js`);
