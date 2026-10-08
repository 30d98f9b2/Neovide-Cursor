// Runs inside the Codex webview, where the composer selection is accessible.
class CodexCursorManager {
    constructor() {
        this.controller = new AbortController();
        const listen = (target, name, listener, capture = false) => target.addEventListener(name, listener, { capture, signal: this.controller.signal });
        this.canvas = document.createElement("canvas");
        this.canvas.dataset.neovideCodexCursor = "true";
        this.canvas.setAttribute("aria-hidden", "true");
        this.canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;opacity:0";
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext("2d");
        this.frame = 0;
        this.composing = false;
        this.editor = null;
        this.bridgeTransition = false;
        this.bridgeSequence = 0;
        this.lastPublished = null;
        this.resize();
        this.observer = new ResizeObserver(() => this.schedule(true));
        listen(document, "selectionchange", () => this.schedule());
        for (const name of ["input", "keyup", "pointerup", "focusin", "compositionupdate"]) {
            listen(document, name, () => this.schedule(), true);
        }
        listen(document, "focusout", () => this.schedule(), true);
        listen(document, "compositionstart", () => {
            this.composing = true;
            this.schedule();
        }, true);
        listen(document, "compositionend", () => {
            this.composing = false;
            this.schedule();
        }, true);
        listen(document, "scroll", () => this.schedule(true), true);
        listen(document, "visibilitychange", () => this.schedule(true));
        listen(window, "blur", () => this.hide());
        listen(window, "focus", () => this.schedule());
        listen(window, "message", event => {
            if (event.source !== window.top || event.data?.channel !== "neovide-codex-cursor-v2") return;
            if (event.data.sequence !== this.bridgeSequence) return;
            if (event.data.kind === "transition-start") {
                this.bridgeTransition = true;
                this.canvas.style.opacity = "0";
                this.hideNativeCaret();
            } else if (event.data.kind === "transition-end") {
                this.bridgeTransition = false;
                this.restoreCaret();
                this.physics = null;
                this.last = null;
                this.schedule(true);
            }
        });
        listen(window, "resize", () => {
            this.resize();
            this.schedule(true);
        });
        this.schedule(true);
    }

    dispose() {
        this.controller.abort();
        this.observer.disconnect();
        this.hide();
        this.canvas.remove();
        if (window.__neovideCodexCursor === this) delete window.__neovideCodexCursor;
    }

