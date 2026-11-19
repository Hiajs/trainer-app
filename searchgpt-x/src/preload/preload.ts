// The only bridge between the UI and the main process. Web pages shown in
// tabs never get this preload: they run in sandboxed <webview>s with no Node.

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

function on<T>(channel: string, cb: (payload: T) => void) {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on
};

contextBridge.exposeInMainWorld('sgx', api);
export type SgxApi = typeof api;
