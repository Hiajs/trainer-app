import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  DownloadItem,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  nativeTheme,
  session as electronSession,
  Session,
  shell,
  WebContents,
  webContents as allWebContents
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Store } from './store';
import { AIError, runAssistant, runSearch, Keys } from './ai';
import { extractPdfText, normalizeWhitespace, searchImages, searchVideos, SearchError } from './search';
import { baseDomain, isTracker } from './trackers';
import type {
  AIEvent,
  AssistantRequest,
  ContextAction,
  DownloadItemInfo,
  MenuCommand,
  PageContext,
  SearchRequest,
  SecretName,
  Settings
} from '../shared/types';

const PERSIST_PARTITION = 'persist:main';
const isMac = process.platform === 'darwin';

// Present as a regular Chrome build; some sites refuse unknown "Electron" agents.
app.userAgentFallback = app.userAgentFallback.replace(/\s(searchgpt-x|SearchGPT X)\/[\d.]+/i, '').replace(/\sElectron\/[\d.]+/, '');
app.setName('SearchGPT X');

let store: Store;

interface WindowState {
  win: BrowserWindow;
  isPrivate: boolean;
  partition: string;
}
const windows = new Map<number, WindowState>(); // keyed by the host webContents id
const aiControllers = new Map<string, AbortController>();
const downloads = new Map<string, { item: DownloadItem; info: DownloadItemInfo; persist: boolean }>();
const configuredSessions = new WeakSet<Session>();
const permissionMemory = new Map<string, boolean>();
let pendingUrls: string[] = [];

function keys(): Keys {
  return {
    openaiKey: store.getSecret('openaiKey'),
    anthropicKey: store.getSecret('anthropicKey'),
    braveKey: store.getSecret('braveKey')
  };
}

function sendToHost(wc: WebContents, channel: string, payload: unknown) {
  const host = wc.hostWebContents ?? wc;
  if (!host.isDestroyed()) host.send(channel, payload);
}

