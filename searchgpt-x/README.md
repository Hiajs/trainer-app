# SearchGPT X

An AI-powered desktop browser for macOS (Apple Silicon). It is a real browser — Chromium renders every page — with a conversational search engine on the home screen and an AI assistant in a side panel on every tab.

## Install (from the .dmg)

1. Open `SearchGPT-X-1.0.0-arm64.dmg`.
2. Drag **SearchGPT X** onto the **Applications** shortcut in the window.
3. The first time, **right-click (or Control-click) SearchGPT X in Applications → Open → Open**.
   The app is ad-hoc signed but not notarized by Apple (that needs a paid Apple Developer account), so macOS asks once. On macOS 15 and later, if no Open button appears: try to open it, then go to **System Settings → Privacy & Security** and click **Open Anyway**.
4. Open **Settings (⌘,)** and paste an API key:
   - **AI:** an OpenAI key (platform.openai.com) *or* an Anthropic key (console.anthropic.com).
   - **Search (recommended):** a free Brave Search API key (api-dashboard.search.brave.com). Without it, web search falls back to DuckDuckGo's keyless HTML results, which can be rate-limited; image and video search need the Brave key.

Browsing works without any key. A Mac managed by a school or employer may block apps that aren't from the App Store or an identified developer; that is the device policy and the app can't change it.

`SearchGPT-X-1.0.0-arm64.zip` contains the same app, for when a disk image is inconvenient.

## What it does

**Search** — The home screen is one large search box. Each question goes through: interpret (follow-ups are rewritten into standalone queries) → search the live web → read the top pages (Readability extraction, PDFs too) → stream an answer with numbered, clickable citations → suggest follow-ups. Three modes:
- **Quick** — a direct answer from ~6 sources.
- **Research** — the model plans 3–5 sub-queries, reads ~10 sources and writes a structured report (save it as Markdown).
- **Compare** — gathers differing viewpoints and produces a comparison table with agreements, disagreements and source reliability.

Every answer also has **Images** and **Videos** tabs.

**Assistant (⌘E)** — a persistent conversation beside any tab: summarize the page, key points, translate (14 languages), explain a selection, writing and coding help, **analyze a PDF** (open PDF tabs are read automatically) or attach a local PDF/text/code file, and **Research mode** for multi-step cited web research. Right-click selected text for "Ask AI", "Search with SearchGPT X" or "Translate".

**Browser** — tabs (drag to reorder, middle-click to close, reopen closed tab), back/forward/reload, bookmarks (home-screen tiles), history with search, downloads with pause/resume, find in page, zoom, private windows (in-memory session, no history, wiped on close), the built-in Chromium PDF viewer, permission prompts for camera/mic/location/notifications, dark/light/system themes, can be set as the default browser.

### Keyboard shortcuts

| | |
|---|---|
| ⌘T / ⌘W / ⇧⌘T | New tab / close tab / reopen closed tab |
| ⌘L | Address bar |
| ⌘[ / ⌘] / ⌘R | Back / forward / reload |
| ⌘1…⌘9, ⌃Tab | Switch tabs |
| ⌘E | Toggle assistant |
| ⇧⌘S | Summarize this page |
| ⌘D / ⌥⌘B | Bookmark / bookmarks |
| ⌘Y / ⌥⌘L | History / downloads |
| ⌘F | Find in page |
| ⌘+ / ⌘- / ⌘0 | Zoom |
| ⇧⌘N | New private window |
| ⌘, | Settings |

## Privacy

There are no accounts, analytics or telemetry. The Settings screen spells out exactly what leaves the Mac:
- **AI search:** the question goes to the search provider (Brave or DuckDuckGo); the question plus text from result pages goes to your AI provider.
- **Assistant:** messages go to your AI provider. Page or file text is sent only when you use a page action, attach a file, or turn on "Use page".
- **Stored locally** in `~/Library/Application Support/SearchGPT X/data`: settings, history, bookmarks, downloads list, assistant conversation. API keys are encrypted with Electron `safeStorage`, which on macOS is protected by the Keychain.
- **Tracker blocking** (on by default) blocks third-party requests to ~150 known ad/analytics domains and sends Global Privacy Control.
- All network traffic uses Chromium's network stack and your Mac's normal settings (system proxy, PAC, Keychain certificates, network sign-in). School or workplace networks can still filter or monitor traffic; a browser can't change that, and this one doesn't try.

