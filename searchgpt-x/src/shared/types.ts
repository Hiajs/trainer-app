// Types shared between the main process, the preload bridge and the renderer.

export type ThemeSetting = 'system' | 'light' | 'dark';
export type AIProvider = 'openai' | 'anthropic';
export type SearchMode = 'quick' | 'research' | 'compare';

export interface Settings {
  /** Master switch. When false the app is a plain browser and never contacts AI services. */
  aiEnabled: boolean;
  theme: ThemeSetting;
  aiProvider: AIProvider;
  openaiModel: string;
  openaiBaseUrl: string;
  anthropicModel: string;
  /** When false, web search falls back to DuckDuckGo's HTML endpoint (no key needed). */
  useBraveSearch: boolean;
  trackingProtection: boolean;
  /** Ask before sending page contents to the AI provider from the assistant. */
  sendPageContextAutomatically: boolean;
  sourcesPerAnswer: number;
  extensions: string[];
  searchEngineForAddressBar: 'ai' | 'duckduckgo' | 'google' | 'bing' | 'brave';
  showWelcome: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  aiEnabled: false,
  theme: 'system',
  aiProvider: 'openai',
  openaiModel: 'gpt-5-mini',
  openaiBaseUrl: 'https://api.openai.com/v1',
  anthropicModel: 'claude-sonnet-5-5',
  useBraveSearch: true,
  trackingProtection: true,
  sendPageContextAutomatically: false,
  sourcesPerAnswer: 6,
  extensions: [],
  searchEngineForAddressBar: 'duckduckgo',
  showWelcome: true
};

export type SecretName = 'openaiKey' | 'anthropicKey' | 'braveKey';

export interface SecretStatus {
  openaiKey: boolean;
  anthropicKey: boolean;
  braveKey: boolean;
  encryptionAvailable: boolean;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  createdAt: number;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  visitedAt: number;
}

export interface DownloadItemInfo {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  paused: boolean;
  startedAt: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  favicon?: string;
  siteName?: string;
}

export interface ImageResult {
  title: string;
  url: string; // page URL
  thumbnail: string;
  source?: string;
}

export interface VideoResult {
  title: string;
  url: string;
  thumbnail?: string;
  duration?: string;
  publisher?: string;
  age?: string;
}

export interface Source extends SearchResult {
  index: number;
  /** Whether the page body could be fetched and read, or only its snippet was used. */
  read: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SearchRequest {
  requestId: string;
  query: string;
  mode: SearchMode;
  /** Earlier turns in the same thread, for follow-up questions. */
  history: ChatMessage[];
}

export interface PageContext {
  url: string;
  title: string;
  text: string;
  selection?: string;
  kind: 'webpage' | 'pdf' | 'file';
}

export interface AssistantRequest {
  requestId: string;
  messages: ChatMessage[];
  page?: PageContext | null;
  task?: 'chat' | 'summarize' | 'translate' | 'explain-selection' | 'key-points';
  language?: string;
}

export type AIEvent =
  | { requestId: string; type: 'step'; step: string; detail?: string }
  | { requestId: string; type: 'query'; query: string }
  | { requestId: string; type: 'sources'; sources: Source[] }
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'done'; text: string; related?: string[] }
  | { requestId: string; type: 'error'; message: string };

export type DownloadEvent = { type: 'update'; item: DownloadItemInfo } | { type: 'removed'; id: string };

export type MenuCommand =
  | 'new-tab'
  | 'close-tab'
  | 'reopen-tab'
  | 'focus-address'
  | 'reload'
  | 'hard-reload'
  | 'back'
  | 'forward'
  | 'next-tab'
  | 'prev-tab'
  | 'toggle-assistant'
  | 'bookmark-page'
  | 'show-history'
  | 'show-bookmarks'
  | 'show-downloads'
  | 'show-downloads-toast'
  | 'show-settings'
  | 'find'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'summarize-page'
  | 'devtools'
  | 'home'
  | `select-tab-${number}`;

export interface ContextAction {
  action: 'open-in-new-tab' | 'ask-ai' | 'summarize' | 'search-ai' | 'translate';
  url?: string;
  text?: string;
}

export interface WindowInfo {
  isPrivate: boolean;
  platform: string;
  version: string;
}
