import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import http from 'http';
import url from 'url';
import util from 'util';
import { createRequire } from 'module';
import fs from 'fs';
import { fetchEPG, getCurrentPrograms, getChannelLogos } from './epg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extend PATH so packaged app can find docker, python3, vlc, etc.
// macOS GUI apps launch with a minimal PATH that excludes Homebrew and /usr/local/bin.
const EXTRA_PATHS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];
if (process.platform === 'win32') {
  // Optional paths for Windows could go here if needed. Usually, standard env vars are enough.
} else {
  process.env.PATH = [...new Set([...(process.env.PATH?.split(':') ?? []), ...EXTRA_PATHS])].join(':');
}

const execAsync = util.promisify(exec);

// Chromecast types
interface ChromecastPlayer {
  name: string;
  host: string;
  play(url: string, opts: { type: string }, cb: (err: Error | null) => void): void;
  stop(cb: () => void): void;
  pause(cb: () => void): void;
  resume(cb: () => void): void;
}

interface ChromecastsModule {
  on(event: string, callback: (player: ChromecastPlayer) => void): void;
}

// Chromecast State
let chromecasts: ChromecastsModule | null = null;
let castPlayer: ChromecastPlayer | null = null;
const castDevices: ChromecastPlayer[] = [];

// Proxy Server State
let proxyServer: http.Server | null = null;
const PROXY_PORT = 6879;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const startProxyServer = (): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (proxyServer) {
      resolve(`http://127.0.0.1:${PROXY_PORT}`);
      return;
    }

    proxyServer = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url || '', true);
      const streamId = parsedUrl.query.id;

      console.log(`[Proxy] ${req.method} ${req.url}`);

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400'
        });
        res.end();
        return;
      }

      if (!streamId || typeof streamId !== 'string') {
        res.writeHead(400, {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        });
        res.end('Missing stream ID');
        return;
      }

      const engineUrl = `http://127.0.0.1:6878/ace/getstream?id=${streamId}`;
      console.log(`[Proxy] Forwarding to: ${engineUrl}`);

      // Create proxy request to Ace Stream Engine
      const proxyReq = http.get(engineUrl, {
        timeout: 30000
      }, (proxyRes) => {
        console.log(`[Proxy] Engine status: ${proxyRes.statusCode}`);
        
        // Handle HTTP redirect (302 Found)
        if (proxyRes.statusCode === 302 && proxyRes.headers.location) {
          console.log(`[Proxy] Redirect to: ${proxyRes.headers.location}`);
          // Follow the redirect internally
          const redirectUrl = proxyRes.headers.location;
          http.get(redirectUrl, {
            timeout: 30000
          }, (redirectRes) => {
            console.log(`[Proxy] Redirect response: ${redirectRes.statusCode}`);
            
            const headers: Record<string, string> = {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': 'video/mp2t'
            };
            
            res.writeHead(200, headers);
            redirectRes.pipe(res);
          }).on('error', (err) => {
            console.error('[Proxy] Redirect error:', err);
            res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
            res.end('Failed to connect to stream');
          });
          return;
        }
        
        // Copy headers and add CORS
        const headers: Record<string, string> = {
          'Access-Control-Allow-Origin': '*'
        };
        
        Object.keys(proxyRes.headers).forEach(key => {
          const value = proxyRes.headers[key];
          if (value !== undefined) {
            headers[key] = Array.isArray(value) ? value.join(', ') : value;
          }
        });
        
        // Ensure content-type is set
        if (!headers['content-type'] || headers['content-type'] === 'application/octet-stream') {
          headers['content-type'] = 'video/mp2t';
        }
        
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err: Error) => {
        console.error('[Proxy] Connection error:', err.message);
        res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
        res.end(`Engine connection failed: ${err.message}`);
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        res.writeHead(504, { 'Access-Control-Allow-Origin': '*' });
        res.end('Engine timeout');
      });
    });

    proxyServer.listen(PROXY_PORT, '127.0.0.1', () => {
      console.log(`[Proxy] Server listening on 127.0.0.1:${PROXY_PORT}`);
      resolve(`http://127.0.0.1:${PROXY_PORT}`);
    });

    proxyServer.on('error', (err) => {
      console.error('[Proxy] Server error:', err);
      reject(err);
    });
  });
};

