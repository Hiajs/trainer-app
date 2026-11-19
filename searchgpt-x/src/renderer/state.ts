import type { AIEvent, SearchMode, Settings, Source } from '../shared/types';
import { api } from './api';

export interface Turn {
  id: string;
  requestId: string;
  query: string;
  mode: SearchMode;
  steps: { label: string; detail?: string }[];
  queries: string[];
  sources: Source[];
  answer: string;
  status: 'running' | 'done' | 'error';
  error?: string;
  related?: string[];
}

export interface Tab {
  id: string;
  kind: 'home' | 'web';
  /** URL the <webview> was created with; later navigations go through loadURL. */
  initialUrl: string;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  blocked: number;
  webContentsId?: number;
  thread: Turn[];
  error?: { code: number; description: string; url: string };
  /** Bumped to force a webview remount (e.g. returning from home view). */
  epoch: number;
}

// ---------------------------------------------------------------- AI event hub
type Handler = (e: AIEvent) => void;
const handlers = new Map<string, Handler>();
let subscribed = false;
export function onRequest(requestId: string, h: Handler) {
  if (!subscribed) {
    subscribed = true;
    api.onAIEvent((e) => handlers.get(e.requestId)?.(e));
  }
  handlers.set(requestId, h);
  return () => handlers.delete(requestId);
}

/** Apply a streamed event to a search turn. */
export function reduceTurn(t: Turn, e: AIEvent): Turn {
  switch (e.type) {
    case 'step':
      return { ...t, steps: [...t.steps, { label: e.step, detail: e.detail }] };
    case 'query':
      return { ...t, queries: [...t.queries, e.query] };
    case 'sources':
      return { ...t, sources: e.sources };
    case 'delta':
      return { ...t, answer: t.answer + e.text };
    case 'done':
      return { ...t, answer: e.text || t.answer, status: 'done', related: e.related ?? t.related };
    case 'error':
      return { ...t, status: t.answer && e.message === 'Stopped.' ? 'done' : 'error', error: e.message };
  }
}

// ---------------------------------------------------------------- URL helpers
const TLD_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/.*)?$/i;

export function toNavigableUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^(https?|file):\/\//i.test(s) || /^about:blank$/i.test(s)) return s;
  if (/\s/.test(s)) return null;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return `http://${s}`;
  if (TLD_LIKE.test(s)) return `https://${s}`;
  return null;
}

export function searchUrl(engine: Settings['searchEngineForAddressBar'], q: string) {
  const e = encodeURIComponent(q);
  switch (engine) {
    case 'google':
      return `https://www.google.com/search?q=${e}`;
    case 'bing':
      return `https://www.bing.com/search?q=${e}`;
    case 'brave':
      return `https://search.brave.com/search?q=${e}`;
    default:
      return `https://duckduckgo.com/?q=${e}`;
  }
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function faviconFor(url: string) {
  try {
    return `https://icons.duckduckgo.com/ip3/${new URL(url).hostname}.ico`;
  } catch {
    return undefined;
  }
}