    resize() {
        const ratio = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(window.innerWidth * ratio);
        this.canvas.height = Math.round(window.innerHeight * ratio);
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    restoreCaret() {
        if (!this.hiddenEditor) return;
        if (this.originalCaret.value) {
            this.hiddenEditor.style.setProperty("caret-color", this.originalCaret.value, this.originalCaret.priority);
        } else {
            this.hiddenEditor.style.removeProperty("caret-color");
        }
        this.hiddenEditor = null;
    }

    hideNativeCaret() {
        if (this.hiddenEditor || !this.editor) return;
        this.hiddenEditor = this.editor;
        this.originalCaret = {
            value: this.editor.style.getPropertyValue("caret-color"),
            priority: this.editor.style.getPropertyPriority("caret-color"),
        };
        this.editor.style.setProperty("caret-color", "transparent", "important");
    }

    publish(rect, entering) {
        if (window.top === window) return;
        if (!entering && this.lastPublished && Math.abs(rect.x - this.lastPublished.x) < 0.1 && Math.abs(rect.y - this.lastPublished.y) < 0.1) return;
        let offset = { x: 0, y: 0 };
        let viewport = { width: window.innerWidth, height: window.innerHeight };
        try {
            const frame = window.frameElement?.getBoundingClientRect();
            if (frame) offset = { x: frame.left, y: frame.top };
            viewport = { width: window.parent.innerWidth, height: window.parent.innerHeight };
        } catch { /* Workbench can still use the outer webview bounds. */ }
        if (entering) this.bridgeSequence++;
        window.top.postMessage({
            channel: "neovide-codex-cursor-v2", kind: "caret", sequence: this.bridgeSequence,
            rect, offset, viewport, entering,
        }, "*");
        this.lastPublished = rect;
    }

    hide() {
        if (this.lastPublished && window.top !== window) {
            window.top.postMessage({ channel: "neovide-codex-cursor-v2", kind: "leave", sequence: this.bridgeSequence }, "*");
        }
        this.lastPublished = null;
        this.bridgeTransition = false;
        this.restoreCaret();
        this.canvas.style.opacity = "0";
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.last = null;
        this.physics = null;
    }

    schedule(snap = false) {
        this.snap = this.snap || snap;
        if (!this.frame) this.frame = requestAnimationFrame(() => this.tick());
    }

    getEditor() {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return null;
        // Restrict this adapter to the Codex composer, including edited messages.
        const editor = active.closest('[contenteditable="true"][role="textbox"], .ProseMirror[contenteditable="true"]');
        return editor?.closest("[data-codex-composer]") ? editor : null;
    }

    caretRect(editor) {
        const selection = window.getSelection();
        if (!selection?.rangeCount || !editor.contains(selection.focusNode)) return null;
        if (!selection.isCollapsed && !this.composing) return null;
        // During IME composition the selected marked text is not a normal selection.
        // Track its focus edge without changing the editor's real selection or DOM.
        const range = document.createRange();
        range.setStart(selection.focusNode, selection.focusOffset);
        range.collapse(true);
        const rect = [...range.getClientRects()].find(r => r.height > 0);
        if (rect) return { x: rect.left, y: rect.top, width: 2, height: rect.height };

        // Empty paragraphs (ProseMirror uses <p><br></p>) have no text range rect.
        const node = selection.focusNode;
        let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        const block = element.closest("p,div,pre,li") || editor;
        if (!editor.contains(block)) return null;
        const style = getComputedStyle(block);
        const bounds = block.getBoundingClientRect();
        const fontSize = parseFloat(style.fontSize) || 14;
        const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.5;
        // Only use the block fallback for an empty line, never guess a text position.
        if (block.textContent.length) return null;
        const rtl = style.direction === "rtl";
        return {
            x: rtl ? bounds.right - (parseFloat(style.paddingRight) || 0) - 2 : bounds.left + (parseFloat(style.paddingLeft) || 0),
            y: bounds.top + (parseFloat(style.paddingTop) || 0) + Math.max(0, (lineHeight - fontSize) / 2),
            width: 2,
            height: fontSize,
        };
    }

    tick() {
        this.frame = 0;
        const editor = this.getEditor();
        if (!editor || document.hidden || !document.hasFocus()) {
            this.hide();
            return;
        }
        if (editor !== this.editor) {
            this.hide();
            this.observer.disconnect();
            this.editor = editor;
            this.observer.observe(editor);
        }
        const entering = !this.lastPublished;
        const rect = this.caretRect(editor);
        if (!rect || rect.y < 0 || rect.y + rect.height > window.innerHeight || rect.x < 0 || rect.x > window.innerWidth) {
            this.hide();
            return;
        }
        const bounds = editor.getBoundingClientRect();
        if (rect.y + rect.height < bounds.top || rect.y > bounds.bottom) {
            this.hide();
            return;
        }
        this.publish(rect, entering);
        if (this.bridgeTransition) {
            this.last = rect;
            this.hideNativeCaret();
            this.canvas.style.opacity = "0";
            // Selection and composition events continue publishing target coordinates.
            return;
        }
        if (!this.physics) this.physics = createNeovideCursor({ canvas: this.canvas });
        this.physics.updateSize(rect.width, rect.height);
        const moved = !this.last || Math.abs(rect.x - this.last.x) > 0.1 || Math.abs(rect.y - this.last.y) > 0.1;
        if (moved) this.physics.move(rect.x, rect.y);
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        const snap = this.snap || !this.last;
        this.snap = false;
        const animating = this.physics.updateLoop(snap, true);
        this.last = rect;
        if (animating && !snap) {
            this.hideNativeCaret();
            this.canvas.style.opacity = "1";
            this.frame = requestAnimationFrame(() => this.tick());
        } else {
            this.restoreCaret();
            this.canvas.style.opacity = "0";
        }
    }
}

const startCodexCursor = () => {
    if (window.__neovideCodexCursor) return;
    window.__neovideCodexCursor = new CodexCursorManager();
};
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startCodexCursor, { once: true });
} else {
    startCodexCursor();
}