function broadcast(channel: string, payload: unknown) {
  for (const { win } of windows.values()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

function focusedState(): WindowState | undefined {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  return win ? windows.get(win.webContents.id) : undefined;
}

// ------------------------------------------------------------------ sessions
function configureSession(ses: Session, isPrivate: boolean) {
  if (configuredSessions.has(ses)) return;
  configuredSessions.add(ses);
  ses.setUserAgent(app.userAgentFallback);

  // Optional tracker blocking for third-party subresources.
  const blockedCounts = new Map<number, number>();
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (!store.getSettings().trackingProtection || details.resourceType === 'mainFrame') return callback({});
    try {
      const host = new URL(details.url).hostname;
      if (!isTracker(host)) return callback({});
      const wc = details.webContentsId ? allWebContents.fromId(details.webContentsId) : undefined;
      const firstParty = wc && !wc.isDestroyed() ? new URL(wc.getURL()).hostname : '';
      if (firstParty && baseDomain(firstParty) === baseDomain(host)) return callback({});
      if (wc && details.webContentsId) {
        const n = (blockedCounts.get(details.webContentsId) ?? 0) + 1;
        blockedCounts.set(details.webContentsId, n);
        sendToHost(wc, 'tracker:blocked', { webContentsId: details.webContentsId, count: n });
      }
      return callback({ cancel: true });
    } catch {
      return callback({});
    }
  });
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    // Send Global Privacy Control and Do Not Track when protection is on.
    if (store.getSettings().trackingProtection) {
      details.requestHeaders['Sec-GPC'] = '1';
      details.requestHeaders['DNT'] = '1';
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  // Ask before granting powerful permissions; quietly allow harmless ones.
  const harmless = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'window-management']);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (harmless.has(permission)) return callback(true);
    const origin = (() => {
      try {
        return new URL(details.requestingUrl || wc.getURL()).origin;
      } catch {
        return 'This site';
      }
    })();
    const key = `${isPrivate ? 'p' : 'n'}|${origin}|${permission}`;
    if (permissionMemory.has(key)) return callback(permissionMemory.get(key)!);
    const host = wc.hostWebContents ? BrowserWindow.fromWebContents(wc.hostWebContents) : BrowserWindow.fromWebContents(wc);
    const labels: Record<string, string> = {
      media: 'use your camera or microphone',
      geolocation: 'know your location',
      notifications: 'show notifications',
      midi: 'use MIDI devices',
      midiSysex: 'use MIDI devices',
      'clipboard-read': 'read your clipboard',
      openExternal: 'open another application'
    };
    const opts = {
      type: 'question' as const,
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
      message: `${origin} wants to ${labels[permission] ?? `use “${permission}”`}.`,
      detail: 'Your choice is remembered until you quit SearchGPT X.'
    };
    const p = host ? dialog.showMessageBox(host, opts) : dialog.showMessageBox(opts);
    p.then(({ response }) => {
      const allowed = response === 0;
      permissionMemory.set(key, allowed);
      callback(allowed);
    }).catch(() => callback(false));
  });

  ses.on('will-download', (_event, item, wc) => {
    const id = crypto.randomUUID();
    const dir = app.getPath('downloads');
    const name = item.getFilename() || 'download';
    let target = path.join(dir, name);
    const ext = path.extname(name);
    const stem = path.basename(name, ext);
    for (let i = 1; fs.existsSync(target) && i < 1000; i++) target = path.join(dir, `${stem} (${i})${ext}`);
    item.setSavePath(target);
    const info: DownloadItemInfo = {
      id,
      url: item.getURL(),
      filename: path.basename(target),
      savePath: target,
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      paused: false,
      startedAt: Date.now()
    };
    const entry = { item, info, persist: !isPrivate };
    downloads.set(id, entry);
    const push = () => {
      entry.info = {
        ...entry.info,
        totalBytes: item.getTotalBytes(),
        receivedBytes: item.getReceivedBytes(),
        paused: item.isPaused()
      };
      if (entry.persist) store.upsertDownload(entry.info);
      broadcast('download:event', { type: 'update', item: entry.info });
    };
    item.on('updated', (_e, state) => {
      entry.info.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      push();
    });
    item.once('done', (_e, state) => {
      entry.info.state = state;
      push();
      if (state === 'completed' && isMac) app.dock?.downloadFinished(target);
    });
    push();
    sendToHost(wc, 'menu:command', 'show-downloads-toast');
  });

  // Load user-installed unpacked extensions into the main profile only.
  if (!isPrivate) {
    for (const dir of store.getSettings().extensions) {
      const loader = (ses as any).extensions?.loadExtension?.bind((ses as any).extensions) ?? ses.loadExtension.bind(ses);
      loader(dir, { allowFileAccess: false }).catch((err: unknown) => console.warn('Extension failed to load', dir, err));
    }
  }
}

// ------------------------------------------------------------------ windows
function createWindow(opts: { isPrivate?: boolean; url?: string } = {}) {
  const isPrivate = !!opts.isPrivate;
  const partition = isPrivate ? `private-${crypto.randomUUID()}` : PERSIST_PARTITION;
  configureSession(electronSession.fromPartition(partition), isPrivate);

  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: isPrivate ? 'SearchGPT X — Private' : 'SearchGPT X',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors || isPrivate ? '#0b0b12' : '#f7f7fb',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: true,
      backgroundThrottling: true
    }
  });
  const id = win.webContents.id;
  windows.set(id, { win, isPrivate, partition });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    windows.delete(id);
    if (isPrivate) {
      const ses = electronSession.fromPartition(partition);
      ses.clearStorageData().catch(() => {});
      ses.clearCache().catch(() => {});
    }
  });
  // The UI itself never navigates away from the app bundle.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const query: Record<string, string> = {};
  if (isPrivate) query.private = '1';
  if (opts.url) query.open = opts.url;
  win.loadFile(path.join(__dirname, '../renderer/index.html'), { query });
  return win;
}

function openUrlInApp(url: string) {
  const st = focusedState();
  if (!st) {
    createWindow({ url });
    return;
  }
  st.win.webContents.send('tab:open', { url, background: false });
  st.win.show();
  st.win.focus();
}

