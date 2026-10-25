/**
 * The bridge between the sandboxed interface and the main process. It exposes
 * one function per API method (all listed in API_METHODS) plus three helpers,
 * and nothing else: no Node.js, no file system, no raw IPC.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { API_METHODS, EVENTS, channelName } from '@core/api';

const ipc: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
for (const [namespace, methods] of Object.entries(API_METHODS)) {
  ipc[namespace] = {};
  for (const method of methods) {
    ipc[namespace][method] = (...args: unknown[]) => ipcRenderer.invoke(channelName(namespace, method), ...args);
  }
}

contextBridge.exposeInMainWorld('mjournalIpc', ipc);

contextBridge.exposeInMainWorld('mjournalNative', {
  pathForFile(file: unknown): string {
    try {
      return webUtils.getPathForFile(file as File);
    } catch {
      return '';
    }
  },
  onFlushRequest(callback: () => Promise<void> | void): () => void {
    const listener = async () => {
      try {
        await callback();
      } finally {
        ipcRenderer.send(EVENTS.flushDone);
      }
    };
    ipcRenderer.on(EVENTS.flushRequest, listener);
    return () => ipcRenderer.removeListener(EVENTS.flushRequest, listener);
  },
  onNavigate(callback: (hash: string) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, hash: unknown) => {
      if (typeof hash === 'string' && hash.startsWith('#/')) callback(hash);
    };
    ipcRenderer.on(EVENTS.navigate, listener);
    return () => ipcRenderer.removeListener(EVENTS.navigate, listener);
  },
});
