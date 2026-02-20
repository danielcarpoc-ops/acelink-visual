declare module 'chromecasts' {
  export interface ChromecastDevice {
    name: string;
    host: string;
    port: number;
    play(url: string, opts?: { title?: string; type?: string }, cb?: (err: Error | null) => void): void;
    pause(cb?: (err: Error | null) => void): void;
    resume(cb?: (err: Error | null) => void): void;
    stop(cb?: (err: Error | null) => void): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
  }

  export interface ChromecastsModule {
    players: ChromecastDevice[];
    on(event: 'update' | 'update-player', callback: (player: ChromecastDevice) => void): void;
    removeListener(event: string, callback: (...args: unknown[]) => void): void;
  }

  const chromecasts: ChromecastsModule;
  export default chromecasts;
}