// ------------------------------------------------------------------ webview hardening
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    const st = windows.get(contents.id);
    delete (webPreferences as any).preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.plugins = true; // needed for Chromium's built-in PDF viewer
    params.partition = st?.isPrivate ? st.partition : PERSIST_PARTITION;
    if (params.src && !/^(https?:|about:blank|file:)/i.test(params.src)) event.preventDefault();
  });

  if (contents.getType() !== 'webview') return;

  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (/^https?:/i.test(url) || url === 'about:blank') {
      sendToHost(contents, 'tab:open', { url, background: disposition === 'background-tab' });
    }
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (/^(https?:|about:|file:|blob:|data:)/i.test(url)) return;
    event.preventDefault();
    if (/^(mailto|tel|facetime|maps|zoommtg|msteams|slack|spotify):/i.test(url)) shell.openExternal(url).catch(() => {});
  });

  contents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    const act = (a: ContextAction) => sendToHost(contents, 'context:action', a);
    if (params.linkURL) {
      items.push(
        { label: 'Open Link in New Tab', click: () => act({ action: 'open-in-new-tab', url: params.linkURL }) },
        { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' }
      );
    }
    if (params.mediaType === 'image' && params.srcURL) {
      items.push(
        { label: 'Open Image in New Tab', click: () => act({ action: 'open-in-new-tab', url: params.srcURL }) },
        { label: 'Save Image…', click: () => contents.downloadURL(params.srcURL) },
        { label: 'Copy Image', click: () => contents.copyImageAt(params.x, params.y) },
        { type: 'separator' }
      );
    }
    const sel = params.selectionText?.trim();
    if (sel) {
      const short = sel.length > 32 ? `${sel.slice(0, 32)}…` : sel;
      items.push(
        { label: `Ask AI about “${short}”`, click: () => act({ action: 'ask-ai', text: sel }) },
        { label: `Search “${short}” with SearchGPT X`, click: () => act({ action: 'search-ai', text: sel }) },
        { label: 'Translate Selection', click: () => act({ action: 'translate', text: sel }) },
        { type: 'separator' },
        { role: 'copy' }
      );
    }
    if (params.isEditable) {
      for (const s of params.dictionarySuggestions.slice(0, 4)) items.push({ label: s, click: () => contents.replaceMisspelling(s) });
      if (params.dictionarySuggestions.length) items.push({ type: 'separator' });
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    }
    if (!sel && !params.isEditable && !params.linkURL) {
      items.push(
        { label: 'Back', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
        { label: 'Forward', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
        { label: 'Reload', click: () => contents.reload() },
        { type: 'separator' },
        { label: 'Summarize Page with AI', click: () => act({ action: 'summarize' }) }
      );
    }
    items.push({ type: 'separator' }, { label: 'Inspect Element', click: () => contents.inspectElement(params.x, params.y) });
    const host = contents.hostWebContents ? BrowserWindow.fromWebContents(contents.hostWebContents) : null;
    Menu.buildFromTemplate(items).popup(host ? { window: host } : {});
  });
});

// ------------------------------------------------------------------ IPC
function guard<T extends unknown[], R>(fn: (event: Electron.IpcMainInvokeEvent, ...args: T) => R) {
  return (event: Electron.IpcMainInvokeEvent, ...args: T) => {
    // Only the app's own UI (loaded from file://) may call privileged APIs.
    const url = event.senderFrame?.url ?? '';
    if (!url.startsWith('file://')) throw new Error('Blocked IPC from untrusted frame');
    return fn(event, ...args);
  };
}

function isPrivateSender(event: Electron.IpcMainInvokeEvent) {
  return windows.get(event.sender.id)?.isPrivate ?? false;
}

function applyTheme(s: Settings) {
  nativeTheme.themeSource = s.theme;
}

async function runAI(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  job: (emit: (e: AIEvent) => void, signal: AbortSignal) => Promise<void>
) {
  const controller = new AbortController();
  aiControllers.set(requestId, controller);
  const emit = (e: AIEvent) => {
    if (!event.sender.isDestroyed()) event.sender.send('ai:event', e);
  };
  try {
    await job(emit, controller.signal);
  } catch (err: any) {
    const aborted = controller.signal.aborted || err?.name === 'AbortError';
    const message = aborted
      ? 'Stopped.'
      : err instanceof AIError || err instanceof SearchError
        ? err.message
        : /net::ERR_/.test(String(err?.message))
          ? `Couldn’t reach the network (${String(err.message).match(/net::ERR_[A-Z_]+/)?.[0]}). Check your internet connection — a school or work network may also be blocking this service.`
          : `Something went wrong: ${err?.message ?? err}. Check your connection and settings.`;
    emit({ requestId, type: 'error', message });
  } finally {
    aiControllers.delete(requestId);
  }
}

