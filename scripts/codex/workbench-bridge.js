// Coordinates only: no prompt text, key events, or VS Code extension messages.
class NeovideWorkbenchBridge {
    constructor() {
        this.controller = new AbortController();
        const listen = (target, name, listener, capture = false) => target.addEventListener(name, listener, { capture, signal: this.controller.signal });
        this.owner = null;
        this.last = null;
        this.transition = null;
        this.frame = 0;
        this.canvas = document.createElement("canvas");
        this.canvas.dataset.neovideCrossCursor = "true";
        this.canvas.setAttribute("aria-hidden", "true");
        this.canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;opacity:0";
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext("2d");
        // Tag the existing workbench overlay so a cross-panel animation can take over.
        for (const canvas of document.querySelectorAll("body > canvas")) {
            if (canvas !== this.canvas && canvas.style.zIndex === "9999") canvas.dataset.neovideWorkbenchCursor = "true";
        }
        const style = document.createElement("style");
        style.textContent = `
            html[data-neovide-crossing] canvas[data-neovide-workbench-cursor] { opacity: 0 !important; }
            html[data-neovide-crossing="editor"] .monaco-editor .cursor { opacity: 0 !important; }
        `;
        document.head.appendChild(style);
        this.style = style;
        this.resize();
        listen(window, "message", event => this.receive(event));
        listen(document, "focusin", () => this.trackEditor(), true);
        listen(document, "pointerup", () => this.trackEditor(), true);
        listen(window, "resize", () => { this.finish(); this.resize(); });
        listen(window, "blur", () => {
            // Switching into a webview also blurs this window; wait for its caret message.
            if (!document.hasFocus()) this.finish();
        });
        this.trackEditor();
    }

    dispose() {
        this.controller.abort();
        this.finish();
        if (this.editorFrame) cancelAnimationFrame(this.editorFrame);
        this.canvas.remove();
        this.style.remove();
        if (window.__neovideCodexBridge === this) delete window.__neovideCodexBridge;
    }

    resize() {
        const ratio = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(window.innerWidth * ratio);
        this.canvas.height = Math.round(window.innerHeight * ratio);
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    editorRect() {
        const active = document.activeElement;
        const editor = active?.closest?.(".monaco-editor");
        if (!editor) return null;
        const cursor = [...editor.querySelectorAll(".cursor")].find(element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.height > 0 && rect.width > 0 && style.display !== "none" && style.visibility !== "hidden" && rect.x >= 0 && rect.y >= 0;
        });
        if (!cursor) return null;
        const rect = cursor.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }

    trackEditor() {
        const rect = this.editorRect();
        if (!rect) return;
        const moved = !this.last || Math.abs(rect.x - this.last.x) > 0.1 || Math.abs(rect.y - this.last.y) > 0.1;
        if (this.owner === "codex" && this.last) this.begin(this.last, rect, "editor");
        this.owner = "editor";
        this.last = rect;
        if (this.transition?.owner === "editor" && moved) {
            this.transition.physics.updateSize(rect.width, rect.height);
            this.transition.physics.move(rect.x, rect.y);
        }
        if (!this.editorFrame) {
            this.editorFrame = requestAnimationFrame(() => {
                this.editorFrame = 0;
                this.trackEditor();
            });
        }
    }

    webviewFor(source) {
        // Cross-origin WindowProxy exposes indexed child frames without exposing DOM.
        const contains = (frame, depth) => {
            if (frame === source) return true;
            if (!depth) return false;
            try {
                for (let i = 0; i < Math.min(frame.length, 8); i++) {
                    if (contains(frame[i], depth - 1)) return true;
                }
            } catch { return false; }
            return false;
        };
        return [...document.querySelectorAll("iframe")].find(iframe => {
            try {
                return new URL(iframe.src).searchParams.get("extensionId") === "openai.chatgpt" && contains(iframe.contentWindow, 3);
            } catch { return false; }
        });
    }

    receive(event) {
        const message = event.data;
        if (message?.channel !== "neovide-codex-cursor-v2") return;
        const webview = this.webviewFor(event.source);
        if (!webview || !Number.isSafeInteger(message.sequence)) return;
        if (message.kind === "leave") {
            if (this.transition?.owner === "codex" && this.transition.source === event.source) this.finish();
            return;
        }
        if (message.kind !== "caret") return;
        const { rect, offset, viewport } = message;
        const numbers = [rect?.x, rect?.y, rect?.width, rect?.height, offset?.x, offset?.y, viewport?.width, viewport?.height];
        if (!numbers.every(value => Number.isFinite(value) && Math.abs(value) < 100000) || viewport.width <= 0 || viewport.height <= 0 || rect.width <= 0 || rect.height <= 0) return;
        const bounds = webview.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return;
        const scaleX = bounds.width / viewport.width;
        const scaleY = bounds.height / viewport.height;
        const target = {
            x: bounds.left + (offset.x + rect.x) * scaleX,
            y: bounds.top + (offset.y + rect.y) * scaleY,
            width: rect.width * scaleX, height: rect.height * scaleY,
        };
        if (message.entering && this.owner === "editor" && this.last) {
            this.begin(this.last, target, "codex", event.source, message.sequence);
        } else if (this.transition?.owner === "codex" && this.transition.source === event.source) {
            this.transition.physics.updateSize(target.width, target.height);
            this.transition.physics.move(target.x, target.y);
        }
        this.owner = "codex";
        this.last = target;
    }

    reply(transition, kind) {
        transition?.source?.postMessage({ channel: "neovide-codex-cursor-v2", kind, sequence: transition.sequence }, "*");
    }

    begin(from, target, owner, source = null, sequence = 0) {
        this.finish();
        const physics = createNeovideCursor({ canvas: this.canvas });
        physics.updateSize(from.width, from.height);
        physics.move(from.x, from.y);
        physics.updateLoop(true, false);
        physics.updateSize(target.width, target.height);
        physics.move(target.x, target.y);
        this.transition = { physics, owner, source, sequence, started: performance.now() };
        document.documentElement.dataset.neovideCrossing = owner;
        this.reply(this.transition, "transition-start");
        this.frame = requestAnimationFrame(() => this.tick());
    }

    tick() {
        this.frame = 0;
        if (!this.transition) return;
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        const animating = this.transition.physics.updateLoop(false, true);
        this.canvas.style.opacity = "1";
        if (animating && performance.now() - this.transition.started < 800) {
            this.frame = requestAnimationFrame(() => this.tick());
        } else {
            this.finish();
        }
    }

    finish() {
        this.reply(this.transition, "transition-end");
        this.transition = null;
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.canvas.style.opacity = "0";
        delete document.documentElement.dataset.neovideCrossing;
    }
}

const startWorkbenchBridge = () => {
    if (!window.__neovideCodexBridge) window.__neovideCodexBridge = new NeovideWorkbenchBridge();
};
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startWorkbenchBridge, { once: true });
} else {
    startWorkbenchBridge();
}
