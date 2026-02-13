import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import util from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = util.promisify(exec);

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
  return `http://127.0.0.1:6878/ace/getstream?id=${id}`;
});

ipcMain.handle('open-vlc', async (event, url) => {
    // Open VLC with the stream URL
    exec(`open -a VLC "${url}"`);
});

ipcMain.handle('telegram-action', async (event, command) => {
  return await runPythonScript(command);
});
