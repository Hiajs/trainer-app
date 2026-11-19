import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WebviewTag } from 'electron';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Download, X } from 'lucide-react';
import type { Bookmark, DownloadItemInfo, MenuCommand, PageContext, SearchMode, SecretStatus, Settings, WindowInfo } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { api, uid } from './api';
import { onRequest, reduceTurn, searchUrl, Tab, toNavigableUrl, Turn } from './state';
import { TopBar, TopBarHandle } from './components/TopBar';
import { HomeView } from './components/HomeView';
import { WebTab } from './components/WebTab';
import { AssistantPanel } from './components/AssistantPanel';
import { LibraryPanel, LibraryTab } from './components/LibraryPanel';
import { SettingsPanel } from './components/SettingsPanel';

const params = new URLSearchParams(location.search);
const IS_PRIVATE = params.get('private') === '1';

function makeTab(url?: string): Tab {
  return {
    id: uid(),
    kind: url ? 'web' : 'home',
    initialUrl: url ?? '',
    url: url ?? '',
    title: url ? '' : 'New Tab',
    loading: !!url,
    canGoBack: false,
    canGoForward: false,
    blocked: 0,
    thread: [],
    epoch: 0
  };
}

export function App() {
  const [info, setInfo] = useState<WindowInfo>({ isPrivate: IS_PRIVATE, platform: 'darwin', version: '' });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [secrets, setSecrets] = useState<SecretStatus | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [downloads, setDownloads] = useState<DownloadItemInfo[]>([]);
  const [tabs, setTabs] = useState<Tab[]>(() => [makeTab(params.get('open') ?? undefined)]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [queued, setQueued] = useState<{ id: string; task: 'summarize' | 'ask' | 'translate'; text?: string } | null>(null);
  const [panel, setPanel] = useState<null | 'settings' | LibraryTab>(null);
  const [find, setFind] = useState<{ open: boolean; text: string; result?: { activeMatchOrdinal: number; matches: number } }>({ open: false, text: '' });
  const [toast, setToast] = useState<DownloadItemInfo | null>(null);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  const webviews = useRef(new Map<string, WebviewTag>());
  const closed = useRef<{ url: string; kind: Tab['kind'] }[]>([]);
  const topbar = useRef<TopBarHandle>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const partition = IS_PRIVATE ? 'in-memory' : 'persist:main'; // main process enforces the real partition

  // ------------------------------------------------------------ bootstrapping
  useEffect(() => {
    api.windowInfo().then(setInfo);
    api.getSettings().then(setSettings);
    api.secretStatus().then(setSecrets);
    api.bookmarks().then(setBookmarks);
    api.downloads().then(setDownloads);
    const refreshSecrets = () => api.secretStatus().then(setSecrets);
    window.addEventListener('focus', refreshSecrets);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onMq);
    const offs = [
      api.onSettings(setSettings),
      api.onBookmarks(setBookmarks),
      api.onDownload((e) => {
        if (e.type !== 'update') return;
        setDownloads((ds) => {
          const isNew = !ds.some((d) => d.id === e.item.id);
          if (isNew) setToast(e.item);
          return [e.item, ...ds.filter((d) => d.id !== e.item.id)];
        });
        setToast((t) => (t && t.id === e.item.id ? e.item : t));
      }),
      api.onTrackerBlocked(({ webContentsId, count }) =>
        setTabs((ts) => ts.map((t) => (t.webContentsId === webContentsId ? { ...t, blocked: count } : t)))
      )
    ];
    return () => {
      mq.removeEventListener('change', onMq);
      window.removeEventListener('focus', refreshSecrets);
      offs.forEach((o) => o());
    };
  }, []);

  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark) || (IS_PRIVATE && settings.theme === 'system');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  useEffect(() => {
    document.title = active?.title || 'SearchGPT X';
  }, [active?.title]);
  useEffect(() => {
    if (!toast || toast.state === 'progressing') return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ------------------------------------------------------------ tab helpers
  const updateTab = useCallback((id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)));
  }, []);

  const newTab = useCallback((url?: string, opts: { background?: boolean } = {}) => {
    const t = makeTab(url);
    setTabs((ts) => {
      // Open next to the current tab, like most browsers.
      const i = ts.findIndex((x) => x.id === activeRef.current);
      const copy = [...ts];
      copy.splice(i + 1, 0, t);
      return copy;
    });
    if (!opts.background) setActiveId(t.id);
    return t;
  }, []);

  const closeTab = useCallback((id: string) => {
    const ts = tabsRef.current;
    const idx = ts.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const t = ts[idx];
    if (t.kind === 'web' && t.url) closed.current.push({ url: t.url, kind: 'web' });
    for (const turn of t.thread) if (turn.status === 'running') api.abort(turn.requestId);
    const rest = ts.filter((x) => x.id !== id);
    if (!rest.length) {
      const fresh = makeTab();
      setTabs([fresh]);
      setActiveId(fresh.id);
      return;
    }
    setTabs(rest);
    if (activeRef.current === id) setActiveId(rest[Math.min(idx, rest.length - 1)].id);
  }, []);

  const loadInTab = useCallback(
    (id: string, url: string) => {
      const t = tabsRef.current.find((x) => x.id === id);
      if (!t) return;
      const wv = webviews.current.get(id);
      if (t.kind === 'web' && wv) {
        wv.loadURL(url).catch(() => {});
        updateTab(id, { url, error: undefined });
      } else {
        updateTab(id, (x) => ({ kind: 'web', initialUrl: url, url, title: '', loading: true, error: undefined, epoch: x.epoch + 1, canGoBack: false, canGoForward: false }));
      }
    },
    [updateTab]
  );

  // ------------------------------------------------------------ AI search
  const ask = useCallback(
    (tabId: string, query: string, mode: SearchMode, replaceIndex?: number, seed?: Tab) => {
      // `seed` covers a tab created in the same tick that has not rendered yet.
      const t = tabsRef.current.find((x) => x.id === tabId) ?? seed;
      if (!t) return;
      const requestId = uid();
      const turn: Turn = { id: uid(), requestId, query, mode, steps: [], queries: [], sources: [], answer: '', status: 'running' };
      const prior = (replaceIndex !== undefined ? t.thread.slice(0, replaceIndex) : t.thread).filter((x) => x.status === 'done');
      const history = prior.flatMap((x) => [
        { role: 'user' as const, content: x.query },
        { role: 'assistant' as const, content: x.answer }
      ]);
      updateTab(tabId, (x) => ({
        kind: 'home',
        title: query.length > 40 ? query.slice(0, 40) + '…' : query,
        thread: replaceIndex !== undefined ? [...x.thread.slice(0, replaceIndex), turn] : [...x.thread, turn]
      }));
      const setTurn = (fn: (t: Turn) => Turn) =>
        setTabs((ts) => ts.map((x) => (x.id === tabId ? { ...x, thread: x.thread.map((y) => (y.id === turn.id ? fn(y) : y)) } : x)));
      const off = onRequest(requestId, (e) => setTurn((y) => reduceTurn(y, e)));
      api.search({ requestId, query, mode, history }).finally(() => {
        // Keep listening briefly for the late "related questions" event.
        setTimeout(off, 15000);
        setTurn((y) => (y.status === 'running' ? { ...y, status: y.answer ? 'done' : 'error', error: y.error ?? (y.answer ? undefined : 'No answer was returned.') } : y));
      });
    },
    [updateTab]
  );

  /** Handle what the user typed in the address bar or big search box. */
  const navigateInput = useCallback(
    (input: string, mode: SearchMode = 'quick', target: 'active' | 'new' = 'active') => {
      const url = toNavigableUrl(input);
      const cur = tabsRef.current.find((t) => t.id === activeRef.current);
      if (url) {
        if (target === 'new' || !cur) newTab(url);
        else loadInTab(cur.id, url);
        return;
      }
      const engine = settings.searchEngineForAddressBar === 'ai' ? 'duckduckgo' : settings.searchEngineForAddressBar;
      if (!settings.aiEnabled) {
        if (target === 'new' || !cur) newTab(searchUrl(engine, input));
        else loadInTab(cur.id, searchUrl(engine, input));
        return;
      }
      if (settings.searchEngineForAddressBar !== 'ai' && mode === 'quick' && target !== 'new' && cur?.kind === 'web') {
        loadInTab(cur.id, searchUrl(settings.searchEngineForAddressBar, input));
        return;
      }
      if (cur && cur.kind === 'home' && target === 'active') ask(cur.id, input, mode);
      else {
        const t = newTab();
        ask(t.id, input, mode, undefined, t);
      }
    },
    [ask, loadInTab, newTab, settings.searchEngineForAddressBar, settings.aiEnabled]
  );

  // ------------------------------------------------------------ page context for the assistant
  const getPage = useCallback(async (): Promise<PageContext | null> => {
    const t = tabsRef.current.find((x) => x.id === activeRef.current);
    if (!t || t.kind !== 'web') return null;
    const wv = webviews.current.get(t.id);
    if (!wv) return null;
    let res: { title: string; url: string; text: string; selection: string; isPdf: boolean };
    try {
      res = await wv.executeJavaScript(
        `(() => ({ title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0, 150000) : '', selection: String(getSelection() || ''), isPdf: document.contentType === 'application/pdf' || !!document.querySelector('embed[type="application/pdf"]') }))()`
      );
    } catch {
      res = { title: t.title, url: t.url, text: '', selection: '', isPdf: /\.pdf($|[?#])/i.test(t.url) };
    }
    if (res.isPdf || /\.pdf($|[?#])/i.test(t.url)) return api.pdfText(t.url);
    return { url: res.url, title: res.title || t.title, text: res.text, selection: res.selection || undefined, kind: 'webpage' };
  }, []);

  // ------------------------------------------------------------ commands
  const runCommand = useCallback(
    (cmd: MenuCommand) => {
      const t = tabsRef.current.find((x) => x.id === activeRef.current);
      const wv = t ? webviews.current.get(t.id) : undefined;
      const web = t?.kind === 'web' && wv;
      const zoom = (d: number | null) => {
        if (!web) return;
        wv.setZoomLevel(d === null ? 0 : Math.max(-5, Math.min(5, wv.getZoomLevel() + d)));
      };
      switch (cmd) {
        case 'new-tab':
          newTab();
          break;
        case 'close-tab':
          if (t) closeTab(t.id);
          break;
        case 'reopen-tab': {
          const c = closed.current.pop();
          if (c) newTab(c.url);
          break;
        }
        case 'focus-address':
          topbar.current?.focusAddress();
          break;
        case 'reload':
          if (web) wv.reload();
          break;
        case 'hard-reload':
          if (web) wv.reloadIgnoringCache();
          break;
        case 'back':
          if (web && wv.canGoBack()) wv.goBack();
          else if (t?.kind === 'web' && t.thread.length) updateTab(t.id, { kind: 'home', loading: false });
          break;
        case 'forward':
          if (web && wv.canGoForward()) wv.goForward();
          break;
        case 'home':
          if (t) updateTab(t.id, { kind: 'home', loading: false, title: t.thread.length ? t.thread[0].query : 'New Tab' });
          break;
        case 'next-tab':
        case 'prev-tab': {
          const ts = tabsRef.current;
          const i = ts.findIndex((x) => x.id === activeRef.current);
          setActiveId(ts[(i + (cmd === 'next-tab' ? 1 : ts.length - 1)) % ts.length].id);
          break;
        }
        case 'toggle-assistant':
          setAssistantOpen((o) => !o);
          break;
        case 'summarize-page':
          setAssistantOpen(true);
          setQueued({ id: uid(), task: 'summarize' });
          break;
        case 'bookmark-page':
          if (t?.kind === 'web') api.toggleBookmark({ url: t.url, title: t.title, favicon: t.favicon });
          break;
        case 'show-history':
          setPanel('history');
          break;
        case 'show-bookmarks':
          setPanel('bookmarks');
          break;
        case 'show-downloads':
          setPanel('downloads');
          break;
        case 'show-downloads-toast':
          break;
        case 'show-settings':
          api.secretStatus().then(setSecrets);
          setPanel('settings');
          break;
        case 'find':
          if (t?.kind === 'web') setFind((f) => ({ ...f, open: true }));
          break;
        case 'zoom-in':
          zoom(0.5);
          break;
        case 'zoom-out':
          zoom(-0.5);
          break;
        case 'zoom-reset':
          zoom(null);
          break;
        case 'devtools':
          if (web) wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools();
          break;
        default:
          if (cmd.startsWith('select-tab-')) {
            const n = parseInt(cmd.slice(11), 10);
            const ts = tabsRef.current;
            const target = n === 9 ? ts[ts.length - 1] : ts[n - 1];
            if (target) setActiveId(target.id);
          }
      }
    },
    [closeTab, newTab, updateTab]
  );

  useEffect(() => {
    const offs = [
      api.onMenu(runCommand),
      api.onOpenTab(({ url, background }) => newTab(url, { background })),
      api.onContextAction((a) => {
        if (a.action === 'open-in-new-tab' && a.url) newTab(a.url, { background: true });
        if (a.action === 'search-ai' && a.text) navigateInput(a.text, 'quick', 'new');
        if (a.action === 'summarize') runCommand('summarize-page');
        if (a.action === 'ask-ai' || a.action === 'translate') {
          setAssistantOpen(true);
          setQueued({ id: uid(), task: a.action === 'ask-ai' ? 'ask' : 'translate', text: a.text });
        }
      })
    ];
    return () => offs.forEach((o) => o());
  }, [runCommand, newTab, navigateInput]);

  // Find in page
  const findWv = () => webviews.current.get(activeRef.current);
  useEffect(() => {
    const wv = findWv();
    if (!find.open || !wv) return;
    if (find.text) wv.findInPage(find.text);
    else wv.stopFindInPage('clearSelection');
  }, [find.text, find.open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!find.open) findWv()?.stopFindInPage('clearSelection');
  }, [find.open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setFind({ open: false, text: '' }), [activeId]);

  const register = useCallback((id: string, el: WebviewTag | null) => {
    if (el) webviews.current.set(id, el);
    else webviews.current.delete(id);
  }, []);
  const onVisit = useCallback((url: string, title: string, favicon?: string) => {
    api.addHistory({ url, title, favicon });
  }, []);
  const onFound = useCallback((r: { activeMatchOrdinal: number; matches: number }) => setFind((f) => ({ ...f, result: r })), []);

  const bookmarked = useMemo(() => active?.kind === 'web' && bookmarks.some((b) => b.url === active.url), [active, bookmarks]);
  const openFromPanel = (url: string) => {
    setPanel(null);
    if (active?.kind === 'home' && !active.thread.length) loadInTab(active.id, url);
    else newTab(url);
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar
        ref={topbar}
        tabs={tabs}
        activeId={active.id}
        isPrivate={info.isPrivate}
        bookmarked={bookmarked}
        assistantOpen={assistantOpen}
        trackingProtection={settings.trackingProtection}
        aiEnabled={settings.aiEnabled}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={() => newTab()}
        onNavigate={(input) => navigateInput(input)}
        onBack={() => runCommand('back')}
        onForward={() => runCommand('forward')}
        onReload={() => runCommand('reload')}
        onStopLoading={() => webviews.current.get(active.id)?.stop()}
        onHome={() => runCommand('home')}
        onToggleBookmark={() => runCommand('bookmark-page')}
        onToggleAssistant={() => setAssistantOpen((o) => !o)}
        onOpenPanel={(p) => {
          if (p === 'settings') api.secretStatus().then(setSecrets);
          setPanel(p);
        }}
        onNewPrivateWindow={() => api.newWindow(true)}
        onReorder={(from, to) =>
          setTabs((ts) => {
            const a = ts.findIndex((t) => t.id === from);
            const b = ts.findIndex((t) => t.id === to);
            const copy = [...ts];
            const [m] = copy.splice(a, 1);
            copy.splice(b, 0, m);
            return copy;
          })
        }
      />

      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {tabs.map((t) =>
            t.kind === 'web' ? (
              <WebTab key={t.id} tab={t} active={t.id === active.id} partition={partition} register={register} onUpdate={updateTab} onVisit={onVisit} onFound={onFound} />
            ) : (
              <div key={t.id} className={`absolute inset-0 ${t.id === active.id ? 'visible z-10' : 'invisible z-0'}`}>
                <HomeView
                  tab={t}
                  active={t.id === active.id}
                  settings={settings}
                  secrets={secrets}
                  bookmarks={bookmarks}
                  isPrivate={info.isPrivate}
                  onAsk={(q, mode) => {
                    const url = toNavigableUrl(q);
                    if (url) loadInTab(t.id, url);
                    else if (!settings.aiEnabled) loadInTab(t.id, searchUrl(settings.searchEngineForAddressBar === 'ai' ? 'duckduckgo' : settings.searchEngineForAddressBar, q));
                    else ask(t.id, q, mode);
                  }}
                  onOpen={(url) => newTab(url)}
                  onOpenHere={(url) => loadInTab(t.id, url)}
                  onStop={() => t.thread.forEach((x) => x.status === 'running' && api.abort(x.requestId))}
                  onRetry={(i) => ask(t.id, t.thread[i].query, t.thread[i].mode, i)}
                  onOpenSettings={() => setPanel('settings')}
                />
              </div>
            )
          )}

          <AnimatePresence>
            {find.open && active.kind === 'web' && (
              <motion.div
                initial={{ y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                className="absolute right-4 top-3 z-30 flex items-center gap-1 rounded-2xl border border-ink-200 bg-white px-2 py-1.5 shadow-xl dark:border-ink-700 dark:bg-ink-900"
              >
                <input
                  autoFocus
                  value={find.text}
                  onChange={(e) => setFind((f) => ({ ...f, text: e.target.value }))}
                  onKeyDown={(e) => {
                    const wv = findWv();
                    if (e.key === 'Enter' && wv && find.text) wv.findInPage(find.text, { findNext: true, forward: !e.shiftKey });
                    if (e.key === 'Escape') setFind({ open: false, text: '' });
                  }}
                  placeholder="Find in page"
                  className="w-48 bg-transparent px-2 text-sm outline-none"
                />
                <span className="w-14 text-right text-xs text-ink-400">{find.text && find.result ? `${find.result.activeMatchOrdinal}/${find.result.matches}` : ''}</span>
                <button className="rounded-lg p-1 hover:bg-ink-100 dark:hover:bg-ink-800" onClick={() => find.text && findWv()?.findInPage(find.text, { findNext: true, forward: false })}>
                  <ChevronUp size={15} />
                </button>
                <button className="rounded-lg p-1 hover:bg-ink-100 dark:hover:bg-ink-800" onClick={() => find.text && findWv()?.findInPage(find.text, { findNext: true, forward: true })}>
                  <ChevronDown size={15} />
                </button>
                <button className="rounded-lg p-1 hover:bg-ink-100 dark:hover:bg-ink-800" onClick={() => setFind({ open: false, text: '' })}>
                  <X size={15} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {toast && (
              <motion.button
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                onClick={() => {
                  setPanel('downloads');
                  setToast(null);
                }}
                className="absolute bottom-4 right-4 z-30 flex w-72 items-center gap-3 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-left shadow-xl dark:border-ink-700 dark:bg-ink-900"
              >
                <Download size={18} className="shrink-0 text-sky" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{toast.filename}</span>
                  <span className="block text-xs text-ink-500">
                    {toast.state === 'completed' ? 'Downloaded' : toast.state === 'progressing' ? `Downloading… ${toast.totalBytes ? Math.round((toast.receivedBytes / toast.totalBytes) * 100) + '%' : ''}` : 'Download failed'}
                  </span>
                </span>
              </motion.button>
            )}
          </AnimatePresence>
        </main>

        <AnimatePresence>
          {assistantOpen && settings.aiEnabled && (
            <AssistantPanel
              isPrivate={info.isPrivate}
              settings={settings}
              getPage={getPage}
              onOpen={(url) => newTab(url)}
              onClose={() => setAssistantOpen(false)}
              onOpenSettings={() => setPanel('settings')}
              queued={queued}
              onQueuedHandled={() => setQueued(null)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {panel === 'settings' && secrets !== null && (
            <SettingsPanel settings={settings} secrets={secrets} version={info.version} onSettings={setSettings} onSecrets={setSecrets} onClose={() => (setPanel(null), api.secretStatus().then(setSecrets))} />
          )}
          {panel && panel !== 'settings' && (
            <LibraryPanel tab={panel} setTab={setPanel} bookmarks={bookmarks} downloads={downloads} isPrivate={info.isPrivate} onOpen={openFromPanel} onClose={() => setPanel(null)} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
