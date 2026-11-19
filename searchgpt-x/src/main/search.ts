// Web search and page reading. Requests go through Electron's `net` module so
// they use the Chromium network stack: the system proxy, PAC files, enterprise
// certificates from the Keychain and normal network authentication all apply.

import { net } from 'electron';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import type { ImageResult, SearchResult, VideoResult } from '../shared/types';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

export class SearchError extends Error {}

async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10000);
  const outer = init.signal;
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort);
  try {
    return await net.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

export function faviconFor(url: string): string | undefined {
  try {
    const u = new URL(url);
    return `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`;
  } catch {
    return undefined;
  }
}

function siteName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function stripTags(s: string) {
  return s.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
}

// ---------------------------------------------------------------- Brave
// Overridable only so the end-to-end tests can point at a local mock server.
const BRAVE_BASE = process.env.SGX_TEST_BRAVE_BASE || 'https://api.search.brave.com/res/v1';

async function braveGet(path: string, params: Record<string, string>, key: string, signal?: AbortSignal) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetchWithTimeout(`${BRAVE_BASE}/${path}?${qs}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal
  });
  if (res.status === 401 || res.status === 403) throw new SearchError('Brave Search rejected the API key. Check it in Settings.');
  if (res.status === 429) throw new SearchError('Brave Search rate limit reached. Try again in a moment.');
  if (!res.ok) throw new SearchError(`Brave Search returned HTTP ${res.status}.`);
  return res.json() as Promise<any>;
}

async function braveWeb(query: string, key: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const data = await braveGet('web/search', { q: query, count: String(Math.min(20, count)), text_decorations: 'false' }, key, signal);
  const results: any[] = data?.web?.results ?? [];
  return results.map((r) => ({
    title: stripTags(r.title ?? ''),
    url: r.url,
    snippet: stripTags([r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(' ')),
    favicon: r.meta_url?.favicon || faviconFor(r.url),
    siteName: r.profile?.name || siteName(r.url)
  }));
}

export async function searchImages(query: string, key: string): Promise<ImageResult[]> {
  if (!key) throw new SearchError('Image search needs a Brave Search API key (Settings → Search).');
  const data = await braveGet('images/search', { q: query, count: '40', safesearch: 'strict' }, key);
  return (data?.results ?? []).map((r: any) => ({
    title: r.title ?? '',
    url: r.url,
    thumbnail: r.thumbnail?.src,
    source: r.source || siteName(r.url)
  })).filter((r: ImageResult) => r.thumbnail);
}

export async function searchVideos(query: string, key: string): Promise<VideoResult[]> {
  if (!key) throw new SearchError('Video search needs a Brave Search API key (Settings → Search).');
  const data = await braveGet('videos/search', { q: query, count: '24', safesearch: 'strict' }, key);
  return (data?.results ?? []).map((r: any) => ({
    title: r.title ?? '',
    url: r.url,
    thumbnail: r.thumbnail?.src,
    duration: r.video?.duration,
    publisher: r.video?.publisher || r.meta_url?.hostname,
    age: r.age
  }));
}

// ---------------------------------------------------------------- DuckDuckGo (keyless fallback)
export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const { document } = parseHTML(html);
  const out: SearchResult[] = [];
  for (const el of Array.from(document.querySelectorAll('.result')) as any[]) {
    if (el.classList?.contains('result--ad')) continue;
    const a = el.querySelector('a.result__a');
    if (!a) continue;
    let href: string = a.getAttribute('href') || '';
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      const real = u.searchParams.get('uddg');
      href = real ? decodeURIComponent(real) : u.toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
    const snippet = el.querySelector('.result__snippet')?.textContent?.trim() ?? '';
    out.push({ title: a.textContent.trim(), url: href, snippet, favicon: faviconFor(href), siteName: siteName(href) });
  }
  return out;
}

export function parseDuckDuckGoLite(html: string): SearchResult[] {
  const { document } = parseHTML(html);
  const links = Array.from(document.querySelectorAll('a.result-link')) as any[];
  const snippets = Array.from(document.querySelectorAll('td.result-snippet')) as any[];
  const out: SearchResult[] = [];
  links.forEach((a, i) => {
    let href: string = a.getAttribute('href') || '';
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      href = u.searchParams.get('uddg') ? decodeURIComponent(u.searchParams.get('uddg')!) : u.toString();
    } catch {
      return;
    }
    if (!/^https?:/i.test(href) || /duckduckgo\.com/.test(href)) return;
    out.push({ title: a.textContent.trim(), url: href, snippet: snippets[i]?.textContent?.trim() ?? '', favicon: faviconFor(href), siteName: siteName(href) });
  });
  return out;
}

const KEYLESS_HINT = 'Add a free Brave Search API key in Settings → Search for reliable results.';

async function duckDuckGoWeb(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const attempts: [string, (h: string) => SearchResult[]][] = [
    ['https://html.duckduckgo.com/html/', parseDuckDuckGoHtml],
    ['https://lite.duckduckgo.com/lite/', parseDuckDuckGoLite]
  ];
  let lastStatus = 0;
  for (const [url, parse] of attempts) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'text/html' },
        body: new URLSearchParams({ q: query, kl: 'us-en' }).toString(),
        signal
      });
      lastStatus = res.status;
      if (!res.ok) continue;
      const results = parse(await res.text());
      if (results.length) return results;
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  throw new SearchError(
    lastStatus === 202 || lastStatus === 403 || lastStatus === 429
      ? `The keyless fallback search (DuckDuckGo) is temporarily limiting requests from your network. ${KEYLESS_HINT}`
      : `The keyless fallback search (DuckDuckGo) returned no results. ${KEYLESS_HINT}`
  );
}

export async function webSearch(query: string, opts: { braveKey: string; useBrave: boolean; count: number; signal?: AbortSignal }): Promise<SearchResult[]> {
  let results: SearchResult[];
  if (opts.useBrave && opts.braveKey) {
    results = await braveWeb(query, opts.braveKey, opts.count, opts.signal);
  } else {
    results = await duckDuckGoWeb(query, opts.signal);
  }
  // Drop duplicates by normalized URL.
  const seen = new Set<string>();
  return results.filter((r) => {
    const k = r.url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------- Reading pages
const MAX_BYTES = 2_000_000;

async function readBody(res: Response, limit = MAX_BYTES): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      break;
    }
  }
  const out = new Uint8Array(Math.min(total, limit));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - off);
    out.set(c.subarray(0, take), off);
    off += take;
    if (off >= out.length) break;
  }
  return out;
}

export function extractReadableText(html: string, url: string): { title: string; text: string } {
  const { document } = parseHTML(html);
  try {
    // Readability needs a baseURI-ish context for relative links; text extraction does not.
    const article = new Readability(document as any, { charThreshold: 200 }).parse();
    if (article?.textContent && article.textContent.trim().length > 300) {
      return { title: article.title || document.title || url, text: normalizeWhitespace(article.textContent) };
    }
  } catch {
    /* fall through to the plain-text path */
  }
  for (const sel of ['script', 'style', 'noscript', 'nav', 'footer', 'header', 'svg', 'form', 'aside']) {
    for (const el of Array.from(document.querySelectorAll(sel)) as any[]) el.remove();
  }
  return { title: document.title || url, text: normalizeWhitespace(document.body?.textContent ?? '') };
}

export function normalizeWhitespace(s: string) {
  return s.replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return normalizeWhitespace(Array.isArray(text) ? text.join('\n') : text);
}

export async function fetchPageText(url: string, opts: { signal?: AbortSignal; timeoutMs?: number; maxChars?: number } = {}) {
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5' },
    signal: opts.signal,
    timeoutMs: opts.timeoutMs ?? 9000
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  const body = await readBody(res, type.includes('pdf') ? 25_000_000 : MAX_BYTES);
  let title = url;
  let text = '';
  if (type.includes('pdf') || /\.pdf($|\?)/i.test(url)) {
    text = await extractPdfText(body);
  } else if (type.includes('html') || type.includes('xml') || !type) {
    const html = new TextDecoder('utf-8', { fatal: false }).decode(body);
    ({ title, text } = extractReadableText(html, url));
  } else if (type.startsWith('text/')) {
    text = normalizeWhitespace(new TextDecoder().decode(body));
  } else {
    throw new Error(`Unsupported content type ${type}`);
  }
  const maxChars = opts.maxChars ?? 7000;
  return { title, text: text.length > maxChars ? text.slice(0, maxChars) + ' …' : text };
}
