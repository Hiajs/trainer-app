import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUp, BookOpenText, FileUp, Globe, Languages, ListChecks, Loader2, Square, Trash2, Wand2, X } from 'lucide-react';
import type { ChatMessage, PageContext, Settings, Source } from '../../shared/types';
import { api, uid } from '../api';
import { onRequest, reduceTurn, Turn } from '../state';
import { Logo } from './Logo';
import { Markdown } from './Markdown';
import { SourceCards } from './SourceCards';

interface Msg extends ChatMessage {
  id: string;
  sources?: Source[];
  pending?: boolean;
  error?: string;
  note?: string; // e.g. "with page: Example Domain"
}

interface Props {
  isPrivate: boolean;
  settings: Settings;
  /** Reads the current tab's text (and selection). Null when the tab is not a web page. */
  getPage: () => Promise<PageContext | null>;
  onOpen: (url: string) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  /** A one-shot instruction queued from elsewhere (menu, context menu). */
  queued: { id: string; task: 'summarize' | 'ask' | 'translate'; text?: string } | null;
  onQueuedHandled: () => void;
}

export function AssistantPanel(p: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [research, setResearch] = useState(false);
  const [usePage, setUsePage] = useState(p.settings.sendPageContextAutomatically);
  const [doc, setDoc] = useState<PageContext | null>(null);
  const [lang, setLang] = useState('English');
  const scroller = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    api.loadAssistant().then((m) => {
      setMessages((prev) => [...m.map((x) => ({ ...x, id: uid() })), ...prev]);
      loaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (loaded.current && !busy) api.saveAssistant(messages.filter((m) => !m.error && m.content).map(({ role, content }) => ({ role, content })));
  }, [messages, busy]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (!p.queued) return;
    const q = p.queued;
    p.onQueuedHandled();
    if (q.task === 'summarize') void send('Summarize this page.', { task: 'summarize', forcePage: true });
    if (q.task === 'translate') void send(`Translate this into ${lang}:\n\n${q.text}`, { forcePage: false });
    if (q.task === 'ask') void send(`Explain this: “${q.text}”`, { forcePage: true, selection: q.text });
  }, [p.queued]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (id: string, patch: Partial<Msg> | ((m: Msg) => Partial<Msg>)) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)));

  async function send(text: string, opts: { task?: 'summarize' | 'key-points' | 'chat'; forcePage?: boolean; selection?: string } = {}) {
    const content = text.trim();
    if (!content || busy) return;
    const history: ChatMessage[] = messages.filter((m) => !m.error && m.content).map(({ role, content }) => ({ role, content }));
    let page: PageContext | null = doc;
    if (!page && (opts.forcePage || usePage)) {
      try {
        page = await p.getPage();
      } catch (err: any) {
        page = null;
        console.warn(err);
      }
      if (!page && opts.forcePage) {
        setMessages((ms) => [...ms, { id: uid(), role: 'user', content }, { id: uid(), role: 'assistant', content: '', error: 'Open a web page or PDF (or attach a file) first — there is no page in this tab to read.' }]);
        return;
      }
    }
    if (page && opts.selection) page = { ...page, selection: opts.selection };
    const requestId = uid();
    const userMsg: Msg = { id: uid(), role: 'user', content, note: page ? `${page.kind === 'webpage' ? 'Page' : 'Document'}: ${page.title}` : research ? 'Research mode · web search' : undefined };
    const reply: Msg = { id: uid(), role: 'assistant', content: '', pending: true };
    setMessages((ms) => [...ms, userMsg, reply]);
    setInput('');
    setBusy(requestId);

    if (research && !page) {
      let turn: Turn = { id: requestId, requestId, query: content, mode: 'research', steps: [], queries: [], sources: [], answer: '', status: 'running' };
      const off = onRequest(requestId, (e) => {
        turn = reduceTurn(turn, e);
        update(reply.id, {
          content: turn.answer,
          sources: turn.sources,
          note: turn.status === 'running' && !turn.answer ? turn.steps.at(-1)?.label : undefined,
          pending: turn.status === 'running',
          error: turn.status === 'error' ? turn.error : undefined
        });
      });
      try {
        await api.search({ requestId, query: content, mode: 'research', history: history.slice(-6) });
      } finally {
        off();
        setBusy(null);
      }
      return;
    }

    const off = onRequest(requestId, (e) => {
      if (e.type === 'delta') update(reply.id, (m) => ({ content: m.content + e.text }));
      if (e.type === 'done') update(reply.id, { content: e.text, pending: false });
      if (e.type === 'error') update(reply.id, (m) => ({ pending: false, error: m.content && e.message === 'Stopped.' ? undefined : e.message }));
    });
    try {
      await api.assistant({ requestId, messages: [...history, { role: 'user', content }], page, task: opts.task ?? 'chat' });
    } finally {
      off();
      setBusy(null);
    }
  }

  const actions = [
    { label: 'Summarize page', Icon: Wand2, run: () => send('Summarize this page.', { task: 'summarize', forcePage: true }) },
    { label: 'Key points', Icon: ListChecks, run: () => send('List the key points and any important numbers, dates or claims.', { task: 'key-points', forcePage: true }) },
    { label: `Translate to ${lang}`, Icon: Languages, run: () => send(`Translate the main content of this page into ${lang}. Keep headings.`, { forcePage: true }) },
    {
      label: 'Analyze a PDF or file',
      Icon: FileUp,
      run: async () => {
        try {
          const d = await api.openDocument();
          if (d) setDoc(d);
        } catch (err: any) {
          setMessages((ms) => [...ms, { id: uid(), role: 'assistant', content: '', error: err.message }]);
        }
      }
    }
  ];

  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 38 }}
      className="flex h-full w-[400px] shrink-0 flex-col border-l border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900"
    >
      <header className="flex items-center gap-2 border-b border-ink-200 px-4 py-2.5 dark:border-ink-800">
        <Logo size={20} />
        <span className="text-sm font-semibold">Assistant</span>
        {p.isPrivate && <span className="text-[11px] text-ink-400">· not saved</span>}
        <div className="ml-auto flex items-center gap-1">
          <button title="Clear conversation" onClick={() => setMessages([])} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800">
            <Trash2 size={15} />
          </button>
          <button title="Close (⌘E)" onClick={p.onClose} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800">
            <X size={16} />
          </button>
        </div>
      </header>

      <div ref={scroller} className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!messages.length && (
          <div className="pt-6 text-center">
            <Logo size={40} className="mx-auto" />
            <p className="mt-3 text-sm font-medium">How can I help with this tab?</p>
            <p className="mx-auto mt-1 max-w-[290px] text-xs leading-relaxed text-ink-500">
              Summarize pages and PDFs, ask about what you’re reading, translate, write, or debug code. Turn on Research for multi-step web research.
            </p>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex flex-col items-end">
              <div className="selectable max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink-900 px-3.5 py-2 text-[13.5px] text-white dark:bg-ink-100 dark:text-ink-900">{m.content}</div>
              {m.note && <div className="mt-1 max-w-[88%] truncate text-[11px] text-ink-400">{m.note}</div>}
            </div>
          ) : (
            <div key={m.id} className="text-[13.5px]">
              {m.sources && m.sources.length > 0 && (
                <div className="mb-2">
                  <SourceCards sources={m.sources} onOpen={p.onOpen} compact />
                </div>
              )}
              {m.content ? (
                <Markdown text={m.content} sources={m.sources} onOpen={p.onOpen} streaming={m.pending} />
              ) : m.pending ? (
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <Loader2 size={13} className="animate-spin text-grape" /> {m.note ?? 'Thinking…'}
                </div>
              ) : null}
              {m.error && (
                <div className="mt-1 rounded-xl bg-ember/10 px-3 py-2 text-xs text-ink-700 dark:text-ink-200">
                  {m.error}
                  {/Settings/.test(m.error) && (
                    <button onClick={p.onOpenSettings} className="ml-2 font-medium text-ember hover:underline">
                      Open Settings
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        )}
      </div>

      <div className="border-t border-ink-200 p-3 dark:border-ink-800">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {actions.map(({ label, Icon, run }) => (
            <button
              key={label}
              onClick={run}
              disabled={!!busy}
              className="flex items-center gap-1 rounded-full border border-ink-200 px-2.5 py-1 text-[11.5px] text-ink-600 transition hover:border-grape/50 hover:text-ink-900 disabled:opacity-40 dark:border-ink-700 dark:text-ink-300 dark:hover:text-white"
            >
              <Icon size={12} /> {label}
            </button>
          ))}
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-full border border-ink-200 bg-transparent px-2 py-1 text-[11.5px] text-ink-600 outline-none dark:border-ink-700 dark:text-ink-300">
            {['English', 'Spanish', 'French', 'German', 'Chinese', 'Japanese', 'Korean', 'Hindi', 'Arabic', 'Portuguese', 'Russian', 'Italian', 'Vietnamese', 'Tagalog'].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
        {doc && (
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-sky/10 px-3 py-1.5 text-xs text-ink-700 dark:text-ink-200">
            <FileUp size={13} className="text-sky" /> <span className="flex-1 truncate">{doc.title}</span>
            <span className="text-ink-400">{Math.round(doc.text.length / 1000)}k chars</span>
            <button onClick={() => setDoc(null)} className="text-ink-400 hover:text-ink-700">
              <X size={13} />
            </button>
          </div>
        )}
        <div className="brand-ring rounded-2xl border border-ink-200 bg-ink-50 px-3 pb-2 pt-2.5 dark:border-ink-700 dark:bg-ink-950">
          <textarea
            value={input}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={doc ? `Ask about ${doc.title}…` : research ? 'Research a topic on the web…' : 'Ask, write, code, translate…'}
            className="max-h-40 w-full resize-none bg-transparent text-[13.5px] outline-none placeholder:text-ink-400"
          />
          <div className="flex items-center gap-1.5">
            <Toggle on={usePage} onClick={() => setUsePage((v) => !v)} Icon={Globe} label="Use page" title={`Send this tab's text to ${p.settings.aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'} with your message`} />
            <Toggle on={research} onClick={() => setResearch((v) => !v)} Icon={BookOpenText} label="Research" title="Search the web in several steps and cite sources" />
            {busy ? (
              <button onClick={() => api.abort(busy)} className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-ink-200 text-ink-700 dark:bg-ink-800 dark:text-ink-200" aria-label="Stop">
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={() => send(input)}
                disabled={!input.trim()}
                aria-label="Send"
                className="brand-bg ml-auto flex h-8 w-8 items-center justify-center rounded-full text-white disabled:opacity-35"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        {usePage && <p className="mt-1.5 text-[10.5px] text-ink-400">This tab’s text is sent to {p.settings.aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'} with each message.</p>}
      </div>
    </motion.aside>
  );
}

function Toggle({ on, onClick, Icon, label, title }: { on: boolean; onClick: () => void; Icon: typeof Globe; label: string; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition ${
        on ? 'bg-grape/15 text-grape dark:text-violet-300' : 'text-ink-500 hover:bg-ink-200 dark:hover:bg-ink-800'
      }`}
    >
      <Icon size={12} /> {label}
    </button>
  );
}