function registerIpc() {
  ipcMain.handle('window:info', guard((e) => ({ isPrivate: isPrivateSender(e), platform: process.platform, version: app.getVersion() })));
  ipcMain.handle('window:new', guard((_e, isPrivate: boolean) => void createWindow({ isPrivate })));

  ipcMain.handle('settings:get', guard(() => store.getSettings()));
  ipcMain.handle(
    'settings:set',
    guard((_e, patch: Partial<Settings>) => {
      const s = store.updateSettings(patch);
      applyTheme(s);
      broadcast('settings:changed', s);
      return s;
    })
  );
  ipcMain.handle('secrets:status', guard(() => store.secretStatus()));
  ipcMain.handle(
    'secrets:set',
    guard((_e, name: SecretName, value: string) => {
      if (!['openaiKey', 'anthropicKey', 'braveKey'].includes(name)) throw new Error('Unknown secret');
      store.setSecret(name, String(value ?? ''));
      return store.secretStatus();
    })
  );

  ipcMain.handle('bookmarks:list', guard(() => store.listBookmarks()));
  ipcMain.handle(
    'bookmarks:toggle',
    guard((_e, b: { url: string; title: string; favicon?: string }) => {
      const added = store.toggleBookmark(b);
      broadcast('bookmarks:changed', store.listBookmarks());
      return added;
    })
  );
  ipcMain.handle(
    'bookmarks:remove',
    guard((_e, id: string) => {
      store.removeBookmark(id);
      broadcast('bookmarks:changed', store.listBookmarks());
    })
  );

  ipcMain.handle(
    'history:add',
    guard((e, h: { url: string; title: string; favicon?: string }) => {
      if (!isPrivateSender(e)) store.addHistory(h);
    })
  );
  ipcMain.handle('history:search', guard((_e, q: string) => store.searchHistory(q ?? '')));
  ipcMain.handle('history:remove', guard((_e, id: string) => store.removeHistory(id)));
  ipcMain.handle('history:clear', guard(() => store.clearHistory()));

  ipcMain.handle(
    'downloads:list',
    guard((e) => {
      const live = [...downloads.values()].filter((d) => d.persist || isPrivateSender(e)).map((d) => d.info);
      const ids = new Set(live.map((d) => d.id));
      return [...live, ...store.listDownloads().filter((d) => !ids.has(d.id))].sort((a, b) => b.startedAt - a.startedAt);
    })
  );
  ipcMain.handle(
    'downloads:action',
    guard(async (_e, id: string, action: 'pause' | 'resume' | 'cancel' | 'open' | 'show' | 'clear') => {
      if (action === 'clear') {
        store.clearDownloads();
        for (const [k, d] of downloads) if (d.info.state !== 'progressing') downloads.delete(k);
        return;
      }
      const live = downloads.get(id);
      const info = live?.info ?? store.listDownloads().find((d) => d.id === id);
      if (action === 'pause') live?.item.pause();
      if (action === 'resume' && live?.item.canResume()) live.item.resume();
      if (action === 'cancel') live?.item.cancel();
      if (action === 'open' && info) {
        const err = await shell.openPath(info.savePath);
        if (err) throw new Error(err);
      }
      if (action === 'show' && info) shell.showItemInFolder(info.savePath);
    })
  );

  ipcMain.handle(
    'ai:search',
    guard((e, req: SearchRequest) => runAI(e, req.requestId, (emit, signal) => runSearch(req, store.getSettings(), keys(), emit, signal)))
  );
  ipcMain.handle(
    'ai:assistant',
    guard((e, req: AssistantRequest) => runAI(e, req.requestId, (emit, signal) => runAssistant(req, store.getSettings(), keys(), emit, signal)))
  );
  ipcMain.handle('ai:abort', guard((_e, requestId: string) => aiControllers.get(requestId)?.abort()));
  ipcMain.handle('ai:images', guard((_e, q: string) => searchImages(q, keys().braveKey)));
  ipcMain.handle('ai:videos', guard((_e, q: string) => searchVideos(q, keys().braveKey)));

  ipcMain.handle('assistant:load', guard((e) => (isPrivateSender(e) ? [] : store.getAssistant())));
  ipcMain.handle('assistant:save', guard((e, messages) => (isPrivateSender(e) ? undefined : store.setAssistant(messages))));

  ipcMain.handle(
    'page:pdf-text',
    guard(async (e, url: string): Promise<PageContext> => {
      const st = windows.get(e.sender.id);
      const ses = electronSession.fromPartition(st?.partition ?? PERSIST_PARTITION);
      const res = await ses.fetch(url);
      if (!res.ok) throw new Error(`Could not download the PDF (HTTP ${res.status}).`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const text = await extractPdfText(buf);
      return { url, title: decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'PDF'), text, kind: 'pdf' };
    })
  );
  ipcMain.handle(
    'file:open-document',
    guard(async (e): Promise<PageContext | null> => {
      const win = BrowserWindow.fromWebContents(e.sender)!;
      const pick = await dialog.showOpenDialog(win, {
        title: 'Choose a PDF or text file to analyze',
        properties: ['openFile'],
        filters: [{ name: 'Documents', extensions: ['pdf', 'txt', 'md', 'csv', 'json', 'html', 'js', 'ts', 'py', 'swift', 'java', 'c', 'cpp'] }]
      });
      if (pick.canceled || !pick.filePaths[0]) return null;
      const file = pick.filePaths[0];
      const stat = fs.statSync(file);
      if (stat.size > 50 * 1024 * 1024) throw new Error('That file is larger than 50 MB.');
      const data = fs.readFileSync(file);
      const isPdf = file.toLowerCase().endsWith('.pdf');
      const text = isPdf ? await extractPdfText(new Uint8Array(data)) : normalizeWhitespace(data.toString('utf8'));
      return { url: `file://${file}`, title: path.basename(file), text, kind: isPdf ? 'pdf' : 'file' };
    })
  );

  ipcMain.handle(
    'privacy:clear-data',
    guard(async (_e, what: { history?: boolean; cookies?: boolean; cache?: boolean; assistant?: boolean }) => {
      const ses = electronSession.fromPartition(PERSIST_PARTITION);
      if (what.history) store.clearHistory();
      if (what.cookies) await ses.clearStorageData();
      if (what.cache) await ses.clearCache();
      if (what.assistant) store.setAssistant([]);
    })
  );

  ipcMain.handle(
    'extensions:add',
    guard(async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)!;
      const pick = await dialog.showOpenDialog(win, { title: 'Choose an unpacked extension folder', properties: ['openDirectory'] });
      if (pick.canceled || !pick.filePaths[0]) return store.getSettings();
      const dir = pick.filePaths[0];
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error('That folder has no manifest.json, so it is not an unpacked extension.');
      const ses = electronSession.fromPartition(PERSIST_PARTITION);
      const loader = (ses as any).extensions?.loadExtension?.bind((ses as any).extensions) ?? ses.loadExtension.bind(ses);
      await loader(dir, { allowFileAccess: false });
      const s = store.updateSettings({ extensions: [...new Set([...store.getSettings().extensions, dir])] });
      broadcast('settings:changed', s);
      return s;
    })
  );
  ipcMain.handle(
    'extensions:remove',
    guard((_e, dir: string) => {
      const s = store.updateSettings({ extensions: store.getSettings().extensions.filter((d) => d !== dir) });
      broadcast('settings:changed', s);
      return s;
    })
  );
  ipcMain.handle(
    'app:set-default-browser',
    guard(() => app.setAsDefaultProtocolClient('http') && app.setAsDefaultProtocolClient('https'))
  );
  ipcMain.handle('app:open-external', guard((_e, url: string) => (/^https?:|^mailto:/i.test(url) ? shell.openExternal(url) : undefined)));
}

