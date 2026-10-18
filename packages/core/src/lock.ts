import { createHash } from "node:crypto";
import { z } from "zod";
import { ArmatureError, ExitCode } from "./errors.ts";
import type { Dependency } from "./plan.ts";
import type { Ownership, RenderedFile } from "./render.ts";
import { ARMATURE_VERSION, GENERATOR } from "./version.ts";

export const LOCK_FILE = "armature.lock";
export const LOCK_VERSION = 1;

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const LockSchema = z
  .object({
    lock_version: z.literal(LOCK_VERSION),
    generator: z.string(),
    generator_version: z.string(),
    template_version: z.string(),
    framework: z.string(),
    spec_sha256: z.string(),
    dependencies: z.record(z.string(), z.string()),
    files: z.record(
      z.string(),
      z.object({ ownership: z.enum(["managed", "generated-once"]), sha256: z.string() }),
    ),
  })
  .loose();
export type LockFile = z.infer<typeof LockSchema>;
export type LockEntry = { ownership: Ownership; sha256: string };

export function buildLock(opts: {
  framework: string;
  templateVersion: string;
  specText: string;
  dependencies: Dependency[];
  files: Record<string, LockEntry>;
}): LockFile {
  const files: Record<string, LockEntry> = {};
  for (const path of Object.keys(opts.files).sort()) files[path] = opts.files[path]!;
  const dependencies: Record<string, string> = {};
  for (const d of [...opts.dependencies].sort((a, b) => (a.name < b.name ? -1 : 1)))
    dependencies[d.name] = d.version;
  return {
    lock_version: LOCK_VERSION,
    generator: GENERATOR,
    generator_version: ARMATURE_VERSION,
    template_version: opts.templateVersion,
    framework: opts.framework,
    spec_sha256: sha256(opts.specText.replace(/\r\n/g, "\n")),
    dependencies,
    files,
  };
}

export const lockEntries = (files: RenderedFile[]): Record<string, LockEntry> =>
  Object.fromEntries(files.map((f) => [f.path, { ownership: f.ownership, sha256: sha256(f.content) }]));

export const serializeLock = (lock: LockFile) => `${JSON.stringify(lock, null, 2)}\n`;

export function parseLock(text: string): LockFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ArmatureError(`${LOCK_FILE} is not valid JSON`, ExitCode.validation, "restore it from git");
  }
  const parsed = LockSchema.safeParse(raw);
  if (!parsed.success)
    throw new ArmatureError(
      `${LOCK_FILE} has an unexpected shape: ${parsed.error.issues[0]?.message}`,
      ExitCode.validation,
      "restore it from git, or delete it and run `armature generate --force`",
    );
  return parsed.data;
}