## Architecture

| Layer | Choice |
|---|---|
| Shell | Electron 35 (Chromium 134 + Node 22) |
| Page rendering | Chromium, one sandboxed `<webview>` per tab |
| UI | React 18 + TypeScript, Tailwind CSS, Framer Motion |
| AI | OpenAI Chat Completions (any OpenAI-compatible endpoint, e.g. a local Ollama) or Anthropic Messages, streamed |
| Search | Brave Search API, with a DuckDuckGo HTML fallback |
| Page reading | `@mozilla/readability` + `linkedom`; PDFs via `unpdf` (pdf.js) |
| Storage | JSON files + `safeStorage` encryption |

**Why Electron:** a WebKit/`WKWebView` app would be the lightest on memory, but needs Swift and Xcode to build and doesn't give the same control over sessions, downloads and request filtering. Building directly on Chromium source is a multi-hour, 100 GB build. Electron ships Chromium with an Apple-Silicon-native build, hardware acceleration, process-per-site isolation, and full session/download/permission APIs, so it's the practical choice for a working browser.

**Why JSON instead of SQLite:** the data here is small (history is capped at 5,000 entries), and a native SQLite module would have to be compiled per Electron version and CPU architecture. Writes are atomic (temp file + rename) and debounced.

**Security:** web pages run in sandboxed `<webview>`s with context isolation and no Node or preload; the main process re-applies those settings in `will-attach-webview`. The UI talks to the main process only through a small `contextBridge` API, and privileged IPC handlers reject calls from anything but the app's own `file://` UI. Non-web URL schemes are blocked (mail/tel links go to the system).

```
src/main/       main process: windows, sessions, downloads, tracker blocking, IPC, menus
  ai.ts         providers + search/research/compare pipeline + assistant
  search.ts     Brave / DuckDuckGo search, page + PDF text extraction
  store.ts      JSON persistence, encrypted secrets
src/preload/    contextBridge API exposed to the UI
src/renderer/   React UI (tabs, home/answer view, assistant, library, settings)
scripts/        build, packaging, icon, DMG builder, end-to-end test
```

## Build from source

Requirements: Node 20+.

```bash
cd searchgpt-x
npm install
npm start                 # build and run in development
npm run test:e2e          # end-to-end test with a mock AI provider (17 checks)
npm run package:mac       # out/SearchGPT-X-<version>-arm64.dmg (+ .zip)
npm run package:mac-intel # Intel build
```

On a Mac, `package:mac` uses `codesign` and `hdiutil`. On Linux it uses `rcodesign` (`cargo install apple-codesign`) for ad-hoc signing and `scripts/make-dmg.py`, a dependency-free HFS+ / UDIF writer, for the disk image.

## Known limitations

- **Not notarized.** Distributing without the first-launch prompt needs an Apple Developer ID ($99/year); set `osxSign`/`osxNotarize` in `scripts/package-mac.mjs` once you have one.
- **No built-in password manager or sync.** Password managers with system-wide autofill (1Password Universal Autofill, the macOS Passwords menu-bar app) work. Unpacked Chrome extensions can be loaded, but Electron implements only part of the extension API, so many won't fully work.
- **Keyless search can be rate-limited.** Use a Brave key for dependable results.
- **The packaged app was built and checked on Linux** (signature structure, HFS+ volume via `fsck_hfs`, DMG CRCs and contents via 7-Zip). The UI and every feature were tested end to end on Electron for Linux, which runs the same code; the first launch on a real Mac is the remaining step.
