"""Test installation against temporary extension fixtures, never the real editor."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("codex_install", REPO / "scripts/codex/install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.codex = self.root / "codex"
        (self.codex / "webview/assets").mkdir(parents=True)
        self.html = self.codex / "webview/index.html"
        self.original = '<html><head><script src="main.js"></script></head><body></body></html>'
        self.html.write_text(self.original)
        self.output = self.root / "output"
        self.source = REPO / "neovide-cursor.js"

    def test_install_is_idempotent_and_preserves_first_backup(self):
        bridge = installer.install(self.codex, self.source, self.output)
        first = self.html.read_text()
        installer.install(self.codex, self.source, self.output)
        self.assertEqual(first, self.html.read_text())
        self.assertEqual(first.count(installer.TAG), 1)
        self.assertEqual(self.html.with_name("index.html.neovide-codex.bak").read_text(), self.original)
        self.assertIn("MIT License", bridge.read_text())
        self.assertIn("NeovideWorkbenchBridge", bridge.read_text())
        self.assertIn("CodexCursorManager", (self.codex / "webview/assets/neovide-codex-cursor.js").read_text())

    def test_uninstall_preserves_unrelated_html_changes(self):
        installer.install(self.codex, self.source, self.output)
        self.html.write_text(self.html.read_text() + "<!-- unrelated update -->")
        installer.uninstall(self.codex)
        self.assertEqual(self.html.read_text(), self.original + "<!-- unrelated update -->")
        self.assertFalse((self.codex / "webview/assets/neovide-codex-cursor.js").exists())
        installer.uninstall(self.codex)
        self.assertEqual(self.html.read_text(), self.original + "<!-- unrelated update -->")

    def test_unexpected_codex_layout_has_no_side_effects(self):
        self.html.write_text("<html><body>changed upstream layout</body></html>")
        with self.assertRaises(ValueError):
            installer.install(self.codex, self.source, self.output)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.html.with_name("index.html.neovide-codex.bak").exists())
        self.assertFalse((self.codex / "webview/assets/neovide-codex-cursor.js").exists())

    def test_unexpected_physics_source_has_no_side_effects(self):
        invalid = self.root / "invalid.js"
        invalid.write_text("// no compatible physics engine")
        with self.assertRaises(ValueError):
            installer.install(self.codex, invalid, self.output)
        self.assertEqual(self.html.read_text(), self.original)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.html.with_name("index.html.neovide-codex.bak").exists())

    def test_find_registered_extension_with_custom_directory(self):
        extensions = self.root / "custom-extensions"
        extensions.mkdir()
        (extensions / "extensions.json").write_text(json.dumps([
            {"identifier": {"id": "other.extension"}, "relativeLocation": "other"},
            {"identifier": {"id": "openai.chatgpt"}, "relativeLocation": "codex-current"},
        ]))
        self.assertEqual(installer.find_extension(extensions, "openai.chatgpt"), extensions / "codex-current")
        self.assertIsNone(installer.find_extension(extensions, "missing.extension"))


if __name__ == "__main__":
    unittest.main()
