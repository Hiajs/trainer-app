import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Download, FileText, Image as ImageIcon, Layers, Loader2, RotateCcw, Sparkles, Square, Video } from 'lucide-react';
import type { ImageResult, VideoResult } from '../../shared/types';
import { api } from '../api';
import type { Turn } from '../state';
import { hostOf } from '../state';
import { Markdown } from './Markdown';
import { SourceCards } from './SourceCards';

type View = 'answer' | 'images' | 'videos';

interface Props {
  turn: Turn;
  onOpen: (url: string) => void;
  onFollowUp: (q: string, mode?: Turn['mode']) => void;
  onRetry: () => void;
  onStop: () => void;
  isLast: boolean;
}

function saveMarkdown(turn: Turn) {
  const refs = turn.sources.map((s) => `[${s.index}] ${s.title} — ${s.url}`).join('\n');
  const md = `# ${turn.query}\n\n${turn.answer}\n\n## Sources\n\n${refs}\n`;
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${turn.query.slice(0, 60).replace(/[^\w\- ]+/g, '').trim() || 'report'}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function TurnView({ turn, onOpen, onFollowUp, onRetry, onStop, isLast }: Props) {
  const [view, setView] = useState<View>('answer');
  const [images, setImages] = useState<ImageResult[] | null>(null);
  const [videos, setVideos] = useState<VideoResult[] | null>(null);
  const [mediaError, setMediaError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMediaError('');
    if (view === 'images' && !images) api.images(turn.query).then(setImages).catch((e) => setMediaError(e.message));
    if (view === 'videos' && !videos) api.videos(turn.query).then(setVideos).catch((e) => setMediaError(e.message));
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = turn.status === 'running';
  const lastStep = turn.steps[turn.steps.length - 1];
  const modeLabel = turn.mode === 'research' ? 'Research' : turn.mode === 'compare' ? 'Compare' : null;

  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
      <div className="mb-3 flex items-start gap-3">
        <h2 className="selectable flex-1 font-display text-[26px] font-semibold leading-tight tracking-tight text-ink-900 dark:text-white">{turn.query}</h2>
        {modeLabel && <span className="mt-1.5 rounded-full bg-grape/15 px-2.5 py-0.5 text-xs font-medium text-grape dark:text-violet-300">{modeLabel}</span>}
      </div>

      <div className="mb-4 flex items-center gap-1 border-b border-ink-200 dark:border-ink-800">
        {([
          ['answer', 'Answer', Sparkles],
          ['images', 'Images', ImageIcon],
          ['videos', 'Videos', Video]
        ] as const).map(([v, label, Icon]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition ${
              view === v ? 'border-ember font-medium text-ink-900 dark:text-white' : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
        {running && (
          <button onClick={onStop} className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800">
            <Square size={11} fill="currentColor" /> Stop
          </button>
        )}
      </div>

      {view === 'answer' && (
        <>
          <AnimatePresence>
            {running && !turn.answer && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-4 space-y-1.5">
                {turn.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-ink-500 dark:text-ink-400">
                    {i === turn.steps.length - 1 ? <Loader2 size={14} className="animate-spin text-grape" /> : <Check size={14} className="text-emerald-500" />}
                    <span className={i === turn.steps.length - 1 ? 'text-ink-800 dark:text-ink-100' : ''}>{s.label}</span>
                    {s.detail && <span className="truncate text-ink-400">· {s.detail}</span>}
                  </div>
                ))}
                {!lastStep && <div className="shimmer h-4 w-48 rounded" />}
              </motion.div>
            )}
          </AnimatePresence>

          {turn.queries.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {turn.queries.map((q) => (
                <span key={q} className="rounded-full border border-ink-200 px-2.5 py-0.5 text-xs text-ink-500 dark:border-ink-700 dark:text-ink-400">
                  🔎 {q}
                </span>
              ))}
            </div>
          )}

          {turn.sources.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
                <Layers size={13} /> Sources
              </div>
              <SourceCards sources={turn.sources} onOpen={onOpen} />
            </div>
          )}

          {(turn.answer || (running && turn.sources.length > 0)) && (
            <div className="mb-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
                <Sparkles size={13} className="text-ember" /> Answer
              </div>
              {turn.answer ? (
                <Markdown text={turn.answer} sources={turn.sources} onOpen={onOpen} streaming={running} />
              ) : (
                <div className="space-y-2 pt-2">
                  <div className="shimmer h-3.5 w-11/12 rounded" />
                  <div className="shimmer h-3.5 w-9/12 rounded" />
                  <div className="shimmer h-3.5 w-10/12 rounded" />
                </div>
              )}
            </div>
          )}

          {turn.status === 'error' && (
            <div className="mb-3 rounded-xl border border-ember/40 bg-ember/10 px-4 py-3 text-sm text-ink-800 dark:text-ink-100">
              {turn.error}
              <button onClick={onRetry} className="ml-3 font-medium text-ember hover:underline">
                Try again
              </button>
            </div>
          )}

          {turn.status === 'done' && (
            <div className="flex flex-wrap items-center gap-1 text-ink-500">
              <ActionButton
                icon={copied ? <Check size={14} /> : <Copy size={14} />}
                label={copied ? 'Copied' : 'Copy'}
                onClick={() => {
                  navigator.clipboard.writeText(turn.answer);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              />
              <ActionButton icon={<RotateCcw size={14} />} label="Rewrite" onClick={onRetry} />
              <ActionButton icon={<Download size={14} />} label="Save as Markdown" onClick={() => saveMarkdown(turn)} />
              {turn.mode === 'quick' && isLast && (
                <>
                  <ActionButton icon={<FileText size={14} />} label="Deep research" onClick={() => onFollowUp(turn.query, 'research')} />
                  <ActionButton icon={<Layers size={14} />} label="Compare sources" onClick={() => onFollowUp(turn.query, 'compare')} />
                </>
              )}
            </div>
          )}

          {isLast && turn.related && turn.related.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Related</div>
              <div className="divide-y divide-ink-200 rounded-xl border border-ink-200 dark:divide-ink-800 dark:border-ink-800">
                {turn.related.map((q) => (
                  <button key={q} onClick={() => onFollowUp(q)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-ink-100/70 dark:hover:bg-ink-900">
                    {q} <span className="text-ember">+</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {view !== 'answer' && mediaError && <div className="rounded-xl bg-ink-100 px-4 py-3 text-sm dark:bg-ink-900">{mediaError}</div>}
      {view === 'images' && !mediaError && (
        images ? (
          <div className="columns-2 gap-2 md:columns-3 lg:columns-4">
            {images.map((im) => (
              <button key={im.thumbnail} onClick={() => onOpen(im.url)} className="mb-2 block w-full overflow-hidden rounded-xl bg-ink-100 dark:bg-ink-900" title={im.title}>
                <img src={im.thumbnail} loading="lazy" className="w-full transition hover:scale-[1.03]" />
                <div className="truncate px-2 py-1 text-left text-[11px] text-ink-500">{im.source}</div>
              </button>
            ))}
            {!images.length && <p className="text-sm text-ink-500">No images found.</p>}
          </div>
        ) : (
          <MediaLoading />
        )
      )}
      {view === 'videos' && !mediaError && (
        videos ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {videos.map((v) => (
              <button key={v.url} onClick={() => onOpen(v.url)} className="overflow-hidden rounded-xl border border-ink-200 text-left transition hover:shadow-glow dark:border-ink-800">
                <div className="relative aspect-video bg-ink-200 dark:bg-ink-800">
                  {v.thumbnail && <img src={v.thumbnail} loading="lazy" className="h-full w-full object-cover" />}
                  {v.duration && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 text-[11px] text-white">{v.duration}</span>}
                </div>
                <div className="p-2.5">
                  <div className="line-clamp-2 text-sm font-medium">{v.title}</div>
                  <div className="mt-1 text-xs text-ink-500">{[v.publisher || hostOf(v.url), v.age].filter(Boolean).join(' · ')}</div>
                </div>
              </button>
            ))}
            {!videos.length && <p className="text-sm text-ink-500">No videos found.</p>}
          </div>
        ) : (
          <MediaLoading />
        )
      )}
    </motion.section>
  );
}

function MediaLoading() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="shimmer aspect-video rounded-xl" />
      ))}
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition hover:bg-ink-100 hover:text-ink-900 dark:hover:bg-ink-800 dark:hover:text-white">
      {icon} {label}
    </button>
  );
}
