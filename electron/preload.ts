import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  checkDockerStatus: () => ipcRenderer.invoke('check-docker-status'),
  getStreamUrl: (id: string) => ipcRenderer.invoke('get-stream-url', id),
  openVlc: (url: string) => ipcRenderer.invoke('open-vlc', url),
  telegramAction: (command: any) => ipcRenderer.invoke('telegram-action', command)
});
