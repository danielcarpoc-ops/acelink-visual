import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import http from 'http';
import url from 'url';
import util from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = util.promisify(exec);

// Proxy Server State
let proxyServer: http.Server | null = null;
const PROXY_PORT = 6879;

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
          const redirectReq = http.get(redirectUrl, {
            timeout: 30000
          }, (redirectRes) => {
            console.log(`[Proxy] Redirect response: ${redirectRes.statusCode}`);
            
            const headers: any = {
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
        const headers: any = {
          'Access-Control-Allow-Origin': '*'
        };
        
        Object.keys(proxyRes.headers).forEach(key => {
          headers[key] = proxyRes.headers[key];
        });
        
        // Ensure content-type is set
        if (!headers['content-type'] || headers['content-type'] === 'application/octet-stream') {
          headers['content-type'] = 'video/mp2t';
        }
        
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
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

// Python Script Helper
const runPythonScript = (command: any) => {
  return new Promise((resolve, reject) => {
    // We use python3 directly. In a packaged app, we might need to bundle a python runtime or require user to have it.
    // For this prototype, we rely on system python3.
    // If in dev, python/ is in root. If in prod, resources/python
    let scriptPath = path.join(__dirname, '../python/telegram_worker.py');
    
    // Simple check for prod mode structure if needed later
    // if (app.isPackaged) ...

    const python = spawn('python3', [scriptPath]);
    
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

    python.on('close', (code) => {
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
      } catch (e) {
        reject(new Error('Invalid JSON output from Python: ' + output));
      }
    });
  });
};

let mainWindow: BrowserWindow | null = null;
let engineProcess: any = null;

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
    titleBarStyle: 'hiddenInset', // Mac-like style
    backgroundColor: '#1a1a1a',
  });

  // Check if we are in dev mode
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // mainWindow.webContents.openDevTools(); // Optional: open dev tools on start
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

// Docker Management
const startAceEngine = async () => {
  try {
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

    engineProcess.stdout.on('data', (data: any) => {
      console.log(`[Engine]: ${data}`);
    });

    engineProcess.stderr.on('data', (data: any) => {
      console.error(`[Engine Error]: ${data}`);
    });

  } catch (err) {
    console.error('Failed to start Docker container:', err);
  }
};

app.whenReady().then(async () => {
  createWindow();
  startAceEngine();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Stop container on exit
  exec('docker stop acelink-engine', () => {
    if (process.platform !== 'darwin') app.quit();
  });
});

app.on('before-quit', async () => {
   await execAsync('docker stop acelink-engine').catch(() => {});
});

// IPC Handlers
ipcMain.handle('check-docker-status', async () => {
  try {
    await execAsync('docker ps');
    // Check if our container is running
    const { stdout } = await execAsync('docker ps --filter "name=acelink-engine" --format "{{.Names}}"');
    return stdout.trim() === 'acelink-engine' ? 'running' : 'stopped';
  } catch (e) {
    return 'docker-not-found';
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
    // Open VLC with the stream URL
    exec(`open -a VLC "${url}"`);
});

ipcMain.handle('telegram-action', async (event, command) => {
  return await runPythonScript(command);
});
