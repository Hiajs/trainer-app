import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, BookOpenText, Scale, Zap } from 'lucide-react';
import type { SearchMode } from '../../shared/types';

export interface SearchBoxHandle {
  focus: () => void;
}

interface Props {
  onSubmit: (q: string, mode: SearchMode) => void;
  placeholder?: string;
  big?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}

const MODES: { id: SearchMode; label: string; hint: string; Icon: typeof Zap }[] = [
  { id: 'quick', label: 'Quick', hint: 'A fast answer from top sources', Icon: Zap },
  { id: 'research', label: 'Research', hint: 'Multi-step research and a full report', Icon: BookOpenText },
  { id: 'compare', label: 'Compare', hint: 'Compare viewpoints across sources', Icon: Scale }
];

export const SearchBox = forwardRef<SearchBoxHandle, Props>(function SearchBox({ onSubmit, placeholder, big, autoFocus, disabled }, ref) {
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<SearchMode>('quick');
  const ta = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus() }));

  useEffect(() => {
    if (autoFocus) setTimeout(() => ta.current?.focus(), 50);
  }, [autoFocus]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  }, [value]);

  const submit = () => {
    const q = value.trim();
    if (!q || disabled) return;
    onSubmit(q, mode);
    setValue('');
  };

  return (
    <div
      className={`brand-ring rounded-[28px] border border-ink-200 bg-white shadow-[0_8px_30px_-12px_rgba(20,20,40,0.18)] transition dark:border-ink-800 dark:bg-ink-900 ${
        big ? 'px-5 pb-3 pt-4' : 'px-4 pb-2.5 pt-3'
      }`}
    >
      <textarea
        ref={ta}
        rows={1}
        value={value}
        placeholder={placeholder ?? 'Ask anything…'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className={`w-full resize-none bg-transparent outline-none placeholder:text-ink-400 ${big ? 'text-[19px] leading-7' : 'text-[15px] leading-6'}`}
      />
      <div className="mt-2 flex items-center gap-1.5">
        {MODES.map(({ id, label, hint, Icon }) => (
          <button
            key={id}
            title={hint}
            onClick={() => setMode(id)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
              mode === id
                ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900'
                : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-100'
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
        <button
          onClick={submit}
          disabled={!value.trim() || disabled}
          aria-label="Search"
          className="brand-bg ml-auto flex h-9 w-9 items-center justify-center rounded-full text-white shadow-glow transition enabled:hover:scale-105 disabled:opacity-35"
        >
          <ArrowUp size={18} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
});
