import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark as BookmarkIcon,
  Clock,
  Download,
  Globe,
  Home,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  RotateCw,
  Search,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Star,
  X
} from 'lucide-react';
import type { Tab } from '../state';
import { hostOf } from '../state';
import { Logo } from './Logo';

export interface TopBarHandle {
  focusAddress: () => void;
}

interface Props {
  tabs: Tab[];
  activeId: string;
  isPrivate: boolean;
  bookmarked: boolean;
  assistantOpen: boolean;
  trackingProtection: boolean;
  aiEnabled: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onNavigate: (input: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStopLoading: () => void;
  onHome: () => void;
  onToggleBookmark: () => void;
  onToggleAssistant: () => void;
  onOpenPanel: (p: 'history' | 'bookmarks' | 'downloads' | 'settings') => void;
  onNewPrivateWindow: () => void;
  onReorder: (from: string, to: string) => void;
}

export const TopBar = forwardRef<TopBarHandle, Props>(function TopBar(p, ref) {
  const active = p.tabs.find((t) => t.id === p.activeId);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dragId = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    focusAddress: () => {
      input.current?.focus();
      input.current?.select();
    }
  }));

  useEffect(() => {
    if (!editing) setAddress(active?.kind === 'web' ? active.url : '');
  }, [active?.url, active?.kind, active?.id, editing]);

  const isWeb = active?.kind === 'web';
  const secure = isWeb && active.url.startsWith('https://');

  return (
    <div className="drag relative z-30 flex flex-col border-b border-ink-200/80 bg-ink-100/80 backdrop-blur-xl dark:border-ink-800/80 dark:bg-ink-900/80">
      {/* Tab strip */}
      <div className="flex h-[42px] items-end gap-1 pl-[84px] pr-2">
        <div className="no-drag flex min-w-0 flex-1 items-end gap-1 overflow-x-auto scroll-thin" style={{ scrollbarWidth: 'none' }}>
          <AnimatePresence initial={false}>
            {p.tabs.map((t) => {
              const sel = t.id === p.activeId;
              return (
                <motion.div
                  layout
                  key={t.id}
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.18 }}
                  draggable
                  onDragStart={() => (dragId.current = t.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragId.current && dragId.current !== t.id) p.onReorder(dragId.current, t.id);
                    dragId.current = null;
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      p.onClose(t.id);
                    } else p.onSelect(t.id);
                  }}
                  title={t.kind === 'web' ? `${t.title}\n${t.url}` : t.title}
                  className={`group relative flex h-[34px] min-w-[44px] max-w-[220px] flex-1 cursor-default items-center gap-2 overflow-hidden rounded-t-xl px-3 text-[12.5px] transition-colors ${
                    sel
                      ? 'bg-ink-50 text-ink-900 shadow-[0_-1px_0_rgba(0,0,0,0.04)] dark:bg-ink-950 dark:text-white'
                      : 'text-ink-500 hover:bg-ink-200/60 dark:text-ink-400 dark:hover:bg-ink-800/60'
                  }`}
                  style={{ flexBasis: 200 }}
                >
                  {sel && <span className="brand-bg absolute inset-x-3 top-0 h-[2px] rounded-full" />}
                  {t.loading ? (
                    <Loader2 size={14} className="shrink-0 animate-spin text-grape" />
                  ) : t.kind === 'home' ? (
                    <Logo size={14} className="shrink-0" />
                  ) : t.favicon ? (
                    <img src={t.favicon} className="h-3.5 w-3.5 shrink-0 rounded-sm" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  ) : (
                    <Globe size={14} className="shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{t.title || (t.kind === 'web' ? hostOf(t.url) : 'New Tab')}</span>
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => p.onClose(t.id)}
                    className={`-mr-1 shrink-0 rounded-md p-0.5 hover:bg-ink-300/60 dark:hover:bg-ink-700 ${sel ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'}`}
                    aria-label="Close tab"
                  >
                    <X size={13} />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
          <button onClick={p.onNew} className="mb-1.5 ml-0.5 shrink-0 rounded-lg p-1.5 text-ink-500 hover:bg-ink-200 dark:hover:bg-ink-800" aria-label="New tab" title="New tab (⌘T)">
            <Plus size={16} />
          </button>
        </div>
        {p.isPrivate && (
          <span className="no-drag mb-2 ml-2 flex shrink-0 items-center gap-1 rounded-full bg-grape px-2.5 py-0.5 text-[11px] font-semibold text-white">
            <Lock size={11} /> Private
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex h-[46px] items-center gap-1 bg-ink-50 px-2 dark:bg-ink-950">
        <div className="no-drag flex items-center">
          <IconButton label="Back (⌘[)" onClick={p.onBack} disabled={!active || (active.kind === 'home' && true) || (!active.canGoBack && active.thread.length === 0)}>
            <ArrowLeft size={17} />
          </IconButton>
          <IconButton label="Forward (⌘])" onClick={p.onForward} disabled={!isWeb || !active.canGoForward}>
            <ArrowRight size={17} />
          </IconButton>
          {isWeb && active.loading ? (
            <IconButton label="Stop" onClick={p.onStopLoading}>
              <X size={17} />
            </IconButton>
          ) : (
            <IconButton label="Reload (⌘R)" onClick={p.onReload} disabled={!isWeb}>
              <RotateCw size={16} />
            </IconButton>
          )}
          <IconButton label="Home (⇧⌘H)" onClick={p.onHome}>
            <Home size={16} />
          </IconButton>
        </div>

        <form
          className="no-drag brand-ring mx-1 flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-full border border-ink-200 bg-white px-3.5 dark:border-ink-800 dark:bg-ink-900"
          onSubmit={(e) => {
            e.preventDefault();
            if (address.trim()) p.onNavigate(address);
            input.current?.blur();
          }}
        >
          {isWeb ? (
            secure ? (
              <Lock size={13} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Globe size={13} className="shrink-0 text-ink-400" />
            )
          ) : p.aiEnabled ? (
            <Sparkles size={14} className="shrink-0 text-ember" />
          ) : (
            <Search size={14} className="shrink-0 text-ink-400" />
          )}
          <input
            ref={input}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => {
              setEditing(true);
              e.currentTarget.select();
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAddress(active?.kind === 'web' ? active.url : '');
                input.current?.blur();
              }
            }}
            spellCheck={false}
            placeholder={p.aiEnabled ? 'Search with AI or enter a website' : 'Search or enter a website'}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-400"
          />
          {isWeb && p.trackingProtection && active.blocked > 0 && (
            <span title={`${active.blocked} trackers blocked on this page`} className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              <Shield size={11} /> {active.blocked}
            </span>
          )}
          {isWeb && (
            <button type="button" onClick={p.onToggleBookmark} title="Bookmark (⌘D)" className="shrink-0 text-ink-400 hover:text-sun">
              <Star size={15} className={p.bookmarked ? 'fill-sun text-sun' : ''} />
            </button>
          )}
        </form>

        <div className="no-drag flex items-center">
          {p.aiEnabled && (
          <button
            onClick={p.onToggleAssistant}
            title="AI Assistant (⌘E)"
            className={`flex h-[32px] items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition ${
              p.assistantOpen ? 'brand-bg text-white shadow-glow' : 'text-ink-600 hover:bg-ink-200 dark:text-ink-300 dark:hover:bg-ink-800'
            }`}
          >
            <Sparkles size={15} /> Assistant
          </button>
          )}
          <div className="relative">
            <IconButton label="Menu" onClick={() => setMenu((m) => !m)}>
              <MoreHorizontal size={18} />
            </IconButton>
            <AnimatePresence>
              {menu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-2xl border border-ink-200 bg-white p-1.5 shadow-xl dark:border-ink-800 dark:bg-ink-900"
                  >
                    {(
                      [
                        ['New private window', '⇧⌘N', Lock, p.onNewPrivateWindow],
                        ['History', '⌘Y', Clock, () => p.onOpenPanel('history')],
                        ['Bookmarks', '⌥⌘B', BookmarkIcon, () => p.onOpenPanel('bookmarks')],
                        ['Downloads', '⌥⌘L', Download, () => p.onOpenPanel('downloads')],
                        ['Settings', '⌘,', SettingsIcon, () => p.onOpenPanel('settings')]
                      ] as const
                    ).map(([label, key, Icon, fn]) => (
                      <button
                        key={label}
                        onClick={() => {
                          setMenu(false);
                          fn();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] hover:bg-ink-100 dark:hover:bg-ink-800"
                      >
                        <Icon size={15} className="text-ink-500" /> <span className="flex-1">{label}</span>
                        <span className="text-[11px] text-ink-400">{key}</span>
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      {isWeb && active.loading && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
          <div className="brand-bg h-full w-1/3 animate-[shimmer_1.2s_linear_infinite]" style={{ backgroundSize: '200% 100%', animation: 'loadbar 1.2s ease-in-out infinite' }} />
        </div>
      )}
      <style>{`@keyframes loadbar { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
    </div>
  );
});

function IconButton({ children, label, onClick, disabled }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-[32px] w-[32px] items-center justify-center rounded-full text-ink-600 transition hover:bg-ink-200 disabled:opacity-30 disabled:hover:bg-transparent dark:text-ink-300 dark:hover:bg-ink-800"
    >
      {children}
    </button>
  );
}
