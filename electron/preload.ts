import { contextBridge, ipcRenderer } from 'electron';

interface ChromecastDevice {
  name: string;
  host: string;
}

contextBridge.exposeInMainWorld('electronAPI', {
  checkDockerStatus: () => ipcRenderer.invoke('check-docker-status'),
  startEngine: () => ipcRenderer.invoke('start-engine'),
  readConfig: () => ipcRenderer.invoke('read-config'),
  writeConfig: (configData: any) => ipcRenderer.invoke('write-config', configData),
  getCurrentEpg: () => ipcRenderer.invoke('get-current-epg'),
  getChannelLogos: () => ipcRenderer.invoke('get-channel-logos'),
  getStreamUrl: (id: string) => ipcRenderer.invoke('get-stream-url', id),
  getProxyUrl: (id: string) => ipcRenderer.invoke('get-proxy-url', id),
  openVlc: (url: string) => ipcRenderer.invoke('open-vlc', url),
  telegramAction: (command: Record<string, unknown>) => ipcRenderer.invoke('telegram-action', command),
  setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke('set-always-on-top', value),
  // Chromecast methods
  chromecastGetDevices: () => ipcRenderer.invoke('chromecast-get-devices'),
  chromecastScan: () => ipcRenderer.invoke('chromecast-scan'),
  chromecastStart: (deviceName: string, streamUrl: string) => ipcRenderer.invoke('chromecast-start', deviceName, streamUrl),
  chromecastStop: () => ipcRenderer.invoke('chromecast-stop'),
  chromecastPause: () => ipcRenderer.invoke('chromecast-pause'),
  chromecastResume: () => ipcRenderer.invoke('chromecast-resume'),
  onChromecastDevicesUpdated: (callback: (devices: ChromecastDevice[]) => void) => {
    ipcRenderer.on('chromecast-devices-updated', (_, devices) => callback(devices));
  },
  onChromecastStatusChanged: (callback: (status: { isCasting: boolean; device?: string }) => void) => {
    ipcRenderer.on('chromecast-status-changed', (_, status) => callback(status));
  }
});
