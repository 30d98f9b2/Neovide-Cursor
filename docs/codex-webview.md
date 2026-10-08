# Experimental Codex webview support

This optional adapter extends the existing Neovide physics to the Codex composer
(`openai.chatgpt`). It provides cursor animations inside the composer, including
IME marked text, and transitions between a Monaco editor and the Codex sidebar.

The implementation is a prototype for maintainer review. It has been manually
verified on macOS with Codex 26.1002.51308, Neovide Cursor 1.0.1, and Custom CSS
and JS Loader 7.5.1. Browser tests exercise nested frames and Chromium composition
input. Other operating systems and future Codex webview layouts are not yet verified.

## Install

Requirements: Python 3.8+, both extensions installed, and Neovide Cursor already
working through Custom CSS and JS Loader.

If your loader injects scripts before the document body exists, apply the
[DOM-ready initialization fix proposed in PR #4](https://github.com/30d98f9b2/Neovide-Cursor/pull/4)
to the existing Neovide script first, or use a release that includes it. This
adapter waits for DOM readiness independently.

From a checkout of this repository:

```sh
python3 scripts/codex/install.py
```

The installer patches the installed Codex `webview/index.html` to load a local
script and creates a workbench bridge under `~/.config/neovide-cursor/codex`.
It makes a backup of the original HTML before the first patch. It does not edit
VS Code settings or its workbench files directly.

Add the printed `file:` URL **after** the existing Neovide script URL in
`vscode_custom_css.imports`. Then run **Reload Custom CSS and JS**, followed by
**Developer: Reload Window**. Keep both imports: the bridge supplements the
existing workbench cursor manager.

For VS Code Insiders, portable installations, custom profiles, or Windows, pass
the appropriate paths explicitly:

```sh
python3 scripts/codex/install.py --extensions-dir "/path/to/extensions"
python3 scripts/codex/install.py --codex-dir "/path/to/openai.chatgpt-extension"
```

Use `--output-dir` to choose another generated-script directory. The installer
uses the installed Neovide script's user parameters when available; use
`--source-js /path/to/neovide-cursor.js` to select another source explicitly.
Re-run installation and reload after changing those parameters or updating Codex.
Updating VS Code also requires re-enabling Custom CSS and JS as usual.

## Remove

Remove the generated bridge URL from `vscode_custom_css.imports`, then run:

```sh
python3 scripts/codex/install.py --uninstall
```

Run **Reload Custom CSS and JS** and **Developer: Reload Window**. Removal
preserves unrelated changes to the Codex HTML; it removes only this adapter's tag
and asset. The original backup and generated bridge remain available locally.

## How it works

- `codex-adapter.js` runs inside the Codex webview. It measures the actual selection
  focus with a collapsed DOM Range, including noncollapsed IME marked-text selections.
  It never changes the editor text or selection and does not intercept keyboard input.
- `workbench-bridge.js` runs in VS Code's workbench. It records the active Monaco
  caret, translates nested webview coordinates, and paints cross-panel transitions
  on a workbench canvas. The original overlay is temporarily hidden during a transition.
- The bridge exchanges coordinates and transition state only. The workbench checks
  that the sender belongs to an iframe for `openai.chatgpt`; the webview accepts replies
  only from its top window. No prompt text or credentials are sent.
- The composer overlay restores the native caret after movement. A transition has
  an 800 ms limit, and disposal removes listeners, observers, and canvas overlays.

## Limitations

Codex webview assets are internal implementation details. Updates can remove the
patch or change its DOM, so installation is explicitly opt-in and must be repeated
after extension updates. A supported extension hook would be preferable if available.

The operating system's IME candidate window remains anchored to the native input
position; this adapter animates the visual caret only. Additional input methods
and accessibility settings need manual testing. Focus tracking currently handles
the active Monaco caret and the Codex composer; it is not a general webview API.

## Tests

Browser tests require Node.js 20 or later.

```sh
python3 -m unittest discover -s test/codex -p 'test_*.py'
cd test/codex
npm ci
npx playwright install chromium
npm test
```

The browser fixture uses two loopback origins and nested iframes. It verifies
both transition directions, coordinate offsets, typing during a transition,
subsequent local animation, IME marked-text tracking, Chinese text commitment,
and restoration of the native caret. It does not open or modify the user's VS Code.
