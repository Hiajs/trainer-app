import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Source } from '../../shared/types';
import { hostOf } from '../state';

/** Turn [1], [2][3] and [1, 2] citation markers into links with a cite: scheme. */
export function linkCitations(text: string, max: number) {
  return text.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (whole, nums: string) => {
    const parts = nums.split(',').map((n) => parseInt(n.trim(), 10));
    if (!parts.every((n) => n >= 1 && n <= max)) return whole;
    return parts.map((n) => `[${n}](cite:${n})`).join('');
  });
}

interface Props {
  text: string;
  sources?: Source[];
  onOpen: (url: string) => void;
  streaming?: boolean;
}

export const Markdown = memo(function Markdown({ text, sources = [], onOpen, streaming }: Props) {
  const content = sources.length ? linkCitations(text, sources.length) : text;
  return (
    <div className={`prose-answer selectable ${streaming ? 'caret' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url}
        components={{
          a: ({ href = '', children }) => {
            if (href.startsWith('cite:')) {
              const n = parseInt(href.slice(5), 10);
              const s = sources[n - 1];
              return (
                <button
                  title={s ? `${s.title} — ${hostOf(s.url)}` : undefined}
                  onClick={() => s && onOpen(s.url)}
                  className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-md bg-grape/15 px-1 align-middle text-[11px] font-semibold text-grape transition hover:bg-grape hover:text-white dark:bg-grape/25 dark:text-violet-200"
                >
                  {n}
                </button>
              );
            }
            const safe = /^(https?:|mailto:)/i.test(href);
            return (
              <a
                href={safe ? href : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (safe) onOpen(href);
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ alt }) => <span>{alt}</span>
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
