/// <reference types="vite/client" />

interface ChromecastDevice {
  name: string;
  host: string;
}

interface Window {
  electronAPI: {
    checkDockerStatus: () => Promise<string>;
    getStreamUrl: (id: string) => Promise<string>;
    getProxyUrl: (id: string) => Promise<string>;
    openVlc: (url: string) => Promise<void>;
    telegramAction: (command: Record<string, unknown>) => Promise<unknown>;
    setAlwaysOnTop?: (value: boolean) => Promise<boolean>;
    // Chromecast methods
    chromecastGetDevices: () => Promise<ChromecastDevice[]>;
    chromecastStart: (deviceName: string, streamUrl: string) => Promise<{ success: boolean; device: string }>;
    chromecastStop: () => Promise<{ success: boolean; error?: string }>;
    chromecastPause: () => Promise<{ success: boolean; error?: string }>;
    chromecastResume: () => Promise<{ success: boolean; error?: string }>;
    onChromecastDevicesUpdated: (callback: (devices: ChromecastDevice[]) => void) => () => void;
    onChromecastStatusChanged: (callback: (status: { isCasting: boolean; device?: string }) => void) => () => void;
  }
}