// ------------------------------------------------------------------ menu
function sendCommand(cmd: MenuCommand) {
  focusedState()?.win.webContents.send('menu:command', cmd);
}

function buildMenu() {
  const c = (label: string, accelerator: string | undefined, cmd: MenuCommand): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => sendCommand(cmd)
  });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: 'SearchGPT X',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              c('Settings…', 'Cmd+,', 'show-settings'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        c('New Tab', 'CmdOrCtrl+T', 'new-tab'),
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: 'New Private Window', accelerator: 'Shift+CmdOrCtrl+N', click: () => createWindow({ isPrivate: true }) },
        c('Reopen Closed Tab', 'Shift+CmdOrCtrl+T', 'reopen-tab'),
        { type: 'separator' },
        c('Open Location…', 'CmdOrCtrl+L', 'focus-address'),
        c('Home', 'Shift+CmdOrCtrl+H', 'home'),
        { type: 'separator' },
        c('Close Tab', 'CmdOrCtrl+W', 'close-tab'),
        { label: 'Close Window', accelerator: 'Shift+CmdOrCtrl+W', role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
        { type: 'separator' },
        c('Find…', 'CmdOrCtrl+F', 'find')
      ]
    },
    {
      label: 'View',
      submenu: [
        c('Reload Page', 'CmdOrCtrl+R', 'reload'),
        c('Hard Reload', 'Shift+CmdOrCtrl+R', 'hard-reload'),
        { type: 'separator' },
        c('Actual Size', 'CmdOrCtrl+0', 'zoom-reset'),
        c('Zoom In', 'CmdOrCtrl+=', 'zoom-in'),
        c('Zoom In ', 'CmdOrCtrl+Plus', 'zoom-in'),
        c('Zoom Out', 'CmdOrCtrl+-', 'zoom-out'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        c('Developer Tools', 'Alt+CmdOrCtrl+I', 'devtools')
      ]
    },
    {
      label: 'History',
      submenu: [
        c('Back', 'CmdOrCtrl+[', 'back'),
        c('Forward', 'CmdOrCtrl+]', 'forward'),
        { type: 'separator' },
        c('Show All History', 'CmdOrCtrl+Y', 'show-history')
      ]
    },
    {
      label: 'Bookmarks',
      submenu: [c('Bookmark This Page', 'CmdOrCtrl+D', 'bookmark-page'), c('Show Bookmarks', 'Alt+CmdOrCtrl+B', 'show-bookmarks')]
    },
    {
      label: 'AI',
      submenu: [
        c('Toggle Assistant', 'CmdOrCtrl+E', 'toggle-assistant'),
        c('Summarize This Page', 'Shift+CmdOrCtrl+S', 'summarize-page')
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        c('Show Next Tab', 'Ctrl+Tab', 'next-tab'),
        c('Show Previous Tab', 'Ctrl+Shift+Tab', 'prev-tab'),
        ...Array.from({ length: 9 }, (_, i) => c(`Tab ${i === 8 ? '(last)' : i + 1}`, `CmdOrCtrl+${i + 1}`, `select-tab-${i + 1}` as MenuCommand)),
        { type: 'separator' },
        c('Downloads', 'Alt+CmdOrCtrl+L', 'show-downloads'),
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      role: 'help',
      submenu: [
        { label: 'What does SearchGPT X send to AI providers?', click: () => sendCommand('show-settings') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ lifecycle
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => /^https?:\/\//i.test(a));
    if (url) openUrlInApp(url);
    else focusedState()?.win.focus();
  });
  // macOS delivers links (when set as the default browser) through open-url.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (app.isReady()) openUrlInApp(url);
    else pendingUrls.push(url);
  });

  app.whenReady().then(() => {
    store = new Store();
    applyTheme(store.getSettings());
    app.setAboutPanelOptions({
      applicationName: 'SearchGPT X',
      applicationVersion: app.getVersion(),
      copyright: 'An AI search browser. Your data stays on this Mac except for the requests described in Settings → Privacy.'
    });
    registerIpc();
    buildMenu();
    if (pendingUrls.length) {
      for (const u of pendingUrls) createWindow({ url: u });
      pendingUrls = [];
    } else {
      createWindow();
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
  app.on('before-quit', () => store?.flushAll());
}
