import { useState } from 'react';
import { Check, Eye, EyeOff, FolderPlus, KeyRound, Monitor, Moon, ShieldCheck, Sun, Trash2 } from 'lucide-react';
import type { SecretName, SecretStatus, Settings } from '../../shared/types';
import { api } from '../api';
import { Overlay } from './Overlay';

interface Props {
  settings: Settings;
  secrets: SecretStatus | null;
  version: string;
  onSettings: (s: Settings) => void;
  onSecrets: (s: SecretStatus) => void;
  onClose: () => void;
}

export function SettingsPanel(p: Props) {
  const s = p.settings;
  const [msg, setMsg] = useState('');
  const set = async (patch: Partial<Settings>) => p.onSettings(await api.setSettings(patch));
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 2500);
  };

  return (
    <Overlay title="Settings" onClose={p.onClose}>
      <div className="space-y-8 px-6 py-5 text-[13.5px]">
        {msg && <div className="rounded-xl bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-300">{msg}</div>}

        <Section title="AI features" desc="Off by default. While off, SearchGPT X is a plain browser: no assistant, no AI answers, and nothing is ever sent to an AI service.">
          <Switch label="Turn on AI features" desc="Adds AI answers on the home screen and the Assistant panel. Needs your own OpenAI or Anthropic API key." on={s.aiEnabled} onChange={(v) => set({ aiEnabled: v })} />
        </Section>

        {s.aiEnabled && (
        <Section title="AI provider" desc="Answers are written by the provider you choose, using your own API key.">
          <div className="flex gap-2">
            {(
              [
                ['openai', 'OpenAI'],
                ['anthropic', 'Anthropic (Claude)']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => set({ aiProvider: id })}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition ${s.aiProvider === id ? 'border-grape bg-grape/10' : 'border-ink-200 hover:border-ink-300 dark:border-ink-700'}`}
              >
                <div className="flex items-center justify-between font-medium">
                  {label} {s.aiProvider === id && <Check size={15} className="text-grape" />}
                </div>
                <div className="mt-0.5 text-xs text-ink-500">
                  {(id === 'openai' ? p.secrets?.openaiKey : p.secrets?.anthropicKey) ? 'Key saved' : 'No key yet'}
                </div>
              </button>
            ))}
          </div>
          {s.aiProvider === 'openai' ? (
            <>
              <KeyField name="openaiKey" label="OpenAI API key" placeholder="sk-…" saved={!!p.secrets?.openaiKey} onSaved={(st) => (p.onSecrets(st), flash('Key saved securely in your Keychain-protected store.'))} help="platform.openai.com → API keys" />
              <Field label="Model" value={s.openaiModel} onChange={(v) => set({ openaiModel: v })} help="For example gpt-5-mini (fast) or gpt-5 (smarter)." />
              <Field label="API base URL" value={s.openaiBaseUrl} onChange={(v) => set({ openaiBaseUrl: v })} help="Leave as is for OpenAI. Any OpenAI-compatible endpoint works (for example a local Ollama server at http://localhost:11434/v1)." />
            </>
          ) : (
            <>
              <KeyField name="anthropicKey" label="Anthropic API key" placeholder="sk-ant-…" saved={!!p.secrets?.anthropicKey} onSaved={(st) => (p.onSecrets(st), flash('Key saved securely.'))} help="console.anthropic.com → API keys" />
              <Field label="Model" value={s.anthropicModel} onChange={(v) => set({ anthropicModel: v })} help="For example claude-sonnet-5-5 or claude-haiku-5-5 (faster)." />
            </>
          )}
        </Section>

        )}

        <Section title="Search" desc={s.aiEnabled ? 'Where live web results come from.' : 'Where your searches go.'}>
          {s.aiEnabled && (<>
          <KeyField name="braveKey" label="Brave Search API key" placeholder="BSA…" saved={!!p.secrets?.braveKey} onSaved={(st) => (p.onSecrets(st), flash('Brave key saved.'))} help="api-dashboard.search.brave.com — the free tier works. Needed for image and video search." />
          <Switch
            label="Use Brave Search when a key is saved"
            desc="Without a key, SearchGPT X falls back to DuckDuckGo’s HTML results for web search."
            on={s.useBraveSearch}
            onChange={(v) => set({ useBraveSearch: v })}
          />
          <div className="flex items-center justify-between">
            <span>Sources read per answer</span>
            <select value={s.sourcesPerAnswer} onChange={(e) => set({ sourcesPerAnswer: Number(e.target.value) })} className="rounded-lg border border-ink-200 bg-transparent px-2 py-1 dark:border-ink-700">
              {[3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          </>)}
          <div className="flex items-center justify-between">
            <span>{s.aiEnabled ? 'Address bar searches go to' : 'Search engine'}</span>
            <select value={!s.aiEnabled && s.searchEngineForAddressBar === 'ai' ? 'duckduckgo' : s.searchEngineForAddressBar} onChange={(e) => set({ searchEngineForAddressBar: e.target.value as Settings['searchEngineForAddressBar'] })} className="rounded-lg border border-ink-200 bg-transparent px-2 py-1 dark:border-ink-700">
              {s.aiEnabled && <option value="ai">SearchGPT X (AI answer)</option>}
              <option value="duckduckgo">DuckDuckGo</option>
              <option value="google">Google</option>
              <option value="bing">Bing</option>
              <option value="brave">Brave Search</option>
            </select>
          </div>
        </Section>

        <Section title="Appearance">
          <div className="flex gap-2">
            {(
              [
                ['system', 'System', Monitor],
                ['light', 'Light', Sun],
                ['dark', 'Dark', Moon]
              ] as const
            ).map(([id, label, Icon]) => (
              <button key={id} onClick={() => set({ theme: id })} className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 ${s.theme === id ? 'border-grape bg-grape/10' : 'border-ink-200 dark:border-ink-700'}`}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Privacy" desc="SearchGPT X has no accounts, analytics or telemetry. Nothing is sold or shared.">
          <Switch label="Block known trackers" desc="Blocks requests to ~150 common third-party ad and tracking domains, and sends Global Privacy Control." on={s.trackingProtection} onChange={(v) => set({ trackingProtection: v })} />
          {s.aiEnabled && <Switch label="Send the current page to the assistant by default" desc="Off: page text is only sent when you use a page action or turn on “Use page”." on={s.sendPageContextAutomatically} onChange={(v) => set({ sendPageContextAutomatically: v })} />}
          <div className="rounded-2xl border border-ink-200 bg-ink-50 p-4 text-[12.5px] leading-relaxed text-ink-600 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300">
            <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-ink-800 dark:text-ink-100">
              <ShieldCheck size={15} className="text-emerald-500" /> What leaves this Mac
            </div>
            <ul className="list-disc space-y-1 pl-5">
              {!s.aiEnabled && <li><b>AI is off:</b> nothing is sent to any AI service, and no API keys are needed.</li>}
              {s.aiEnabled && <><li><b>AI searches:</b> your question (and earlier turns in the same thread) go to your search provider (Brave or DuckDuckGo). The question plus text from the result pages go to {s.aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'}.</li>
              <li><b>Assistant:</b> your messages go to {s.aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'}. Page or file text is included only when you ask about the page, attach a file, or turn on “Use page”.</li></>}
              <li><b>Browsing:</b> pages load directly from the websites you visit, like any browser. Site icons in results come from DuckDuckGo’s icon service.</li>
              <li><b>Stored locally:</b> history, bookmarks, downloads list and the assistant conversation are kept in this Mac’s user folder. API keys are encrypted with macOS Keychain-backed storage.</li>
              <li><b>Networks:</b> SearchGPT X uses your Mac’s normal network settings. School or work networks and device management can still filter or monitor traffic; the browser does not change that.</li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['Clear history', { history: true }],
                ['Clear cookies & site data', { cookies: true }],
                ['Clear cache', { cache: true }],
                ...(s.aiEnabled ? ([['Clear assistant conversation', { assistant: true }]] as const) : [])
              ] as const
            ).map(([label, what]) => (
              <button
                key={label}
                onClick={async () => {
                  if (!confirm(`${label}?`)) return;
                  await api.clearData(what);
                  flash(`${label} — done.`);
                }}
                className="flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-xs hover:border-ember hover:text-ember dark:border-ink-700"
              >
                <Trash2 size={12} /> {label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Extensions" desc="Load unpacked Chrome extensions. Electron supports only part of the extension API, so many extensions (including most password managers) won’t fully work.">
          {s.extensions.map((dir) => (
            <div key={dir} className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-xs dark:bg-ink-950">
              <span className="flex-1 truncate">{dir}</span>
              <button onClick={async () => p.onSettings(await api.removeExtension(dir))} className="text-ink-400 hover:text-ember">
                Remove (after restart)
              </button>
            </div>
          ))}
          <button
            onClick={async () => {
              try {
                p.onSettings(await api.addExtension());
              } catch (e: any) {
                alert(e.message);
              }
            }}
            className="flex items-center gap-2 rounded-full border border-ink-200 px-3 py-1.5 text-xs dark:border-ink-700"
          >
            <FolderPlus size={13} /> Load unpacked extension…
          </button>
          <p className="text-xs text-ink-500">
            Passwords: SearchGPT X has no built-in password manager. Password managers with system-wide autofill (for example 1Password’s Universal Autofill, or the macOS Passwords menu-bar app) work in any app, including this one.
          </p>
        </Section>

        <Section title="General">
          <button
            onClick={async () => flash((await api.setDefaultBrowser()) ? 'macOS will ask you to confirm the change.' : 'Could not request default-browser status.')}
            className="rounded-full border border-ink-200 px-3 py-1.5 text-xs dark:border-ink-700"
          >
            Make SearchGPT X the default browser
          </button>
          <p className="text-xs text-ink-400">Version {p.version}</p>
        </Section>
      </div>
    </Overlay>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {desc && <p className="mt-0.5 text-xs text-ink-500">{desc}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, value, onChange, help }: { label: string; value: string; onChange: (v: string) => void; help?: string }) {
  const [v, setV] = useState(value);
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-600 dark:text-ink-300">{label}</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v.trim() && v !== value && onChange(v.trim())}
        spellCheck={false}
        className="mt-1 w-full rounded-xl border border-ink-200 bg-transparent px-3 py-2 outline-none focus:border-grape dark:border-ink-700"
      />
      {help && <span className="mt-1 block text-[11.5px] text-ink-400">{help}</span>}
    </label>
  );
}

function KeyField({ name, label, placeholder, saved, onSaved, help }: { name: SecretName; label: string; placeholder: string; saved: boolean; onSaved: (s: SecretStatus) => void; help?: string }) {
  const [v, setV] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const save = async (value: string) => {
    try {
      setErr('');
      onSaved(await api.setSecret(name, value));
      setV('');
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <div>
      <span className="text-xs font-medium text-ink-600 dark:text-ink-300">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <div className="flex flex-1 items-center rounded-xl border border-ink-200 px-3 focus-within:border-grape dark:border-ink-700">
          <KeyRound size={14} className="text-ink-400" />
          <input
            type={show ? 'text' : 'password'}
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && v.trim() && save(v)}
            placeholder={saved ? '•••••••• saved — paste a new key to replace' : placeholder}
            spellCheck={false}
            className="w-full bg-transparent px-2 py-2 outline-none"
          />
          <button onClick={() => setShow((x) => !x)} className="text-ink-400" type="button">
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button onClick={() => save(v)} disabled={!v.trim()} className="brand-bg rounded-xl px-3.5 py-2 text-xs font-medium text-white disabled:opacity-40">
          Save
        </button>
        {saved && (
          <button onClick={() => save('')} className="rounded-xl px-2 py-2 text-xs text-ink-500 hover:text-ember">
            Remove
          </button>
        )}
      </div>
      {err && <span className="mt-1 block text-xs text-ember">{err}</span>}
      {help && <span className="mt-1 block text-[11.5px] text-ink-400">{help}</span>}
    </div>
  );
}

function Switch({ label, desc, on, onChange }: { label: string; desc?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="flex w-full items-start gap-3 text-left">
      <span className="flex-1">
        <span className="block">{label}</span>
        {desc && <span className="block text-xs text-ink-500">{desc}</span>}
      </span>
      <span className={`mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition ${on ? 'brand-bg' : 'bg-ink-300 dark:bg-ink-700'}`}>
        <span className={`h-5 w-5 rounded-full bg-white shadow transition ${on ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}
