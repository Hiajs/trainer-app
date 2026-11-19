// Small JSON-file persistence layer kept in the app's userData folder.
// Sensitive values (API keys) are encrypted with Electron's safeStorage,
// which uses the macOS Keychain to protect the encryption key.

import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  Bookmark,
  ChatMessage,
  DEFAULT_SETTINGS,
  DownloadItemInfo,
  HistoryEntry,
  SecretName,
  SecretStatus,
  Settings
} from '../shared/types';

const MAX_HISTORY = 5000;
const MAX_DOWNLOADS = 200;

class JsonFile<T> {
  private data: T;
  private timer: NodeJS.Timeout | null = null;
  constructor(private file: string, fallback: T) {
    this.data = fallback;
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.data = Array.isArray(fallback) ? (Array.isArray(parsed) ? parsed : fallback) : { ...fallback, ...parsed };
      }
    } catch (err) {
      console.error(`Could not read ${file}; starting fresh.`, err);
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        /* ignore */
      }
    }
  }
  get(): T {
    return this.data;
  }
  set(value: T) {
    this.data = value;
    this.scheduleWrite();
  }
  private scheduleWrite() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error(`Could not write ${this.file}`, err);
    }
  }
}

export class Store {
  private dir: string;
  settings: JsonFile<Settings>;
  private secrets: JsonFile<Partial<Record<SecretName, string>>>;
  bookmarks: JsonFile<Bookmark[]>;
  history: JsonFile<HistoryEntry[]>;
  downloads: JsonFile<DownloadItemInfo[]>;
  assistant: JsonFile<ChatMessage[]>;

  constructor() {
    // Test-only escape hatch for headless Linux CI, where no keyring exists.
    // Never set on macOS, where safeStorage is backed by the Keychain.
    if (process.platform === 'linux' && process.env.SGX_ALLOW_INSECURE_KEYSTORE === '1' && !safeStorage.isEncryptionAvailable()) {
      (safeStorage as any).setUsePlainTextEncryption?.(true);
    }
    this.dir = path.join(app.getPath('userData'), 'data');
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.settings = new JsonFile(path.join(this.dir, 'settings.json'), { ...DEFAULT_SETTINGS });
    this.secrets = new JsonFile(path.join(this.dir, 'secrets.json'), {});
    this.bookmarks = new JsonFile(path.join(this.dir, 'bookmarks.json'), [] as Bookmark[]);
    this.history = new JsonFile(path.join(this.dir, 'history.json'), [] as HistoryEntry[]);
    this.downloads = new JsonFile(path.join(this.dir, 'downloads.json'), [] as DownloadItemInfo[]);
    this.assistant = new JsonFile(path.join(this.dir, 'assistant.json'), [] as ChatMessage[]);
  }

  flushAll() {
    for (const f of [this.settings, this.secrets, this.bookmarks, this.history, this.downloads, this.assistant]) f.flush();
  }

  // ---------- settings ----------
  getSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...this.settings.get() };
  }
  updateSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.getSettings(), ...patch };
    next.sourcesPerAnswer = Math.min(10, Math.max(3, Number(next.sourcesPerAnswer) || DEFAULT_SETTINGS.sourcesPerAnswer));
    this.settings.set(next);
    return next;
  }

  // ---------- secrets ----------
  setSecret(name: SecretName, value: string) {
    const all = { ...this.secrets.get() };
    const trimmed = value.trim();
    if (!trimmed) {
      delete all[name];
    } else if (safeStorage.isEncryptionAvailable()) {
      all[name] = 'enc:' + safeStorage.encryptString(trimmed).toString('base64');
    } else {
      // Should not happen on macOS; refuse to store keys in plain text.
      throw new Error('Secure storage is not available on this system, so the key was not saved.');
    }
    this.secrets.set(all);
  }
  getSecret(name: SecretName): string {
    const raw = this.secrets.get()[name];
    if (!raw) return '';
    try {
      if (raw.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'));
    } catch (err) {
      console.error('Could not decrypt secret', name, err);
    }
    return '';
  }
  secretStatus(): SecretStatus {
    const s = this.secrets.get();
    return {
      openaiKey: !!s.openaiKey,
      anthropicKey: !!s.anthropicKey,
      braveKey: !!s.braveKey,
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    };
  }

  // ---------- bookmarks ----------
  listBookmarks() {
    return this.bookmarks.get();
  }
  toggleBookmark(entry: { url: string; title: string; favicon?: string }): boolean {
    const list = this.bookmarks.get();
    const existing = list.find((b) => b.url === entry.url);
    if (existing) {
      this.bookmarks.set(list.filter((b) => b.url !== entry.url));
      return false;
    }
    this.bookmarks.set([{ id: crypto.randomUUID(), createdAt: Date.now(), ...entry }, ...list]);
    return true;
  }
  removeBookmark(id: string) {
    this.bookmarks.set(this.bookmarks.get().filter((b) => b.id !== id));
  }

  // ---------- history ----------
  addHistory(entry: { url: string; title: string; favicon?: string }) {
    if (!/^https?:/i.test(entry.url)) return;
    const list = this.history.get();
    const now = Date.now();
    // Collapse rapid repeats of the same URL (redirects, title updates).
    if (list[0] && list[0].url === entry.url && now - list[0].visitedAt < 30 * 60 * 1000) {
      list[0] = { ...list[0], title: entry.title || list[0].title, favicon: entry.favicon || list[0].favicon };
      this.history.set([...list]);
      return;
    }
    this.history.set([{ id: crypto.randomUUID(), visitedAt: now, ...entry }, ...list].slice(0, MAX_HISTORY));
  }
  searchHistory(query: string, limit = 300): HistoryEntry[] {
    const q = query.trim().toLowerCase();
    const list = this.history.get();
    if (!q) return list.slice(0, limit);
    return list.filter((h) => h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q)).slice(0, limit);
  }
  removeHistory(id: string) {
    this.history.set(this.history.get().filter((h) => h.id !== id));
  }
  clearHistory() {
    this.history.set([]);
  }

  // ---------- downloads ----------
  upsertDownload(item: DownloadItemInfo) {
    const list = this.downloads.get().filter((d) => d.id !== item.id);
    this.downloads.set([item, ...list].slice(0, MAX_DOWNLOADS));
  }
  listDownloads() {
    return this.downloads.get();
  }
  clearDownloads() {
    this.downloads.set(this.downloads.get().filter((d) => d.state === 'progressing'));
  }

  // ---------- assistant conversation ----------
  getAssistant() {
    return this.assistant.get();
  }
  setAssistant(messages: ChatMessage[]) {
    this.assistant.set(messages.slice(-80));
  }
}
