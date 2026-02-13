/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    checkDockerStatus: () => Promise<string>;
    getStreamUrl: (id: string) => Promise<string>;
    getProxyUrl: (id: string) => Promise<string>;
    openVlc: (url: string) => Promise<void>;
    telegramAction: (command: any) => Promise<any>;
  }
}