// Bootstrap userData directory: copy config.json from Resources if it doesn't exist yet.
const bootstrapUserData = () => {
  const userDataPath = app.getPath('userData');
  const destConfig = path.join(userDataPath, 'config.json');

  // In production, config.json ships in extraResources (process.resourcesPath).
  // In dev, it lives in the project root (two levels up from dist-electron/).
  const srcConfig = app.isPackaged
    ? path.join(process.resourcesPath, 'config.json')
    : path.join(__dirname, '../config.json');

  console.log(`[Bootstrap] userData path: ${userDataPath}`);
  console.log(`[Bootstrap] config src: ${srcConfig} (exists: ${fs.existsSync(srcConfig)})`);
  console.log(`[Bootstrap] config dest: ${destConfig} (exists: ${fs.existsSync(destConfig)})`);

  if (!fs.existsSync(destConfig)) {
    if (fs.existsSync(srcConfig)) {
      fs.mkdirSync(userDataPath, { recursive: true });
      fs.copyFileSync(srcConfig, destConfig);
      console.log(`[Bootstrap] Copied config.json to ${destConfig}`);
    } else {
      console.warn('[Bootstrap] config.json not found, Telegram features will require manual setup.');
    }
  } else {
    console.log('[Bootstrap] config.json already exists in userData, skipping copy.');
  }
};

// Python Script Helper
const runPythonScript = (command: Record<string, unknown>) => {
  return new Promise((resolve, reject) => {
    const userDataPath = app.getPath('userData');
    const configSrcPath = app.isPackaged
      ? path.join(process.resourcesPath, 'config.json')
      : path.join(__dirname, '../config.json');

    const env = {
      ...process.env,
      ACELINK_USER_DATA: userDataPath,
      ACELINK_CONFIG_FALLBACK: configSrcPath,
    };

    let python;
    if (app.isPackaged) {
      const exeName = process.platform === 'win32' ? 'telegram_worker.exe' : 'telegram_worker';
      const exePath = path.join(process.resourcesPath, 'python-bin', exeName);
      python = spawn(exePath, [], { env });
    } else {
      const scriptPath = path.join(__dirname, '../python/telegram_worker.py');
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      python = spawn(pythonCmd, [scriptPath], { env });
    }
    
    let output = '';
    let error = '';

    // Send data to script
    python.stdin.write(JSON.stringify(command) + '\n');
    python.stdin.end();

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      error += data.toString();
    });

    python.on('close', (code: number | null) => {
      if (code !== 0) {
        console.error('Python Error:', error);
        reject(new Error(error || 'Python script failed'));
        return;
      }
      try {
        console.log('Python Output:', output);
        // Find the last line that looks like JSON, in case of print garbage
        const lines = output.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const result = JSON.parse(lastLine);
        resolve(result);
      } catch {
        reject(new Error('Invalid JSON output from Python: ' + output));
      }
    });
  });
};

let mainWindow: BrowserWindow | null = null;
let engineProcess: ReturnType<typeof spawn> | null = null;

const createWindow = () => {
  const preloadPath = path.join(__dirname, 'preload.mjs');
  console.log('Preload path:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      sandbox: false, // Required for some ESM features in preload
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden', // Mac-like style vs standard hidden

    backgroundColor: '#1a1a1a',
  });

  // Check if we are in dev mode
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

