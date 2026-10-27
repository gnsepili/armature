import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ArmatureError, ExitCode } from "./errors.ts";
import { LOCK_FILE, type LockEntry, type LockFile, sha256 } from "./lock.ts";
import type { RenderedFile } from "./render.ts";

export type FileAction =
  /** New file written. */
  | "create"
  /** Managed file regenerated. */
  | "update"
  /** Already identical. */
  | "unchanged"
  /** Managed file edited by the user; left alone (use --force to overwrite). */
  | "skip-modified"
  /** Generated-once file, now owned by the user. */
  | "skip-owned"
  /** Managed file no longer produced by the templates, removed because it was unmodified. */
  | "remove"
  /** Managed file no longer produced, kept because the user edited it. */
  | "keep-orphan";

export interface PlannedAction {
  path: string;
  action: FileAction;
}

export interface WriteResult {
  actions: PlannedAction[];
  /** Lock entries to persist: what Armature last wrote for each file it tracks. */
  entries: Record<string, LockEntry>;
}

/** Entries that may exist in a fresh target directory without refusing init. */
const IGNORABLE = new Set([".git", ".DS_Store", "armature.yaml", LOCK_FILE]);

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function assertInitTarget(dir: string, force: boolean) {
  if (!existsSync(dir) || force) return;
  const extra = readdirSync(dir).filter((n) => !IGNORABLE.has(n));
  if (extra.length)
    throw new ArmatureError(
      `${dir} is not empty (${extra.slice(0, 3).join(", ")}${extra.length > 3 ? ", ..." : ""})`,
      ExitCode.overwriteRefused,
      "choose an empty directory, or pass --force to write into it",
    );
}

/**
 * Plans (and unless dryRun, applies) the file changes for a render. With no previous
 * lock every file is created. With a lock, managed files are updated only while their
 * on-disk content still matches what Armature last wrote.
 */
export function applyFiles(opts: {
  dir: string;
  files: RenderedFile[];
  previous: LockFile | null;
  force?: boolean;
  dryRun?: boolean;
}): WriteResult {
  const { dir, files, previous, force = false, dryRun = false } = opts;
  const actions: PlannedAction[] = [];
  const entries: Record<string, LockEntry> = {};
  const writes: RenderedFile[] = [];
  const removals: string[] = [];

  for (const file of files) {
    const target = join(dir, file.path);
    const current = read(target);
    const next = sha256(file.content);
    const before = previous?.files[file.path];
    const fresh: LockEntry = { ownership: file.ownership, sha256: next };

    if (current === null) {
      // A tracked generated-once file the user deleted stays deleted.
      if (before && file.ownership === "generated-once" && !force) {
        actions.push({ path: file.path, action: "skip-owned" });
        entries[file.path] = before;
        continue;
      }
      actions.push({ path: file.path, action: "create" });
      writes.push(file);
      entries[file.path] = fresh;
      continue;
    }
    const currentHash = sha256(current);
    if (currentHash === next) {
      actions.push({ path: file.path, action: "unchanged" });
      entries[file.path] = fresh;
      continue;
    }
    // Files the user owns (tools, prompts) are never overwritten once tracked, not even
    // with --force: force only applies to managed files.
    if (file.ownership === "generated-once" && previous) {
      actions.push({ path: file.path, action: "skip-owned" });
      entries[file.path] = before ?? fresh;
      continue;
    }
    const pristine = !previous || (before !== undefined && before.sha256 === currentHash);
    if (pristine || force) {
      actions.push({ path: file.path, action: "update" });
      writes.push(file);
      entries[file.path] = fresh;
    } else {
      actions.push({ path: file.path, action: "skip-modified" });
      if (before) entries[file.path] = before;
    }
  }

  const produced = new Set(files.map((f) => f.path));
  for (const [path, entry] of Object.entries(previous?.files ?? {})) {
    if (produced.has(path) || entry.ownership !== "managed") continue;
    const current = read(join(dir, path));
    if (current === null) continue;
    if (sha256(current) === entry.sha256 || force) {
      actions.push({ path, action: "remove" });
      removals.push(path);
    } else actions.push({ path, action: "keep-orphan" });
  }

  if (!dryRun) {
    for (const file of writes) {
      const target = join(dir, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    for (const path of removals) rmSync(join(dir, path), { force: true });
  }
  actions.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { actions, entries };
}
