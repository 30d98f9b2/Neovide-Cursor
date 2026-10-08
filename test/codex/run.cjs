const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'neovide-cursor.js'), 'utf8');
const physics = source.split('class GlobalCursorManager {')[0];
const bundle = name => '(() => {\n' + physics + '\n' + fs.readFileSync(path.join(root, 'scripts/codex', name), 'utf8') + '\n})();';
const bridge = bundle('workbench-bridge.js');
const adapter = bundle('codex-adapter.js');
let shellOrigin;
const shellServer = http.createServer((req, res) => {
  if (req.url === '/cursor.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(adapter); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url.startsWith('/shell')) return res.end(`<style>body{margin:0}iframe{position:absolute;left:6px;top:8px;width:calc(100% - 12px);height:calc(100% - 16px);border:0}</style><iframe src="/composer"></iframe>`);
  res.end(`<style>body{margin:0;background:#222;color:white}.ProseMirror{margin:24px;padding:12px;font:16px/24px monospace;outline:none}p{margin:0}</style><script type="module" src="/cursor.js"></script><div role="textbox" contenteditable="true" data-codex-composer="true" class="ProseMirror"><p>abcdefg</p><p>第二行</p></div>`);
});
const hostServer = http.createServer((req, res) => {
  if (req.url === '/bridge.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bridge); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<style>body{margin:0;background:#111;color:white}.monaco-editor{position:absolute;left:100px;top:100px}textarea{width:260px;height:200px}.cursor{position:absolute;left:32px;top:28px;width:8px;height:18px;background:white}iframe{position:absolute;left:480px;top:80px;width:400px;height:460px;border:0}</style><script src="/bridge.js"></script><div class="monaco-editor"><textarea id="native">source editor</textarea><div class="cursor"></div></div><canvas style="z-index:9999;pointer-events:none"></canvas><iframe src="${shellOrigin}/shell?extensionId=openai.chatgpt"></iframe>`);
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
(async () => {
  let browser;
  try {
    shellOrigin = await listen(shellServer);
    const hostOrigin = await listen(hostServer);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(hostOrigin);
    await page.waitForFunction(() => !!window.__neovideCodexBridge);
    const content = page.frames().find(frame => frame.url().endsWith('/composer'));
    await content.waitForFunction(() => !!window.__neovideCodexCursor);
    await page.evaluate(() => {
      window.__starts = []; window.__hostFrames = 0;
      const manager = window.__neovideCodexBridge;
      const begin = manager.begin;
      manager.begin = function(from, to, owner, ...rest) { window.__starts.push({from,to,owner}); return begin.call(this,from,to,owner,...rest); };
      const tick = manager.tick;
      manager.tick = function() { window.__hostFrames++; return tick.call(this); };
    });
    await content.evaluate(() => {
      window.__imeFrames = 0; window.__localFrames = 0;
      const manager = window.__neovideCodexCursor;
      const tick = manager.tick;
      manager.tick = function() { tick.call(this); if(this.canvas.style.opacity === '1') { window.__localFrames++; if(this.composing) window.__imeFrames++; } };
    });
    const native = page.locator('#native');
    const editor = content.locator('[data-codex-composer]');
    await native.focus();
    await page.waitForFunction(() => window.__neovideCodexBridge.owner === 'editor');
    await editor.focus();
    await content.evaluate(() => { const e = document.querySelector('[data-codex-composer]'); const s = getSelection(); s.collapse(e.firstChild.firstChild, 3); });
    await page.waitForFunction(() => window.__starts.some(s => s.owner === 'codex'));
    await editor.press('End');
    await page.waitForFunction(() => !window.__neovideCodexBridge.transition);
    const first = await page.evaluate(() => ({ starts:window.__starts, frames:window.__hostFrames, last:window.__neovideCodexBridge.last }));
    const local = await content.evaluate(() => ({rect:window.__neovideCodexCursor.caretRect(document.querySelector('[data-codex-composer]')),offset:window.frameElement.getBoundingClientRect().toJSON(),width:parent.innerWidth}));
    assert(first.frames > 1, 'Cross-panel physics must render multiple frames');
    assert(Math.abs(first.last.x - (480 + local.offset.x + local.rect.x)) < 0.1, 'Nested webview X offset must be correct');
    assert(Math.abs(first.last.y - (80 + local.offset.y + local.rect.y)) < 0.1, 'Nested webview Y offset must be correct');
    assert.equal(await content.evaluate(() => document.querySelector('[data-codex-composer]').style.caretColor), '');
    await content.waitForFunction(() => window.__neovideCodexCursor.frame === 0 && !window.__neovideCodexCursor.bridgeTransition);
    await content.evaluate(() => { window.__localFrames = 0; });
    await editor.press('ArrowLeft');
    await content.waitForFunction(() => window.__localFrames > 0);
    await native.focus();
    await page.waitForFunction(() => window.__starts.some(s => s.owner === 'editor'));
    await page.waitForFunction(() => !window.__neovideCodexBridge.transition);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-neovide-crossing')), false);
    await editor.focus();
    await content.evaluate(() => { const e = document.querySelector('[data-codex-composer]'); getSelection().collapse(e.firstChild.firstChild, e.firstChild.firstChild.length); });
    await page.waitForFunction(() => window.__starts.filter(s => s.owner === 'codex').length === 2);
    await page.waitForFunction(() => !window.__neovideCodexBridge.transition);
    await content.waitForFunction(() => !window.__neovideCodexCursor.bridgeTransition && window.__neovideCodexCursor.last && window.__neovideCodexCursor.frame === 0);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', {text:'zhong',selectionStart:5,selectionEnd:5});
    await content.waitForFunction(() => window.__neovideCodexCursor.composing);
    await content.waitForFunction(() => window.__imeFrames > 0);
    await cdp.send('Input.imeSetComposition', {text:'zhongwen',selectionStart:0,selectionEnd:8});
    await content.waitForFunction(() => !getSelection().isCollapsed);
    const composition = await content.evaluate(() => ({collapsed:getSelection().isCollapsed,rect:window.__neovideCodexCursor.caretRect(document.querySelector('[data-codex-composer]')),frames:window.__imeFrames}));
    assert.equal(composition.collapsed, false, 'Test must include an IME marked-text selection');
    assert(composition.rect && composition.rect.height > 0);
    await cdp.send('Input.insertText', {text:'中文'});
    await content.waitForFunction(() => !window.__neovideCodexCursor.composing);
    await content.waitForFunction(() => window.__neovideCodexCursor.frame === 0);
    assert((await editor.textContent()).includes('中文'));
    assert(!(await editor.textContent()).includes('zhongwen'));
    assert.equal(await content.evaluate(() => document.querySelector('[data-codex-composer]').style.caretColor), '');
    await content.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('[data-codex-composer]')); getSelection().removeAllRanges(); getSelection().addRange(range); });
    await content.waitForFunction(() => window.__neovideCodexCursor.canvas.style.opacity === '0');
    assert.equal(await content.evaluate(() => document.querySelector('[data-codex-composer]').style.caretColor), '');
    assert.deepEqual(errors, []);
    const hostSummary = await page.evaluate(() => ({frames:window.__hostFrames,transitions:window.__starts.map(s=>s.owner)}));
    const report = {crossPanelFrames:hostSummary.frames,transitions:hostSummary.transitions,nestedCoordinates:'passed',typingDuringTransition:'passed',localAnimationAfterTransition:'passed',imeCompositionFrames:composition.frames,imeMarkedSelection:'passed',chineseCommit:'passed',caretRestoration:'passed',pageErrors:errors};
    console.log(JSON.stringify(report,null,2));
  } finally {
    if(browser) await browser.close();
    hostServer.close(); shellServer.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