// Docker Management
const waitForDocker = async (maxAttempts = 30): Promise<boolean> => {
  if (process.platform === 'win32') return true;

  console.log('Verifying if Docker is running...');
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await execAsync('docker info');
      console.log('Docker is running.');
      return true;
    } catch {
      if (i === 0 && process.platform === 'darwin') {
        console.log('Docker is not running, attempting to start Docker Desktop...');
        // Open Docker Desktop in background
        exec('open -a Docker -g', () => {});
      }
      console.log(`Waiting for Docker to start... (Attempt ${i + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return false;
};

const checkWindowsEngineStatus = async (): Promise<boolean> => {
  try {
    const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq ace_engine.exe" /NH');
    return stdout.includes('ace_engine.exe');
  } catch (err) {
    return false;
  }
};

const startAceEngine = async () => {
  if (process.platform === 'win32') {
    const isRunning = await checkWindowsEngineStatus();
    if (isRunning) {
      console.log('Ace Engine is already running natively.');
      return;
    }

    const appData = process.env.APPDATA;
    const enginePath = path.join(appData || '', 'ACEStream', 'engine', 'ace_engine.exe');

    if (fs.existsSync(enginePath)) {
      console.log(`Starting Ace Stream Engine natively at ${enginePath}...`);
      engineProcess = spawn(enginePath, [], {
        detached: true,
        stdio: 'ignore'
      });
      engineProcess.unref(); // Allow the parent to exit independently of the child
    } else {
      console.error('Ace Stream Engine not found at', enginePath);
    }
    return;
  }

  try {
    const isDockerRunning = await waitForDocker();
    if (!isDockerRunning) {
      console.error('Docker failed to start or is not installed. Cannot start Ace Engine.');
      return;
    }

    console.log('Stopping existing Ace Stream containers...');
    await execAsync('docker stop acelink-engine').catch(() => {});
    await execAsync('docker rm acelink-engine').catch(() => {});
    
    console.log('Starting Ace Stream Engine (blaiseio/acelink)...');
    // We use the same image as AceLink
    const dockerCmd = 'docker';
    const args = [
      'run', 
      '--rm', 
      '--platform', 'linux/amd64',
      '-p', '6878:6878', 
      '--name', 'acelink-engine', 
      'blaiseio/acelink'
    ];

    engineProcess = spawn(dockerCmd, args);

    if (engineProcess.stdout) {
      engineProcess.stdout.on('data', (data: Buffer) => {
        console.log(`[Engine]: ${data}`);
      });
    }

    if (engineProcess.stderr) {
      engineProcess.stderr.on('data', (data: Buffer) => {
        console.error(`[Engine Error]: ${data}`);
      });
    }

  } catch (err) {
    console.error('Failed to start Docker container:', err);
  }
};

app.whenReady().then(async () => {
  bootstrapUserData();
  createWindow();
  startAceEngine();
  
  // EPG initialization
  fetchEPG();
  setInterval(fetchEPG, 3600000); // refresh every hour

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform === 'win32') {
    // Stop native engine on exit
    exec('taskkill /F /IM ace_engine.exe', () => {
      app.quit();
    });
  } else {
    // Stop container on exit
    exec('docker stop acelink-engine', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
});

app.on('before-quit', async () => {
  if (process.platform === 'win32') {
     await execAsync('taskkill /F /IM ace_engine.exe').catch(() => {});
  } else {
     await execAsync('docker stop acelink-engine').catch(() => {});
  }
});

// IPC Handlers
ipcMain.handle('start-engine', async () => {
  await startAceEngine();
  return true;
});

ipcMain.handle('check-docker-status', async () => {
  if (process.platform === 'win32') {
    const isRunning = await checkWindowsEngineStatus();
    return isRunning ? 'running' : 'stopped';
  }

  try {
    await execAsync('docker ps');
    // Check if our container is running
    const { stdout } = await execAsync('docker ps --filter "name=acelink-engine" --format "{{.Names}}"');
    return stdout.trim() === 'acelink-engine' ? 'running' : 'stopped';
  } catch {
    return 'docker-not-found';
  }
});

ipcMain.handle('read-config', async () => {
  try {
    const userDataPath = app.getPath('userData');
    const destConfig = path.join(userDataPath, 'config.json');
    
    // 1. Try to read from writable userData path
    if (fs.existsSync(destConfig)) {
      const data = fs.readFileSync(destConfig, 'utf8');
      return JSON.parse(data);
    }

    // 2. Fallback to read-only app resources if userData config doesn't exist yet
    const srcConfig = app.isPackaged
      ? path.join(process.resourcesPath, 'config.json')
      : path.join(__dirname, '../config.json');

    if (fs.existsSync(srcConfig)) {
      const data = fs.readFileSync(srcConfig, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to read config.json:', err);
  }
  return { api_id: '', api_hash: '' };
});

ipcMain.handle('get-current-epg', () => {
  return getCurrentPrograms();
});

ipcMain.handle('get-channel-logos', () => {
  return getChannelLogos();
});

ipcMain.handle('write-config', async (event, configData) => {
  try {
    const userDataPath = app.getPath('userData');
    const destConfig = path.join(userDataPath, 'config.json');
    fs.writeFileSync(destConfig, JSON.stringify(configData, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to write config.json:', err);
    return false;
  }
});

ipcMain.handle('get-stream-url', async (event, id) => {
  // Direct URL for external players (VLC)
  return `http://127.0.0.1:6878/ace/getstream?id=${id}`;
});

ipcMain.handle('get-proxy-url', async (event, id) => {
  // Return HLS manifest URL for internal player
  // HLS is much more compatible with browsers than raw MPEG-TS
  return `http://127.0.0.1:6878/ace/manifest.m3u8?id=${id}`;
});

ipcMain.handle('open-vlc', async (event, url) => {
  if (process.platform === 'win32') {
    // Attempt to start VLC from common locations on Windows
    const vlcPaths = [
      'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
      'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'
    ];
    let vlcFound = false;
    for (const vlcPath of vlcPaths) {
      if (fs.existsSync(vlcPath)) {
        exec(`"${vlcPath}" "${url}"`);
        vlcFound = true;
        break;
      }
    }
    if (!vlcFound) {
      // Fallback: use start to let Windows decide
      exec(`start "" "${url}"`);
    }
  } else {
    // Open VLC with the stream URL (macOS)
    exec(`open -a VLC "${url}"`);
  }
});

ipcMain.handle('telegram-action', async (event, command) => {
  return await runPythonScript(command);
});

