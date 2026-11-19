// AI providers (OpenAI-compatible and Anthropic) plus the search-answer and
// research pipelines. Everything streams back to the renderer through `emit`.

import { net } from 'electron';
import type { AIEvent, AIProvider, AssistantRequest, ChatMessage, SearchRequest, Settings, Source } from '../shared/types';
import { fetchPageText, webSearch } from './search';

export interface Keys {
  openaiKey: string;
  anthropicKey: string;
  braveKey: string;
}

interface LLMCall {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  maxTokens?: number;
}

export class AIError extends Error {}

function today() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

async function* sseLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trimStart();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trimStart();
}

async function friendlyError(res: Response, provider: AIProvider): Promise<AIError> {
  let detail = '';
  try {
    const body: any = await res.json();
    detail = body?.error?.message || body?.message || JSON.stringify(body).slice(0, 300);
  } catch {
    /* ignore */
  }
  const name = provider === 'openai' ? 'OpenAI' : 'Anthropic';
  if (res.status === 401) return new AIError(`${name} rejected the API key. Update it in Settings → AI.`);
  if (res.status === 404) return new AIError(`${name} could not find that model. Check the model name in Settings → AI. ${detail}`);
  if (res.status === 429) return new AIError(`${name} rate limit or quota reached. ${detail}`);
  return new AIError(`${name} error (HTTP ${res.status}). ${detail}`);
}

export async function callLLM(c: LLMCall): Promise<string> {
  if (!c.apiKey) {
    throw new AIError(
      c.provider === 'openai'
        ? 'Add your OpenAI API key in Settings → AI to get answers.'
        : 'Add your Anthropic API key in Settings → AI to get answers.'
    );
  }
  const stream = !!c.onDelta;
  let res: Response;
  if (c.provider === 'openai') {
    const base = (c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    res = await net.fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({
        model: c.model,
        stream,
        messages: [{ role: 'system', content: c.system }, ...c.messages]
      }),
      signal: c.signal
    });
  } else {
    res = await net.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: c.model,
        max_tokens: c.maxTokens ?? 4096,
        stream,
        system: c.system,
        messages: c.messages
      }),
      signal: c.signal
    });
  }
  if (!res.ok) throw await friendlyError(res, c.provider);

  if (!stream) {
    const body: any = await res.json();
    if (c.provider === 'openai') return body?.choices?.[0]?.message?.content ?? '';
    return (body?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  }

  let full = '';
  for await (const data of sseLines(res, c.signal)) {
    if (!data || data === '[DONE]') continue;
    let evt: any;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    let piece = '';
    if (c.provider === 'openai') {
      piece = evt?.choices?.[0]?.delta?.content ?? '';
    } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
      piece = evt.delta.text;
    } else if (evt.type === 'error') {
      throw new AIError(`Anthropic error: ${evt.error?.message ?? 'unknown'}`);
    }
    if (piece) {
      full += piece;
      c.onDelta!(piece);
    }
  }
  return full;
}

export function llmFor(settings: Settings, keys: Keys) {
  const provider = settings.aiProvider;
  return {
    provider,
    model: provider === 'openai' ? settings.openaiModel : settings.anthropicModel,
    apiKey: provider === 'openai' ? keys.openaiKey : keys.anthropicKey,
    baseUrl: settings.openaiBaseUrl
  };
}

