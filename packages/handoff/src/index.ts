import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The coding-agent handoff kit: AGENTS.md, CLAUDE.md, docs/, skills and build-time docs MCP
 * config. Templates render through the same pipeline as the adapters; this module adds what
 * only the handoff needs: locating its layer, mirroring skills for Claude Code and checking
 * skill frontmatter.
 */

/** Canonical skills, read by Codex and other Agent Skills clients. */
export const CANONICAL_SKILLS = ".agents/skills/";
/** Claude Code reads only .claude/skills, so the canonical skills are copied there. */
export const CLAUDE_SKILLS = ".claude/skills/";

/** Structural copy of core's RenderedFile; core depends on this package, not the reverse. */
export interface HandoffFile {
  path: string;
  content: string;
  ownership: "managed" | "generated-once";
}

interface LockLike {
  files: Record<string, { sha256: string }>;
}

/** Source checkout keeps templates next to src/; the bundled CLI copies them to dist/handoff. */
export function handoffLayer(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const candidate of [join(here, "..", "templates"), join(here, "handoff")])
    if (existsSync(join(candidate, "AGENTS.md.hbs"))) return candidate;
  throw new Error(`Armature handoff templates not found near ${here}; the installation looks incomplete`);
}

const ROOT_FILES = new Set(["AGENTS.md", "CLAUDE.md", ".mcp.json", ".codex/config.toml"]);

/** Files `armature sync` refreshes: instructions, docs, skills and docs MCP config. */
export function isHandoffPath(path: string): boolean {
  return (
    ROOT_FILES.has(path) ||
    path.startsWith("docs/") ||
    path.startsWith(CANONICAL_SKILLS) ||
    path.startsWith(CLAUDE_SKILLS)
  );
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function walk(dir: string, prefix = ""): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name === ".DS_Store") continue;
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Adds a .claude/skills copy of every canonical skill file. With a project directory, the
 * copy follows what is on disk when the user owns it: a canonical file they edited (its hash
 * differs from the lock and force is off) or a skill they created that Armature does not
 * render. Copies are managed, so a copy whose canonical file disappears is cleaned up as an
 * orphan. Pure when `dir` is omitted.
 */
export function withSkillCopies(
  files: HandoffFile[],
  opts: { targets: string[]; dir?: string; previous?: LockLike | null; force?: boolean },
): HandoffFile[] {
  if (!opts.targets.includes("claude")) return files;
  const canonical = new Map<string, string>();
  for (const f of files) if (f.path.startsWith(CANONICAL_SKILLS)) canonical.set(f.path, f.content);

  if (opts.dir) {
    const root = join(opts.dir, CANONICAL_SKILLS);
    for (const rel of walk(root)) {
      const path = CANONICAL_SKILLS + rel;
      let onDisk: string;
      try {
        onDisk = readFileSync(join(root, rel), "utf8");
      } catch {
        continue;
      }
      const rendered = canonical.get(path);
      if (rendered === undefined) {
        canonical.set(path, onDisk); // a skill the user added
        continue;
      }
      const tracked = opts.previous?.files[path];
      const edited = tracked !== undefined && tracked.sha256 !== sha256(onDisk);
      if (edited && !opts.force) canonical.set(path, onDisk);
    }
  }

  const copies: HandoffFile[] = [...canonical.entries()].map(([path, content]) => ({
    path: CLAUDE_SKILLS + path.slice(CANONICAL_SKILLS.length),
    content,
    ownership: "managed",
  }));
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const c of copies) byPath.set(c.path, c);
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export interface SkillIssue {
  path: string;
  message: string;
}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Reads the YAML frontmatter fields this check needs: top-level `key: value` scalars. */
export function frontmatter(content: string): Record<string, string> | null {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content.replace(/\r\n/g, "\n"));
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2]!.trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    fields[kv[1]!] = value;
  }
  return fields;
}

/**
 * Checks a SKILL.md against the Agent Skills rules: a `name` of 1-64 lowercase letters,
 * digits and single hyphens that matches its directory, and a `description` of 1-1024
 * characters.
 */
export function validateSkill(path: string, content: string): SkillIssue[] {
  const issues: SkillIssue[] = [];
  const dirName = path.split("/").at(-2) ?? "";
  const fields = frontmatter(content);
  if (!fields) return [{ path, message: "missing YAML frontmatter (--- ... ---)" }];
  const name = fields.name ?? "";
  if (!name) issues.push({ path, message: "frontmatter has no name" });
  else {
    if (name.length > 64 || !SKILL_NAME.test(name))
      issues.push({
        path,
        message: `name "${name}" must be 1-64 lowercase letters, digits and single hyphens`,
      });
    if (name !== dirName)
      issues.push({ path, message: `name "${name}" does not match its directory "${dirName}"` });
  }
  const description = fields.description ?? "";
  if (!description) issues.push({ path, message: "frontmatter has no description" });
  else if (description.length > 1024)
    issues.push({ path, message: `description is ${description.length} characters (max 1024)` });
  return issues;
}

/** Validates every SKILL.md among the files. */
export function validateSkills(files: HandoffFile[]): SkillIssue[] {
  return files
    .filter((f) => f.path.startsWith(CANONICAL_SKILLS) && f.path.endsWith("/SKILL.md"))
    .flatMap((f) => validateSkill(f.path, f.content));
}
