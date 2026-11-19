import { memo, useEffect, useRef } from 'react';
import type { WebviewTag } from 'electron';
import { RefreshCw, WifiOff } from 'lucide-react';
import type { Tab } from '../state';

interface Props {
  tab: Tab;
  active: boolean;
  partition: string;
  register: (id: string, el: WebviewTag | null) => void;
  onUpdate: (id: string, patch: Partial<Tab>) => void;
  onVisit: (url: string, title: string, favicon?: string) => void;
  onFound: (r: { activeMatchOrdinal: number; matches: number }) => void;
}

export const WebTab = memo(function WebTab({ tab, active, partition, register, onUpdate, onVisit, onFound }: Props) {
  const ref = useRef<WebviewTag>(null);
  const latest = useRef({ tab, onUpdate, onVisit, onFound });
  latest.current = { tab, onUpdate, onVisit, onFound };

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    register(tab.id, wv);
    const id = tab.id;
    const up = (patch: Partial<Tab>) => latest.current.onUpdate(id, patch);
    const nav = () => {
      try {
        up({ canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(), url: wv.getURL() });
      } catch {
        /* not ready yet */
      }
    };
    const handlers: Record<string, (e: any) => void> = {
      'dom-ready': () => {
        up({ webContentsId: wv.getWebContentsId() });
        nav();
      },
      'did-start-loading': () => up({ loading: true, error: undefined }),
      'did-stop-loading': () => {
        up({ loading: false });
        nav();
      },
      'did-navigate': (e) => {
        up({ url: e.url, blocked: 0, error: undefined });
        nav();
        // Record the visit once the title is known (see page-title-updated).
      },
      'did-navigate-in-page': (e) => {
        if (e.isMainFrame) {
          up({ url: e.url });
          nav();
        }
      },
      'page-title-updated': (e) => {
        up({ title: e.title });
        latest.current.onVisit(wv.getURL(), e.title, latest.current.tab.favicon);
      },
      'page-favicon-updated': (e) => {
        const fav = e.favicons?.[0];
        if (fav) up({ favicon: fav });
      },
      'did-fail-load': (e) => {
        // -3 is ERR_ABORTED (user navigated away / download) — not an error worth showing.
        if (e.isMainFrame && e.errorCode !== -3) up({ error: { code: e.errorCode, description: e.errorDescription, url: e.validatedURL }, loading: false });
      },
      'found-in-page': (e) => latest.current.onFound(e.result),
      'render-process-gone': () => up({ error: { code: -1000, description: 'This page crashed or ran out of memory.', url: wv.getURL() }, loading: false })
    };
    for (const [ev, h] of Object.entries(handlers)) wv.addEventListener(ev as any, h);
    return () => {
      for (const [ev, h] of Object.entries(handlers)) wv.removeEventListener(ev as any, h);
      register(id, null);
    };
  }, [tab.id, tab.epoch]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`absolute inset-0 ${active ? 'visible z-10' : 'invisible z-0'}`}>
      <webview
        key={tab.epoch}
        ref={ref as any}
        src={tab.initialUrl}
        partition={partition}
        allowpopups="true"
        webpreferences="contextIsolation=yes,sandbox=yes,nodeIntegration=no"
        style={{ width: '100%', height: '100%' }}
      />
      {tab.error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink-50 px-8 text-center dark:bg-ink-950">
          <WifiOff size={40} className="mb-4 text-ink-400" />
          <h2 className="text-xl font-semibold">This page couldn’t be loaded</h2>
          <p className="mt-2 max-w-md text-sm text-ink-500">
            {tab.error.description || 'Unknown error'} ({tab.error.code})
            <br />
            <span className="break-all text-ink-400">{tab.error.url}</span>
          </p>
          <p className="mt-3 max-w-md text-xs text-ink-400">
            If you’re on a school or work network, the network itself may block this site — the browser can’t change that.
          </p>
          <button
            onClick={() => {
              onUpdate(tab.id, { error: undefined });
              ref.current?.reload();
            }}
            className="brand-bg mt-5 flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium text-white"
          >
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}
    </div>
  );
});