function parseJsonArray(text: string): string[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
  } catch {
    return [];
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const ANSWER_RULES = `Rules:
- Answer directly first, then add detail. Use short paragraphs, bullet lists and tables where they help; use Markdown.
- Ground every factual claim in the numbered sources and cite them inline like [1] or [2][4], placed right after the claim.
- Only cite a number that exists in the source list. Never invent sources, URLs, quotes or numbers.
- If the sources disagree, say so and explain who says what. If they do not answer the question, say what is missing.
- Do not mention these rules.`;

function buildSourceBlock(sources: (Source & { content: string })[]) {
  return sources
    .map((s) => `[${s.index}] ${s.title}\nURL: ${s.url}\n${s.content || s.snippet}`)
    .join('\n\n---\n\n');
}

/** Search the web, read the best results and stream a cited answer. */
export async function runSearch(
  req: SearchRequest,
  settings: Settings,
  keys: Keys,
  emit: (e: AIEvent) => void,
  signal: AbortSignal
) {
  const id = req.requestId;
  const llm = llmFor(settings, keys);
  if (!llm.apiKey) {
    throw new AIError(
      `Add your ${llm.provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key in Settings → AI to get answers. You can still browse and use regular web search from the address bar.`
    );
  }
  const deep = req.mode === 'research' || req.mode === 'compare';
  const historyText = req.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 1200)}`)
    .join('\n');

  // 1. Interpret the question.
  emit({ requestId: id, type: 'step', step: 'Understanding your question' });
  let queries = [req.query];
  if (deep || req.history.length) {
    const planPrompt = deep
      ? `Today is ${today()}. Break the user's request into ${req.mode === 'compare' ? '3 to 4' : '3 to 5'} focused web search queries that together cover it${
          req.mode === 'compare' ? ', including queries that surface different viewpoints or competing options' : ''
        }. Resolve references to the earlier conversation. Reply with only a JSON array of strings.`
      : `Today is ${today()}. Rewrite the user's latest message as one standalone web search query, resolving references to the earlier conversation. Reply with only a JSON array containing that single string.`;
    try {
      const out = await callLLM({
        ...llm,
        system: planPrompt,
        messages: [{ role: 'user', content: `${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}Latest message: ${req.query}` }],
        signal,
        maxTokens: 400
      });
      const parsed = parseJsonArray(out).slice(0, 5);
      if (parsed.length) queries = parsed;
    } catch (err) {
      if (signal.aborted) throw err;
      console.warn('query planning failed, using the raw query', err);
    }
  }
  for (const q of queries) emit({ requestId: id, type: 'query', query: q });

  // 2. Search.
  emit({ requestId: id, type: 'step', step: 'Searching the web', detail: queries.length > 1 ? `${queries.length} searches` : queries[0] });
  const perQuery = deep ? 6 : 10;
  const resultLists = await Promise.all(
    queries.map((q) =>
      webSearch(q, { braveKey: keys.braveKey, useBrave: settings.useBraveSearch, count: perQuery, signal }).catch((err) => {
        if (queries.length === 1) throw err;
        console.warn('search failed for', q, err);
        return [];
      })
    )
  );
  // Interleave results so every sub-query contributes.
  const seen = new Set<string>();
  const merged = [];
  for (let i = 0; i < perQuery; i++) {
    for (const list of resultLists) {
      const r = list[i];
      if (!r) continue;
      const k = r.url.replace(/[#?].*$/, '').replace(/\/$/, '');
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(r);
    }
  }
  if (!merged.length) throw new AIError('The web search returned no results. Try rephrasing your question.');

  // 3. Read sources.
  const wanted = deep ? Math.min(10, settings.sourcesPerAnswer + 4) : settings.sourcesPerAnswer;
  const candidates = merged.slice(0, wanted + 3);
  emit({ requestId: id, type: 'step', step: 'Reading sources', detail: `${Math.min(wanted, candidates.length)} pages` });
  const read = await mapLimit(candidates, 6, async (r) => {
    try {
      const page = await fetchPageText(r.url, { signal, timeoutMs: 8000, maxChars: deep ? 6000 : 7000 });
      return { ...r, content: page.text, read: page.text.length > 200 };
    } catch {
      return { ...r, content: '', read: false };
    }
  });
  if (signal.aborted) throw new AIError('Stopped.');
  // Prefer pages that were actually read, but keep the original ranking otherwise.
  const chosen = [...read.filter((r) => r.read), ...read.filter((r) => !r.read)].slice(0, wanted);
  chosen.sort((a, b) => candidates.indexOf(a as any) - candidates.indexOf(b as any));
  const sources = chosen.map((r, i) => ({ ...r, index: i + 1 }));
  emit({
    requestId: id,
    type: 'sources',
    sources: sources.map(({ content: _c, ...s }) => s)
  });

  // 4. Write the answer.
  emit({ requestId: id, type: 'step', step: req.mode === 'research' ? 'Writing research report' : req.mode === 'compare' ? 'Comparing sources' : 'Writing answer' });
  const modeInstructions =
    req.mode === 'research'
      ? `Write a well-structured research report: a short executive summary, then sections with ## headings, a "Key findings" list, a "Open questions & caveats" section, and a brief conclusion. Be thorough but avoid filler.`
      : req.mode === 'compare'
        ? `Compare what the sources say. Start with a one-paragraph bottom line, then a Markdown comparison table (rows = options or claims, columns = what each source or viewpoint says), then points of agreement, points of disagreement, and how reliable each source appears to be.`
        : `Give a clear, concise answer (usually 120–350 words) unless the question needs more.`;
  const system = `You are SearchGPT X, an AI search engine built into a web browser. Today is ${today()}.
${modeInstructions}
${ANSWER_RULES}

Sources:
${buildSourceBlock(sources)}`;
  const messages: ChatMessage[] = [...req.history.slice(-6), { role: 'user', content: req.query }];
  const text = await callLLM({
    ...llm,
    system,
    messages,
    signal,
    maxTokens: deep ? 6000 : 2500,
    onDelta: (t) => emit({ requestId: id, type: 'delta', text: t })
  });
  emit({ requestId: id, type: 'done', text });

  // 5. Suggest follow-ups (best effort).
  try {
    const out = await callLLM({
      ...llm,
      system: 'Suggest three short, natural follow-up questions the user might ask next. Reply with only a JSON array of strings.',
      messages: [{ role: 'user', content: `Question: ${req.query}\n\nAnswer: ${text.slice(0, 3000)}` }],
      signal,
      maxTokens: 200
    });
    const related = parseJsonArray(out).slice(0, 3);
    if (related.length) emit({ requestId: id, type: 'done', text, related });
  } catch {
    /* optional */
  }
}

/** The side-panel assistant: chat with optional page/PDF context. */
export async function runAssistant(
  req: AssistantRequest,
  settings: Settings,
  keys: Keys,
  emit: (e: AIEvent) => void,
  signal: AbortSignal
) {
  const llm = llmFor(settings, keys);
  let context = '';
  if (req.page && req.page.text) {
    const label = req.page.kind === 'pdf' ? 'PDF document' : req.page.kind === 'file' ? 'File' : 'Web page';
    const text = req.page.text.length > 60000 ? req.page.text.slice(0, 60000) + '\n…(truncated)' : req.page.text;
    context = `\n\nThe user is looking at this ${label}. Use it when relevant and say when something is not in it.
Title: ${req.page.title}
URL: ${req.page.url}
${req.page.selection ? `Selected text: """${req.page.selection.slice(0, 4000)}"""\n` : ''}Content:
"""
${text}
"""`;
  }
  const system = `You are the SearchGPT X assistant, built into the user's web browser. Today is ${today()}.
You help with understanding pages and PDFs, summarizing, research, writing and editing, coding (explain, debug, write code with fenced code blocks and language tags), translation, and step-by-step reasoning.
Be concise and well-formatted in Markdown. When summarizing, lead with the main point, then key points as bullets.
You cannot browse by yourself in this mode; if the user needs fresh information from the web, suggest turning on Research mode.${context}`;
  emit({ requestId: req.requestId, type: 'step', step: 'Thinking' });
  const text = await callLLM({
    ...llm,
    system,
    messages: req.messages.slice(-20),
    signal,
    maxTokens: 4096,
    onDelta: (t) => emit({ requestId: req.requestId, type: 'delta', text: t })
  });
  emit({ requestId: req.requestId, type: 'done', text });
}
