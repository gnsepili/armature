import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArmatureError } from "../src/errors.ts";
import { buildLock, lockEntries, parseLock, serializeLock } from "../src/lock.ts";
import type { RenderedFile } from "../src/render.ts";
import { applyFiles, assertInitTarget } from "../src/write.ts";

const files = (v: string): RenderedFile[] => [
  { path: "pyproject.toml", content: `version = "${v}"\n`, ownership: "managed" },
  { path: "src/app/tools/lookup.py", content: `# ${v}\n`, ownership: "generated-once" },
];

const lockFor = (fs: RenderedFile[]) =>
  buildLock({
    framework: "langgraph",
    templateVersion: "1",
    specText: "name: x\n",
    dependencies: [
      { name: "b", version: "2" },
      { name: "a", version: "1" },
    ],
    files: lockEntries(fs),
  });

const tmp = () => mkdtempSync(join(tmpdir(), "armature-write-"));
const action = (r: ReturnType<typeof applyFiles>, path: string) =>
  r.actions.find((a) => a.path === path)?.action;

describe("lock", () => {
  it("is deterministic and round-trips", () => {
    const text = serializeLock(lockFor(files("1")));
    expect(serializeLock(lockFor(files("1")))).toBe(text);
    expect(Object.keys(parseLock(text).dependencies)).toEqual(["a", "b"]);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects a corrupt lock", () => {
    expect(() => parseLock("{")).toThrow(ArmatureError);
  });
});

describe("applyFiles", () => {
  it("creates, then updates only pristine managed files", () => {
    const dir = tmp();
    const first = applyFiles({ dir, files: files("1"), previous: null });
    expect(first.actions.map((a) => a.action)).toEqual(["create", "create"]);
    const previous = lockFor(files("1"));

    const second = applyFiles({ dir, files: files("2"), previous });
    expect(action(second, "pyproject.toml")).toBe("update");
    expect(action(second, "src/app/tools/lookup.py")).toBe("skip-owned");
    expect(readFileSync(join(dir, "src/app/tools/lookup.py"), "utf8")).toBe("# 1\n");

    writeFileSync(join(dir, "pyproject.toml"), "edited\n");
    const third = applyFiles({ dir, files: files("3"), previous: lockFor(files("2")) });
    expect(action(third, "pyproject.toml")).toBe("skip-modified");
    expect(readFileSync(join(dir, "pyproject.toml"), "utf8")).toBe("edited\n");

    const forced = applyFiles({ dir, files: files("3"), previous: lockFor(files("2")), force: true });
    expect(action(forced, "pyproject.toml")).toBe("update");
  });

  it("removes orphaned managed files only when unmodified", () => {
    const dir = tmp();
    const old: RenderedFile[] = [
      ...files("1"),
      { path: "old.py", content: "x\n", ownership: "managed" },
      { path: "kept.py", content: "y\n", ownership: "managed" },
    ];
    applyFiles({ dir, files: old, previous: null });
    writeFileSync(join(dir, "kept.py"), "mine\n");
    const r = applyFiles({ dir, files: files("1"), previous: lockFor(old) });
    expect(action(r, "old.py")).toBe("remove");
    expect(action(r, "kept.py")).toBe("keep-orphan");
    expect(existsSync(join(dir, "old.py"))).toBe(false);
    expect(existsSync(join(dir, "kept.py"))).toBe(true);
  });

  it("writes nothing on a dry run", () => {
    const dir = tmp();
    const r = applyFiles({ dir, files: files("1"), previous: null, dryRun: true });
    expect(r.actions).toHaveLength(2);
    expect(existsSync(join(dir, "pyproject.toml"))).toBe(false);
  });
});

describe("assertInitTarget", () => {
  it("refuses a non-empty directory unless forced", () => {
    const dir = tmp();
    writeFileSync(join(dir, "armature.yaml"), "x");
    expect(() => assertInitTarget(dir, false)).not.toThrow();
    writeFileSync(join(dir, "main.py"), "x");
    expect(() => assertInitTarget(dir, false)).toThrow(/not empty/);
    expect(() => assertInitTarget(dir, true)).not.toThrow();
  });
});
