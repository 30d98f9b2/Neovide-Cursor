#!/usr/bin/env python3
"""Build the optional Codex adapter and patch its local webview entry point."""
import argparse
import json
from pathlib import Path
import shutil

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_DIR = SCRIPT_DIR.parents[1]
TAG = '    <script type="module" src="./assets/neovide-codex-cursor.js" data-neovide-codex="true"></script>\n'


def find_extension(extensions_dir, identifier):
    metadata = extensions_dir / "extensions.json"
    if not metadata.is_file():
        return None
    for item in reversed(json.loads(metadata.read_text(encoding="utf-8"))):
        if item.get("identifier", {}).get("id") == identifier:
            return extensions_dir / item["relativeLocation"]
    return None


def build_scripts(source_js):
    source = source_js.read_text(encoding="utf-8")
    marker = "class GlobalCursorManager {"
    if source.count(marker) != 1:
        raise ValueError("Unexpected Neovide source layout; no files changed.")
    physics = source.split(marker)[0]
    license_header = "/*\n" + (REPO_DIR / "LICENSE").read_text(encoding="utf-8") + "\n*/\n"

    def bundle(filename):
        adapter = (SCRIPT_DIR / filename).read_text(encoding="utf-8")
        return license_header + "(() => {\n" + physics + "\n" + adapter + "\n})();\n"

    return bundle("codex-adapter.js"), bundle("workbench-bridge.js")


def install(codex_dir, source_js, output_dir):
    html_path = codex_dir / "webview/index.html"
    html = html_path.read_text(encoding="utf-8")
    if html.count("</head>") != 1 or not (codex_dir / "webview/assets").is_dir():
        raise ValueError("Unexpected Codex webview layout; no files changed.")
    adapter, bridge = build_scripts(source_js)
    backup = html_path.with_name("index.html.neovide-codex.bak")
    if not backup.exists():
        shutil.copy2(html_path, backup)
    output_dir.mkdir(parents=True, exist_ok=True)
    bridge_path = output_dir / "neovide-workbench.js"
    (codex_dir / "webview/assets/neovide-codex-cursor.js").write_text(adapter, encoding="utf-8")
    bridge_path.write_text(bridge, encoding="utf-8")
    if TAG not in html:
        html_path.write_text(html.replace("</head>", TAG + "</head>"), encoding="utf-8")
    return bridge_path


def uninstall(codex_dir):
    html_path = codex_dir / "webview/index.html"
    html = html_path.read_text(encoding="utf-8")
    # Remove only our script tag, preserving other changes to the extension HTML.
    html_path.write_text(html.replace(TAG, ""), encoding="utf-8")
    (codex_dir / "webview/assets/neovide-codex-cursor.js").unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extensions-dir", type=Path, default=Path.home() / ".vscode/extensions",
                        help="VS Code extensions directory; override for other installations")
    parser.add_argument("--codex-dir", type=Path, help="Explicit installed openai.chatgpt extension directory")
    parser.add_argument("--source-js", type=Path, help="Neovide script whose physics and user settings should be reused")
    parser.add_argument("--output-dir", type=Path, default=Path.home() / ".config/neovide-cursor/codex")
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()
    try:
        codex_dir = args.codex_dir or find_extension(args.extensions_dir, "openai.chatgpt")
        if codex_dir is None:
            parser.error("Codex extension not found. Use --codex-dir to specify its installation.")
        if args.uninstall:
            uninstall(codex_dir)
            print("Removed the Codex adapter. Remove the bridge URL from Custom CSS imports, then reload VS Code.")
            return
        neovide_dir = find_extension(args.extensions_dir, "30d98f9b2.neovide-cursor")
        source_js = args.source_js or ((neovide_dir / "neovide-cursor.js") if neovide_dir else REPO_DIR / "neovide-cursor.js")
        bridge_path = install(codex_dir, source_js, args.output_dir.expanduser().resolve())
        print(f"Physics source: {source_js}")
        print("Add this URL AFTER your existing Neovide import in vscode_custom_css.imports:")
        print(bridge_path.as_uri())
        print("Run Reload Custom CSS and JS, then Developer: Reload Window.")
        print("Re-run this installer after Codex extension updates or Neovide parameter changes.")
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
