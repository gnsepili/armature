import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import Handlebars from "handlebars";
import type { PlannedTool, ProjectPlan } from "./plan.ts";

/** managed: regenerated while unmodified. generated-once: written at init, then owned by the user. */
export type Ownership = "managed" | "generated-once";

export interface RenderedFile {
  path: string;
  content: string;
  ownership: Ownership;
}

/** Python literal for a JSON value. JSON string escapes are valid Python string escapes. */
export function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "None";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(", ")}]`;
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => `${JSON.stringify(k)}: ${pyLiteral(v)}`,
  );
  return `{${entries.join(", ")}}`;
}

function engine() {
  const hb = Handlebars.create();
  hb.registerHelper("json", (v: unknown, indent: unknown) =>
    JSON.stringify(v, null, typeof indent === "number" ? indent : undefined),
  );
  hb.registerHelper("py", (v: unknown) => pyLiteral(v));
  hb.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  hb.registerHelper("ne", (a: unknown, b: unknown) => a !== b);
  hb.registerHelper("and", (...args: unknown[]) => args.slice(0, -1).every(Boolean));
  hb.registerHelper("or", (...args: unknown[]) => args.slice(0, -1).some(Boolean));
  hb.registerHelper("not", (v: unknown) => !v);
  hb.registerHelper("includes", (list: unknown, v: unknown) => Array.isArray(list) && list.includes(v));
  hb.registerHelper("upper", (s: unknown) => String(s).toUpperCase());
  hb.registerHelper("join", (list: unknown, s: unknown) =>
    Array.isArray(list) ? list.join(typeof s === "string" ? s : ", ") : "",
  );
  return hb;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Minimal glob: `*` matches within a path segment, `**` across segments. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else re += /[.+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${re}$`);
}

interface OwnershipRules {
  "generated-once"?: string[];
}

const OWNERSHIP_FILE = "ownership.json";

function outputPath(templatePath: string, plan: ProjectPlan, tool?: PlannedTool): string {
  return templatePath
    .split("/")
    .map((seg) => (seg.startsWith("dot_") ? `.${seg.slice(4)}` : seg))
    .join("/")
    .replaceAll("__pkg__", plan.package)
    .replaceAll("__tool__", tool?.name ?? "__tool__")
    .replace(/\.hbs$/, "");
}

/**
 * Renders template layers in order; a later layer replaces a file with the same output
 * path. Files whose rendered content is blank are omitted, which lets templates be
 * conditional on the plan.
 */
export function renderProject(plan: ProjectPlan, layers: string[]): RenderedFile[] {
  const hb = engine();
  const files = new Map<string, RenderedFile>();
  const onceGlobs: RegExp[] = [];
  for (const layer of layers) {
    try {
      const rules = JSON.parse(readFileSync(join(layer, OWNERSHIP_FILE), "utf8")) as OwnershipRules;
      for (const g of rules["generated-once"] ?? []) onceGlobs.push(globToRegExp(g));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  const ownershipOf = (path: string): Ownership =>
    onceGlobs.some((re) => re.test(path)) ? "generated-once" : "managed";

  for (const layer of layers) {
    for (const full of walk(layer)) {
      const rel = relative(layer, full).split(sep).join("/");
      if (rel === OWNERSHIP_FILE) continue;
      const source = readFileSync(full, "utf8");
      const isTemplate = rel.endsWith(".hbs");
      const template = isTemplate ? hb.compile(source, { noEscape: true, strict: true }) : null;
      const targets: (PlannedTool | undefined)[] = rel.includes("__tool__") ? plan.tools : [undefined];
      for (const tool of targets) {
        const path = outputPath(rel, plan, tool);
        let content = template ? template({ ...plan, tool }) : source;
        if (!content.trim()) {
          files.delete(path);
          continue;
        }
        content = content.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
        files.set(path, { path, content, ownership: ownershipOf(path) });
      }
    }
  }
  return [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
