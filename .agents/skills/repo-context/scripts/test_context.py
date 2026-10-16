"""Behavioral checks; all writes are isolated in disposable test repositories."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


context, installer = load("context"), load("install")
prompt_verifier = load("verify_prompts")


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="repo-context-test-")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name).resolve()
        self.write("src/main.py", "def run(): return 1\n")
        self.write(".ai/agents.md", "# Project\n[Main](modules/main.md)\n")
        self.write(".ai/README.md", "# Context\n[Start](agents.md)\n")
        self.write(".ai/modules/main.md", "# Main\n[Source](../../src/main.py)\n")
        self.write(".ai/architecture/module-interactions.md", "# Architecture\n[Main](../modules/main.md)\n")
        self.config = {"schema_version": 1, "source_roots": ["src"], "ignore": [], "excluded_sources": [],
                       "documents": [
                           {"path": ".ai/agents.md", "sources": [], "related": [".ai/modules/main.md"]},
                           {"path": ".ai/README.md", "sources": [], "related": []},
                           {"path": ".ai/modules/main.md", "sources": ["src/**"], "related": []},
                           {"path": ".ai/architecture/module-interactions.md", "sources": ["src/main.py"], "related": [".ai/modules/main.md"]},
                       ], "bootstrap": {"completed_steps": ["0", "1", "2", "3", "4"], "skipped_steps": {"1.5": "Internal library"}}}
        self.save_map()

    def write(self, path, text):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def save_map(self):
        self.write(".ai/context-map.json", json.dumps(self.config))

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True, text=True).stdout.strip()

    def init_git(self):
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")

    def test_valid_map_and_links(self):
        self.assertTrue(context.validate(self.repo, context.load_map(self.repo))["valid"])

    def test_missing_link_and_unmapped_source(self):
        self.write(".ai/modules/main.md", "[Missing](../../src/gone.py)\n")
        self.config["documents"][2]["sources"] = ["src/main.py"]
        self.write("src/new.py", "pass\n")
        result = context.validate(self.repo, self.config)
        self.assertFalse(result["valid"])
        self.assertTrue(any("Unmapped source: src/new.py" in e for e in result["errors"]))
        self.assertTrue(any("Broken link:" in e for e in result["errors"]))

    def test_impact_deletion_related_and_unmapped(self):
        result = context.impact(self.repo, self.config, ["src/main.py", "new-service/app.py", ".ai/agents.md"])
        self.assertIn(".ai/modules/main.md", result["direct"])
        self.assertIn(".ai/agents.md", result["related_candidates"])
        self.assertEqual(result["unmapped_changes"], ["new-service/app.py"])
        self.assertEqual(result["changed_context"], [".ai/agents.md"])

    def test_git_base_includes_committed_staged_unstaged_and_untracked(self):
        self.init_git()
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        base = self.git("rev-parse", "HEAD")
        self.write("src/committed.py", "pass\n")
        self.git("add", ".")
        self.git("commit", "-qm", "new module")
        self.write("src/main.py", "def run(): return 2\n")
        self.write("src/staged.py", "pass\n")
        self.git("add", "src/staged.py")
        self.write("src/untracked.py", "pass\n")
        self.assertEqual(context.changed(self.repo, base), ["src/committed.py", "src/main.py", "src/staged.py", "src/untracked.py"])
        self.assertNotIn("src/committed.py", context.changed(self.repo, None))

    def test_unborn_git_and_non_git_explicit_paths(self):
        self.assertIn(".ai/modules/main.md", context.impact(self.repo, self.config, ["src/main.py"])["direct"])
        self.init_git()
        self.git("add", "src/main.py")
        self.write("src/main.py", "changed\n")
        self.assertIn("src/main.py", context.changed(self.repo, None))

    def test_git_inventory_respects_ignores_but_keeps_tracked_and_untracked(self):
        self.init_git()
        self.write(".gitignore", "cache/\n")
        self.write("cache/local.py", "pass\n")
        self.write("src/new.py", "pass\n")
        self.git("add", "src/main.py")
        result = context.files(self.repo, self.config)
        self.assertIn("src/main.py", result)
        self.assertIn("src/new.py", result)
        self.assertNotIn("cache/local.py", result)

    def test_git_rename_exposes_deleted_and_new_paths(self):
        self.init_git()
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.git("mv", "src/main.py", "src/renamed.py")
        self.assertEqual(context.changed(self.repo, None), ["src/main.py", "src/renamed.py"])
        self.assertTrue(any("src/main.py" in e for e in context.validate(self.repo, self.config)["errors"]))

    def test_inventory_excludes_credentials_builds_and_symlinks(self):
        self.write(".env.secrets", "not a real secret")
        self.write("node_modules/lib/index.js", "pass")
        self.write("src/generated/out.py", "pass")
        (self.repo / "src/link.py").symlink_to(self.repo / "src/main.py")
        self.config["excluded_sources"] = [{"pattern": "src/generated/**", "reason": "Generated"}]
        self.assertEqual(context.files(self.repo, self.config), ["src/main.py"])

    def test_map_traversal_duplicate_and_conflicting_phases(self):
        self.config["documents"][0]["sources"] = ["../outside/**"]
        self.save_map()
        with self.assertRaises(ValueError):
            context.load_map(self.repo)
        self.config["documents"][0]["sources"] = []
        self.config["bootstrap"]["completed_steps"].append("1.5")
        self.save_map()
        with self.assertRaises(ValueError):
            context.load_map(self.repo)
        self.config["bootstrap"]["completed_steps"].remove("1.5")
        self.config["documents"].append(self.config["documents"][0])
        self.save_map()
        with self.assertRaises(ValueError):
            context.load_map(self.repo)

    def test_optional_artifact_does_not_skip_architecture_phase(self):
        self.config["bootstrap"]["omitted_artifacts"] = {".ai/architecture/data-model.md": "Stateless library"}
        self.save_map()
        self.assertTrue(context.validate(self.repo, context.load_map(self.repo))["valid"])
        self.config["bootstrap"]["completed_steps"].remove("2")
        self.config["bootstrap"]["skipped_steps"]["2"] = "No data model"
        self.save_map()
        with self.assertRaises(ValueError):
            context.load_map(self.repo)

    def test_install_preserves_rules_and_is_idempotent(self):
        self.write("AGENTS.md", "Keep CLI output stable.\n")
        result = installer.install(self.repo, claude=True)
        first = (self.repo / "AGENTS.md").read_bytes()
        self.assertTrue(first.startswith(b"Keep CLI output stable.\n"))
        self.assertGreater(result["copied_files"], 0)
        second = installer.install(self.repo, claude=True)
        self.assertEqual(second["copied_files"], 0)
        self.assertEqual((self.repo / "AGENTS.md").read_bytes(), first)
        self.assertTrue((self.repo / ".agents/skills/repo-context/SKILL.md").exists())

    def test_install_preserves_complete_original_prompts_and_detects_truncation(self):
        installer.install(self.repo)
        skill = self.repo / ".agents/skills/repo-context"
        source = Path(__file__).resolve().parents[1] / "prompts"
        result = prompt_verifier.verify(skill, source)
        self.assertTrue(result["valid"], result)
        self.assertEqual(result["prompt_files"], 13)
        prompt = skill / "prompts/step-3-generate-module-contexts.md"
        prompt.write_bytes(prompt.read_bytes()[:100])
        self.assertFalse(prompt_verifier.verify(skill)["valid"])

    def test_prompt_verifier_detects_missing_and_extra_originals(self):
        installer.install(self.repo)
        skill = self.repo / ".agents/skills/repo-context"
        original = skill / "prompts/step-0-extract-global-context.md"
        original.rename(skill / "prompts/unexpected.md")
        result = prompt_verifier.verify(skill)
        self.assertFalse(result["valid"])
        self.assertTrue(any("Prompt set mismatch" in error for error in result["errors"]))

    def test_install_conflict_preflight_does_not_change_rules(self):
        self.write("AGENTS.md", "Original rule\n")
        self.write(".agents/skills/repo-context/SKILL.md", "User version\n")
        with self.assertRaises(ValueError):
            installer.install(self.repo)
        self.assertEqual((self.repo / "AGENTS.md").read_text(), "Original rule\n")
        self.assertFalse((self.repo / ".agents/skills/repo-context/scripts").exists())

    def test_install_symlink_preflight(self):
        (self.repo / "AGENTS.md").symlink_to(self.repo / "README.md")
        with self.assertRaises(ValueError):
            installer.install(self.repo)
        self.assertFalse((self.repo / ".agents").exists())

    def test_glob_root_and_nested(self):
        self.assertTrue(context.matches("app.py", "**/*.py"))
        self.assertTrue(context.matches("src/app.py", "src/**/*.py"))
        self.assertTrue(context.matches("src/sub/app.py", "src/**/*.py"))
        self.assertFalse(context.matches("src2/app.py", "src/**"))


if __name__ == "__main__":
    unittest.main()
