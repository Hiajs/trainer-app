import { motion } from 'framer-motion';
import type { Source } from '../../shared/types';
import { hostOf } from '../state';

export function SourceCards({ sources, onOpen, compact = false }: { sources: Source[]; onOpen: (url: string) => void; compact?: boolean }) {
  if (!sources.length) return null;
  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
      {sources.map((s, i) => (
        <motion.button
          key={s.url}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
          onClick={() => onOpen(s.url)}
          title={s.url}
          className="group flex min-w-0 flex-col gap-1.5 rounded-xl border border-ink-200 bg-white/80 p-2.5 text-left transition hover:-translate-y-0.5 hover:border-grape/50 hover:shadow-glow dark:border-ink-800 dark:bg-ink-900/70"
        >
          <span className="line-clamp-2 text-[12.5px] font-medium leading-snug text-ink-800 dark:text-ink-100">{s.title || hostOf(s.url)}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-ink-500 dark:text-ink-400">
            {s.favicon && <img src={s.favicon} className="h-3.5 w-3.5 rounded-sm" onError={(e) => (e.currentTarget.style.display = 'none')} />}
            <span className="truncate">{hostOf(s.url)}</span>
            <span className="ml-auto rounded bg-ink-100 px-1 font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-300">{s.index}</span>
          </span>
        </motion.button>
      ))}
    </div>
  );
}