ipcMain.handle('set-always-on-top', async (event, value: boolean) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(value);
    return value;
  }
  return false;
});

// Chromecast IPC Handlers

// Initialize Chromecast discovery when app starts
const initChromecast = () => {
  try {
    // Use createRequire to load CommonJS module properly
    const require = createRequire(import.meta.url);
    const chromecastsFactory = require('chromecasts');
    // chromecasts exports a factory function, call it to get the instance
    chromecasts = chromecastsFactory() as ChromecastsModule;
    
    // Start discovering Chromecast devices
    chromecasts.on('update', (player: ChromecastPlayer) => {
      console.log('[Chromecast] Found device:', player.name);
      // Update device list
      const existingIndex = castDevices.findIndex(d => d.name === player.name);
      if (existingIndex >= 0) {
        castDevices[existingIndex] = player;
      } else {
        castDevices.push(player);
      }
      
      // Notify renderer of available devices
      if (mainWindow) {
        mainWindow.webContents.send('chromecast-devices-updated', castDevices.map(d => ({ name: d.name, host: d.host })));
      }
    });
    
    console.log('[Chromecast] Discovery initialized');
  } catch (error) {
    console.error('[Chromecast] Failed to initialize:', error);
  }
};

ipcMain.handle('chromecast-scan', () => {
  if (chromecasts) {
    console.log('[Chromecast] Rescanning network...');
    castDevices.length = 0; // Clear the array safely
    
    // Re-initialize to clear cache of old devices
    try {
      const require = createRequire(import.meta.url);
      const chromecastsFactory = require('chromecasts');
      
      // Attempt to clean up old scanner if it has a destroy/close method
      if (typeof (chromecasts as any).destroy === 'function') (chromecasts as any).destroy();
      
      chromecasts = chromecastsFactory() as ChromecastsModule;
      chromecasts.on('update', (player: ChromecastPlayer) => {
        console.log('[Chromecast] Found device (rescanning):', player.name);
        const existingIndex = castDevices.findIndex(d => d.name === player.name);
        if (existingIndex >= 0) {
          castDevices[existingIndex] = player;
        } else {
          castDevices.push(player);
        }
        if (mainWindow) {
          mainWindow.webContents.send('chromecast-devices-updated', castDevices.map(d => ({ name: d.name, host: d.host })));
        }
      });
      // Send empty list to reset the UI immediately
      if (mainWindow) {
        mainWindow.webContents.send('chromecast-devices-updated', []);
      }
    } catch (e) {
      console.error('[Chromecast] Rescan error:', e);
    }
  }
  return [];
});

app.whenReady().then(() => {
  initChromecast();
});

ipcMain.handle('chromecast-get-devices', async () => {
  return castDevices.map(d => ({ name: d.name, host: d.host }));
});

ipcMain.handle('chromecast-start', async (event, deviceName: string, streamUrl: string) => {
  try {
    const device = castDevices.find(d => d.name === deviceName);
    if (!device) {
      throw new Error(`Device "${deviceName}" not found`);
    }
    
    return new Promise((resolve, reject) => {
      device.play(streamUrl, { type: 'application/x-mpegurl' }, (err: Error | null) => {
        if (err) {
          console.error('[Chromecast] Error playing:', err);
          reject(err.message);
        } else {
          console.log('[Chromecast] Started playing on:', deviceName);
          castPlayer = device;
          
          // Notify renderer that casting started
          if (mainWindow) {
            mainWindow.webContents.send('chromecast-status-changed', { isCasting: true, device: deviceName });
          }
          
          resolve({ success: true, device: deviceName });
        }
      });
    });
  } catch (error) {
    console.error('[Chromecast] Start error:', error);
    throw error;
  }
});

ipcMain.handle('chromecast-stop', async () => {
  if (castPlayer) {
    const player = castPlayer;
    return new Promise((resolve) => {
      player.stop(() => {
        console.log('[Chromecast] Stopped playing');
        castPlayer = null;
        
        // Notify renderer that casting stopped
        if (mainWindow) {
          mainWindow.webContents.send('chromecast-status-changed', { isCasting: false });
        }
        
        resolve({ success: true });
      });
    });
  }
  return { success: false, error: 'No active casting session' };
});

ipcMain.handle('chromecast-pause', async () => {
  if (castPlayer) {
    const player = castPlayer;
    return new Promise((resolve) => {
      player.pause(() => {
        resolve({ success: true });
      });
    });
  }
  return { success: false, error: 'No active casting session' };
});

ipcMain.handle('chromecast-resume', async () => {
  if (castPlayer) {
    const player = castPlayer;
    return new Promise((resolve) => {
      player.resume(() => {
        resolve({ success: true });
      });
    });
  }
  return { success: false, error: 'No active casting session' };
});
