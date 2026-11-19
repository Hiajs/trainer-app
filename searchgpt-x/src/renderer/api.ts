import type {
  AIEvent,
  AssistantRequest,
  Bookmark,
  ChatMessage,
  ContextAction,
  DownloadEvent,
  DownloadItemInfo,
  HistoryEntry,
  ImageResult,
  MenuCommand,
  PageContext,
  SearchRequest,
  SecretName,
  SecretStatus,
  Settings,
  VideoResult,
  WindowInfo
} from '../shared/types';

interface Bridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<any>;
  on: <T>(channel: string, cb: (payload: T) => void) => () => void;
}
const bridge: Bridge = (window as any).sgx;

function unwrap(err: any): Error {
  // Electron prefixes errors thrown in handlers; keep the human part.
  const msg = String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  return new Error(msg);
}
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await bridge.invoke(channel, ...args);
  } catch (err) {
    throw unwrap(err);
  }
}

export const api = {
  windowInfo: () => call<WindowInfo>('window:info'),
  newWindow: (isPrivate: boolean) => call<void>('window:new', isPrivate),
  getSettings: () => call<Settings>('settings:get'),
  setSettings: (patch: Partial<Settings>) => call<Settings>('settings:set', patch),
  secretStatus: () => call<SecretStatus>('secrets:status'),
  setSecret: (name: SecretName, value: string) => call<SecretStatus>('secrets:set', name, value),
  bookmarks: () => call<Bookmark[]>('bookmarks:list'),
  toggleBookmark: (b: { url: string; title: string; favicon?: string }) => call<boolean>('bookmarks:toggle', b),
  removeBookmark: (id: string) => call<void>('bookmarks:remove', id),
  addHistory: (h: { url: string; title: string; favicon?: string }) => call<void>('history:add', h),
  searchHistory: (q: string) => call<HistoryEntry[]>('history:search', q),
  removeHistory: (id: string) => call<void>('history:remove', id),
  clearHistory: () => call<void>('history:clear'),
  downloads: () => call<DownloadItemInfo[]>('downloads:list'),
  downloadAction: (id: string, action: 'pause' | 'resume' | 'cancel' | 'open' | 'show' | 'clear') => call<void>('downloads:action', id, action),
  search: (req: SearchRequest) => call<void>('ai:search', req),
  assistant: (req: AssistantRequest) => call<void>('ai:assistant', req),
  abort: (requestId: string) => call<void>('ai:abort', requestId),
  images: (q: string) => call<ImageResult[]>('ai:images', q),
  videos: (q: string) => call<VideoResult[]>('ai:videos', q),
  loadAssistant: () => call<ChatMessage[]>('assistant:load'),
  saveAssistant: (m: ChatMessage[]) => call<void>('assistant:save', m),
  pdfText: (url: string) => call<PageContext>('page:pdf-text', url),
  openDocument: () => call<PageContext | null>('file:open-document'),
  clearData: (what: { history?: boolean; cookies?: boolean; cache?: boolean; assistant?: boolean }) => call<void>('privacy:clear-data', what),
  addExtension: () => call<Settings>('extensions:add'),
  removeExtension: (dir: string) => call<Settings>('extensions:remove', dir),
  setDefaultBrowser: () => call<boolean>('app:set-default-browser'),
  openExternal: (url: string) => call<void>('app:open-external', url),

  onAIEvent: (cb: (e: AIEvent) => void) => bridge.on('ai:event', cb),
  onMenu: (cb: (c: MenuCommand) => void) => bridge.on('menu:command', cb),
  onOpenTab: (cb: (p: { url: string; background: boolean }) => void) => bridge.on('tab:open', cb),
  onContextAction: (cb: (a: ContextAction) => void) => bridge.on('context:action', cb),
  onDownload: (cb: (e: DownloadEvent) => void) => bridge.on('download:event', cb),
  onTrackerBlocked: (cb: (p: { webContentsId: number; count: number }) => void) => bridge.on('tracker:blocked', cb),
  onSettings: (cb: (s: Settings) => void) => bridge.on('settings:changed', cb),
  onBookmarks: (cb: (b: Bookmark[]) => void) => bridge.on('bookmarks:changed', cb)
};

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
