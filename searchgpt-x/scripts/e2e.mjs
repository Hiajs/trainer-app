// End-to-end smoke test: launches the real app with Playwright's Electron driver.
// Usage: xvfb-run -a node scripts/e2e.mjs <screenshot-dir>
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const { _electron: electron } = (() => { try { return req('playwright-core'); } catch { return req('playwright'); } })();
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockAI } from './mock-ai-server.mjs';

const outDir = process.argv[2] || 'out/e2e';
fs.mkdirSync(outDir, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sgx-home-'));
// Keep the machine's browser certificate store (needed behind TLS-inspecting proxies).
const realNss = path.join(os.homedir(), '.pki', 'nssdb');
if (fs.existsSync(realNss)) fs.cpSync(realNss, path.join(home, '.pki', 'nssdb'), { recursive: true });
const { server, calls } = await startMockAI(8787);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const app = await electron.launch({
  executablePath: path.resolve('node_modules/electron/dist/electron'),
  args: ['.', '--no-sandbox', '--password-store=basic'],
  env: { ...process.env, SGX_ALLOW_INSECURE_KEYSTORE: '1', SGX_TEST_BRAVE_BASE: 'http://127.0.0.1:8787/res/v1', HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') }
});
const win = await app.firstWindow();
win.on('console', (m) => m.type() === 'error' && console.log('[renderer error]', m.text()));
await win.setViewportSize({ width: 1360, height: 860 }).catch(() => {});
await win.waitForSelector('text=Ask a question');
const shot = (name) => win.screenshot({ path: path.join(outDir, name) });
await shot('01-home-light.png');
check('home renders', true);

// No key yet: an AI search should explain how to add one.
await win.fill('textarea', 'what is the tallest mountain');
await win.keyboard.press('Enter');
await win.waitForSelector('text=Add your OpenAI API key', { timeout: 15000 });
check('missing key message', true);
await shot('02-no-key.png');

// Configure the mock provider through the same IPC the Settings screen uses.
await win.evaluate(async () => {
  await window.sgx.invoke('settings:set', { openaiBaseUrl: 'http://127.0.0.1:8787/v1', openaiModel: 'mock', sourcesPerAnswer: 4 });
  await window.sgx.invoke('secrets:set', 'openaiKey', 'sk-test-123');
  await window.sgx.invoke('secrets:set', 'braveKey', 'brave-test-key');
});
const status = await win.evaluate(() => window.sgx.invoke('secrets:status'));
check('secret stored encrypted', status.openaiKey, JSON.stringify(status));
await new Promise((r) => setTimeout(r, 600));
const secretsNow = fs.readFileSync(path.join(home, '.config', 'SearchGPT X', 'data', 'secrets.json'), 'utf8');
check('key not stored in plain text', !secretsNow.includes('sk-test-123') && secretsNow.includes('enc:'), secretsNow.slice(0, 60));

// Retry: full pipeline — search (DuckDuckGo fallback), read pages, stream answer with citations.
await win.click('text=Try again');
const ok = await win.waitForSelector('text=Mock answer', { timeout: 60000 }).then(() => true).catch(() => false);
check('answer streamed', ok);
await win.waitForTimeout(1500);
const citeCount = await win.locator('.prose-answer button').count();
check('citation chips rendered', citeCount >= 2, `${citeCount} chips`);
const sourceCount = await win.locator('text=Sources').count();
check('sources section shown', sourceCount > 0);
await shot('03-answer.png');
const related = await win.locator('text=What else should I know?').count();
check('related questions', related > 0);
const readCount = calls.filter((c) => c.stream).map((c) => (c.messages[0].content.match(/fact number \d/g) || []).length)[0] || 0;
check('source pages were read and passed to the model', readCount >= 4, `${readCount} page excerpts in prompt`);
await win.click('button:has-text("Images")');
const imgs = await win.waitForSelector('main img[loading="lazy"]', { timeout: 10000 }).then(() => true).catch(() => false);
check('image search tab', imgs);
await shot('03b-images.png');
await win.click('button:has-text("Answer")');

// Research mode through the follow-up box.
await win.click('button:has-text("Research")');
await win.fill('textarea', 'history of the internet');
await win.keyboard.press('Enter');
const ok2 = await win.waitForSelector('section:nth-of-type(2) >> text=Mock answer', { timeout: 60000 }).then(() => true).catch(() => false);
check('research mode answer', ok2, `${calls.filter((c) => !c.stream).length} planning calls`);
await shot('04-research.png');

// Browsing: open a real page from the address bar.
await win.keyboard.press('Control+T').catch(() => {});
await win.evaluate(() => 0);
const addr = win.locator('input[placeholder="Search with AI or enter a website"]');
await addr.click();
await addr.fill('example.com');
await addr.press('Enter');
const wv = await win.waitForSelector('webview', { timeout: 15000 });
await win.waitForFunction(() => [...document.querySelectorAll('webview')].some((w) => { try { return w.getTitle().includes('Example'); } catch { return false; } }), null, { timeout: 30000 }).then(() => check('web page loads', true)).catch(() => check('web page loads', false));
await win.waitForTimeout(800);
await shot('05-webpage.png');

// History recorded.
await win.waitForTimeout(600);
const hist = await win.evaluate(() => window.sgx.invoke('history:search', ''));
check('history recorded', hist.some((h) => h.url.includes('example.com')), `${hist.length} entries`);

// Bookmark it.
await win.click('button[title="Bookmark (⌘D)"]');
await win.waitForTimeout(300);
const bms = await win.evaluate(() => window.sgx.invoke('bookmarks:list'));
check('bookmark added', bms.length === 1);

// Assistant summarizes the page.
await win.click('button:has-text("Assistant")');
await win.click('button:has-text("Summarize page")');
const ok3 = await win.waitForSelector('text=summarized by the mock model', { timeout: 30000 }).then(() => true).catch(() => false);
const panelText = await win.locator('aside').innerText();
check('assistant page summary', ok3 && panelText.includes('Example Domain'));
await shot('06-assistant.png');

// PDF analysis: text extraction used by the assistant for PDF tabs.
const pdf = await win.evaluate(() => window.sgx.invoke('page:pdf-text', 'http://127.0.0.1:8787/doc.pdf')).catch((e) => ({ text: 'ERR ' + e.message }));
check('PDF text extraction', /photosynthesis/.test(pdf.text), pdf.text.slice(0, 80));

// Library + settings panels.
await win.evaluate(() => document.querySelector('button[aria-label="Menu"]').click());
await win.click('text=History');
await win.waitForSelector('text=Today');
await shot('07-history.png');
await win.keyboard.press('Escape');
await win.mouse.click(30, 400);
await win.evaluate(() => document.querySelector('button[aria-label="Menu"]').click());
await win.click('button:has-text("Settings")');
await win.waitForSelector('text=What leaves this Mac');
await shot('08-settings.png');
await win.mouse.click(10, 600);

// Dark mode.
await win.evaluate(() => window.sgx.invoke('settings:set', { theme: 'dark' }));
await win.waitForTimeout(500);
await win.evaluate(() => document.querySelectorAll('[role="tab"]'));
await shot('09-dark.png');

// Private window has its own in-memory session.
const before = app.windows().length;
await win.evaluate(() => window.sgx.invoke('window:new', true));
const priv = await app.waitForEvent('window');
await priv.waitForSelector('text=Private window');
await priv.screenshot({ path: path.join(outDir, '10-private.png') });
check('private window', app.windows().length === before + 1);

await app.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
