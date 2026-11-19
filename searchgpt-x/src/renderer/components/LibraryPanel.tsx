import { useEffect, useMemo, useState } from 'react';
import { File, FolderOpen, Pause, Play, Search, Trash2, X } from 'lucide-react';
import type { Bookmark, DownloadItemInfo, HistoryEntry } from '../../shared/types';
import { api } from '../api';
import { faviconFor, hostOf } from '../state';
import { Overlay } from './Overlay';

export type LibraryTab = 'history' | 'bookmarks' | 'downloads';

interface Props {
  tab: LibraryTab;
  setTab: (t: LibraryTab) => void;
  bookmarks: Bookmark[];
  downloads: DownloadItemInfo[];
  isPrivate: boolean;
  onOpen: (url: string) => void;
  onClose: () => void;
}

function fmtBytes(n: number) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function LibraryPanel(p: Props) {
  const [q, setQ] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const refresh = () => api.searchHistory(q).then(setHistory);
  useEffect(() => {
    if (p.tab === 'history') void refresh();
  }, [q, p.tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const out: [string, HistoryEntry[]][] = [];
    for (const h of history) {
      const k = dayLabel(h.visitedAt);
      if (!out.length || out[out.length - 1][0] !== k) out.push([k, []]);
      out[out.length - 1][1].push(h);
    }
    return out;
  }, [history]);

  const ql = q.toLowerCase();
  const bms = p.bookmarks.filter((b) => !ql || b.title.toLowerCase().includes(ql) || b.url.toLowerCase().includes(ql));

  return (
    <Overlay
      wide
      onClose={p.onClose}
      title={
        <div className="flex items-center gap-1">
          {(['history', 'bookmarks', 'downloads'] as const).map((t) => (
            <button
              key={t}
              onClick={() => p.setTab(t)}
              className={`rounded-full px-3 py-1 text-[13px] capitalize ${p.tab === t ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900' : 'text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800'}`}
            >
              {t}
            </button>
          ))}
        </div>
      }
    >
      {p.tab !== 'downloads' && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-ink-200 bg-white px-5 py-2.5 dark:border-ink-800 dark:bg-ink-900">
          <Search size={15} className="text-ink-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${p.tab}`} className="flex-1 bg-transparent text-sm outline-none" />
          {p.tab === 'history' && history.length > 0 && (
            <button
              onClick={async () => {
                if (confirm('Clear all browsing history?')) {
                  await api.clearHistory();
                  void refresh();
                }
              }}
              className="text-xs text-ember hover:underline"
            >
              Clear history
            </button>
          )}
        </div>
      )}

      {p.tab === 'history' && (
        <div className="px-3 py-2">
          {p.isPrivate && <p className="px-2 py-2 text-xs text-ink-400">Private windows don’t add to history.</p>}
          {!history.length && <Empty text={q ? 'No matching history.' : 'No history yet.'} />}
          {grouped.map(([day, items]) => (
            <div key={day} className="mb-3">
              <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{day}</div>
              {items.map((h) => (
                <Row
                  key={h.id}
                  icon={h.favicon || faviconFor(h.url)}
                  title={h.title || hostOf(h.url)}
                  sub={h.url}
                  meta={new Date(h.visitedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  onClick={() => p.onOpen(h.url)}
                  onRemove={async () => {
                    await api.removeHistory(h.id);
                    void refresh();
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {p.tab === 'bookmarks' && (
        <div className="px-3 py-2">
          {!bms.length && <Empty text={q ? 'No matching bookmarks.' : 'No bookmarks yet. Press ⌘D on any page.'} />}
          {bms.map((b) => (
            <Row key={b.id} icon={b.favicon || faviconFor(b.url)} title={b.title || hostOf(b.url)} sub={b.url} onClick={() => p.onOpen(b.url)} onRemove={() => api.removeBookmark(b.id)} />
          ))}
        </div>
      )}

      {p.tab === 'downloads' && (
        <div className="px-3 py-2">
          <div className="flex justify-end px-2 pb-1">
            {p.downloads.some((d) => d.state !== 'progressing') && (
              <button onClick={() => api.downloadAction('', 'clear')} className="text-xs text-ember hover:underline">
                Clear list
              </button>
            )}
          </div>
          {!p.downloads.length && <Empty text="No downloads yet." />}
          {p.downloads.map((d) => {
            const pct = d.totalBytes ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
            return (
              <div key={d.id} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-ink-100/70 dark:hover:bg-ink-800/60">
                <File size={20} className="shrink-0 text-ink-400" />
                <div className="min-w-0 flex-1">
                  <button onClick={() => d.state === 'completed' && api.downloadAction(d.id, 'open')} className="block max-w-full truncate text-left text-[13.5px] font-medium hover:underline">
                    {d.filename}
                  </button>
                  <div className="text-xs text-ink-500">
                    {d.state === 'progressing'
                      ? `${fmtBytes(d.receivedBytes)} of ${d.totalBytes ? fmtBytes(d.totalBytes) : '?'}${d.paused ? ' · Paused' : ''}`
                      : d.state === 'completed'
                        ? `${fmtBytes(d.totalBytes || d.receivedBytes)} · ${hostOf(d.url)}`
                        : d.state === 'cancelled'
                          ? 'Cancelled'
                          : 'Failed'}
                  </div>
                  {d.state === 'progressing' && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
                      <div className="brand-bg h-full transition-all" style={{ width: `${d.totalBytes ? pct : 30}%` }} />
                    </div>
                  )}
                </div>
                {d.state === 'progressing' && (
                  <>
                    <SmallBtn title={d.paused ? 'Resume' : 'Pause'} onClick={() => api.downloadAction(d.id, d.paused ? 'resume' : 'pause')}>
                      {d.paused ? <Play size={14} /> : <Pause size={14} />}
                    </SmallBtn>
                    <SmallBtn title="Cancel" onClick={() => api.downloadAction(d.id, 'cancel')}>
                      <X size={14} />
                    </SmallBtn>
                  </>
                )}
                {d.state === 'completed' && (
                  <SmallBtn title="Show in Finder" onClick={() => api.downloadAction(d.id, 'show')}>
                    <FolderOpen size={14} />
                  </SmallBtn>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Overlay>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-12 text-center text-sm text-ink-400">{text}</p>;
}

function SmallBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-200 dark:hover:bg-ink-700">
      {children}
    </button>
  );
}

function Row({ icon, title, sub, meta, onClick, onRemove }: { icon?: string; title: string; sub: string; meta?: string; onClick: () => void; onRemove: () => void }) {
  return (
    <div className="group flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-ink-100/70 dark:hover:bg-ink-800/60">
      <img src={icon} className="h-4 w-4 shrink-0 rounded-sm" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
      <button onClick={onClick} className="min-w-0 flex-1 text-left">
        <div className="truncate text-[13.5px]">{title}</div>
        <div className="truncate text-[11.5px] text-ink-400">{sub}</div>
      </button>
      {meta && <span className="shrink-0 text-xs text-ink-400">{meta}</span>}
      <button onClick={onRemove} title="Remove" className="shrink-0 rounded-lg p-1.5 text-ink-400 opacity-0 hover:bg-ink-200 group-hover:opacity-100 dark:hover:bg-ink-700">
        <Trash2 size={13} />
      </button>
    </div>
  );
}
