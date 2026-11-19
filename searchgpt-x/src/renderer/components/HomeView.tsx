import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, Lock, Plus } from 'lucide-react';
import type { Bookmark, SearchMode, SecretStatus, Settings } from '../../shared/types';
import type { Tab } from '../state';
import { faviconFor, hostOf } from '../state';
import { Logo } from './Logo';
import { SearchBox, SearchBoxHandle } from './SearchBox';
import { TurnView } from './TurnView';

interface Props {
  tab: Tab;
  active: boolean;
  settings: Settings;
  secrets: SecretStatus | null;
  bookmarks: Bookmark[];
  isPrivate: boolean;
  onAsk: (q: string, mode: SearchMode) => void;
  onOpen: (url: string) => void;
  onOpenHere: (url: string) => void;
  onStop: () => void;
  onRetry: (turnIndex: number) => void;
  onOpenSettings: () => void;
}

const SUGGESTIONS = [
  'Explain how black holes form, simply',
  'Compare the M4 MacBook Air and MacBook Pro for students',
  'What are the best study techniques backed by research?',
  'Summarize the latest news in AI this week'
];

export function HomeView(p: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<SearchBoxHandle>(null);
  const turns = p.tab.thread;
  const running = turns.some((t) => t.status === 'running');
  const ai = p.settings.aiEnabled;
  const aiReady = !ai || !p.secrets ? true :  p.settings.aiProvider === 'openai' ? p.secrets.openaiKey : p.secrets.anthropicKey;

  useEffect(() => {
    const el = scroller.current;
    if (!el || !running) return;
    // Follow streaming output only when the user is already near the bottom.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    if (p.active) box.current?.focus();
  }, [p.active, turns.length]);

  if (!turns.length) {
    return (
      <div className="scroll-thin relative flex h-full flex-col items-center overflow-y-auto px-6">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-to-r from-sun/25 via-ember/20 to-grape/25 blur-3xl dark:from-sun/10 dark:via-ember/10 dark:to-grape/20" />
          <div className="absolute -bottom-48 right-[-10%] h-[420px] w-[520px] rounded-full bg-sky/15 blur-3xl dark:bg-sky/10" />
        </div>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="relative z-10 mt-[12vh] flex w-full max-w-[720px] flex-col items-center">
          <Logo size={68} />
          <h1 className="mt-4 font-display text-[42px] font-bold tracking-tight">
            Search<span className="brand-text">GPT</span> <span className="text-ink-400">X</span>
          </h1>
          <p className="mb-7 mt-1 text-[15px] text-ink-500 dark:text-ink-400">
            {p.isPrivate ? (
              <span className="inline-flex items-center gap-1.5">
                <Lock size={14} /> Private window — no history, cookies cleared when you close it.
              </span>
            ) : ai ? (
              'Ask a question. Get a cited answer from the live web.'
            ) : (
              'Search the web privately.'
            )}
          </p>
          <div className="w-full">
            <SearchBox ref={box} big autoFocus showModes={ai} onSubmit={p.onAsk} placeholder={ai ? 'Ask anything, or type a website…' : 'Search the web or type a website…'} />
          </div>

          {!aiReady && (
            <button
              onClick={p.onOpenSettings}
              className="mt-4 flex items-center gap-2 rounded-full border border-ember/40 bg-ember/10 px-4 py-2 text-sm text-ink-800 transition hover:bg-ember/20 dark:text-ink-100"
            >
              <KeyRound size={15} className="text-ember" /> Add an AI key in Settings to turn on answers (browsing works without one)
            </button>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {ai && SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => p.onAsk(s, s.startsWith('Compare') ? 'compare' : 'quick')}
                className="rounded-full border border-ink-200 bg-white/60 px-3.5 py-1.5 text-[13px] text-ink-600 transition hover:border-grape/40 hover:text-ink-900 dark:border-ink-800 dark:bg-ink-900/60 dark:text-ink-300 dark:hover:text-white"
              >
                {s}
              </button>
            ))}
          </div>

          {p.bookmarks.length > 0 && (
            <div className="mt-10 grid w-full grid-cols-4 gap-3 sm:grid-cols-6">
              {p.bookmarks.slice(0, 12).map((b) => (
                <button key={b.id} onClick={() => p.onOpenHere(b.url)} className="group flex flex-col items-center gap-1.5 rounded-2xl p-2 transition hover:bg-white/70 dark:hover:bg-ink-900" title={b.url}>
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-ink-200 dark:bg-ink-800 dark:ring-ink-700">
                    <img src={b.favicon || faviconFor(b.url)} className="h-5 w-5" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                  </span>
                  <span className="w-full truncate text-center text-[11.5px] text-ink-500">{b.title || hostOf(b.url)}</span>
                </button>
              ))}
            </div>
          )}
          {!p.bookmarks.length && (
            <p className="mt-10 flex items-center gap-1 text-xs text-ink-400">
              <Plus size={12} /> Bookmark pages with ⌘D and they’ll show up here.
            </p>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scroller} className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[820px] px-8 pb-10 pt-10">
          {turns.map((t, i) => (
            <TurnView
              key={t.id}
              turn={t}
              isLast={i === turns.length - 1}
              onOpen={p.onOpen}
              onFollowUp={(q, mode) => p.onAsk(q, mode ?? 'quick')}
              onRetry={() => p.onRetry(i)}
              onStop={p.onStop}
            />
          ))}
        </div>
      </div>
      <div className="border-t border-ink-200/70 bg-ink-50/80 backdrop-blur dark:border-ink-800/70 dark:bg-ink-950/80">
        <div className="mx-auto w-full max-w-[820px] px-8 py-3">
          <SearchBox ref={box} onSubmit={p.onAsk} placeholder="Ask a follow-up…" disabled={running} />
        </div>
      </div>
    </div>
  );
}
