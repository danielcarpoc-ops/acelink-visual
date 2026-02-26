/// <reference types="vite/client" />

interface ChromecastDevice {
  name: string;
  host: string;
}

interface Window {
  electronAPI: {
    checkDockerStatus: () => Promise<string>;
    startEngine: () => Promise<boolean>;
    readConfig: () => Promise<{ api_id: string | number; api_hash: string }>;
    writeConfig: (configData: { api_id: string | number; api_hash: string }) => Promise<boolean>;
    getCurrentEpg: () => Promise<any[]>;
    getChannelLogos: () => Promise<Record<string, string>>;
    getStreamUrl: (id: string) => Promise<string>;
    getProxyUrl: (id: string) => Promise<string>;
    openVlc: (url: string) => Promise<void>;
    telegramAction: (command: Record<string, unknown>) => Promise<unknown>;
    setAlwaysOnTop?: (value: boolean) => Promise<boolean>;
    // Chromecast methods
    chromecastGetDevices: () => Promise<ChromecastDevice[]>;
    chromecastScan: () => Promise<ChromecastDevice[]>;
    chromecastStart: (deviceName: string, streamUrl: string) => Promise<{ success: boolean; device: string }>;
    chromecastStop: () => Promise<{ success: boolean; error?: string }>;
    chromecastPause: () => Promise<{ success: boolean; error?: string }>;
    chromecastResume: () => Promise<{ success: boolean; error?: string }>;
    onChromecastDevicesUpdated: (callback: (devices: ChromecastDevice[]) => void) => () => void;
    onChromecastStatusChanged: (callback: (status: { isCasting: boolean; device?: string }) => void) => () => void;
  }
}
