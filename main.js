const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

// Set custom application name for system integration / taskbar
app.setName('transparent-timer');


let mainWindow;
let isClickThrough = false;
let journalProcess;
let currentApp = null;
let currentTitle = null;
let activeSince = null;
const recordsPath = path.join(app.getPath('userData'), 'time_records.json');

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    title: 'Transparent Timer',
    icon: path.join(__dirname, 'icon.png'),
    width: 320,
    height: 180,
    x: width - 340,
    y: 40,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile('index.html');

  // Let the window be draggable from CSS
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function registerKWinScript() {
  const scriptPath = path.join(__dirname, 'kwin_script.js');
  const scriptName = 'transparent_timer_logger';

  // Unload if already loaded
  try {
    execSync(`qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${scriptName}"`);
  } catch (e) {}

  // Load and Run
  try {
    execSync(`qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "${scriptPath}" "${scriptName}"`);
    
    // Query scripting paths to find loaded script ID (e.g. /Scripting/Script0)
    const dbusPaths = execSync(`qdbus org.kde.KWin | grep Scripting`).toString().split('\n');
    const scriptObjPath = dbusPaths.find(p => p.trim().startsWith('/Scripting/Script'));
    if (scriptObjPath) {
      execSync(`qdbus org.kde.KWin ${scriptObjPath.trim()} org.kde.kwin.Script.run`);
      console.log("KWin Script successfully running at:", scriptObjPath.trim());
    } else {
      console.error("Failed to detect script path from DBus");
    }
  } catch (e) {
    console.error("Error registering KWin script:", e);
  }
}

function unregisterKWinScript() {
  const scriptName = 'transparent_timer_logger';
  try {
    execSync(`qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${scriptName}"`);
    console.log("KWin Script unloaded");
  } catch (e) {
    console.error("Error unloading KWin script:", e);
  }
}

function startJournalMonitoring() {
  // Start journalctl to stream logs from now on
  journalProcess = spawn('journalctl', ['--user', '-f', '-o', 'cat', '--since', 'now']);

  journalProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (let line of lines) {
      const match = line.match(/^js: KWIN_ACTIVE_APP:(.*?):(.*)/);
      if (match) {
        const appName = match[1].trim();
        const appTitle = match[2].trim();
        handleWindowChange(appName, appTitle);
      }
    }
  });

  journalProcess.on('error', (err) => {
    console.error('Failed to start journalctl process:', err);
  });
}

function handleWindowChange(appName, appTitle) {
  const now = new Date();
  
  if (currentApp && activeSince) {
    const duration = Math.round((now - activeSince) / 1000);
    if (duration > 0) {
      saveRecord(currentApp, currentTitle, activeSince, duration);
    }
  }

  currentApp = appName;
  currentTitle = appTitle;
  activeSince = now;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('active-app-changed', {
      app: currentApp,
      title: currentTitle,
      startTime: activeSince.toISOString()
    });
  }
}

function saveRecord(appName, appTitle, startTimestamp, duration) {
  let data = { sessions: [] };
  try {
    if (fs.existsSync(recordsPath)) {
      data = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
    }
  } catch (e) {
    data = { sessions: [] };
  }

  data.sessions.push({
    timestamp: startTimestamp.toISOString(),
    app: appName,
    title: appTitle,
    duration: duration
  });

  try {
    fs.writeFileSync(recordsPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error("Failed to write history record file:", e);
  }
}

function saveCurrentSession() {
  if (currentApp && activeSince) {
    const duration = Math.round((new Date() - activeSince) / 1000);
    if (duration > 0) {
      saveRecord(currentApp, currentTitle, activeSince, duration);
    }
  }
}

// IPC Handlers
ipcMain.on('toggle-click-through', (event, ignore) => {
  isClickThrough = ignore;
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.on('get-records', (event) => {
  // Read records and send back to renderer
  try {
    if (fs.existsSync(recordsPath)) {
      const records = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
      event.returnValue = records;
    } else {
      event.returnValue = { sessions: [] };
    }
  } catch (e) {
    event.returnValue = { sessions: [] };
  }
});

ipcMain.on('clear-records', (event) => {
  try {
    fs.writeFileSync(recordsPath, JSON.stringify({ sessions: [] }, null, 2), 'utf8');
    event.returnValue = true;
  } catch (e) {
    event.returnValue = false;
  }
});

app.on('ready', () => {
  createWindow();
  registerKWinScript();
  startJournalMonitoring();

  // Register Alt+T global shortcut to toggle click-through mode
  globalShortcut.register('Alt+T', () => {
    if (mainWindow) {
      isClickThrough = !isClickThrough;
      mainWindow.setIgnoreMouseEvents(isClickThrough, { forward: true });
      mainWindow.webContents.send('update-click-through-checkbox', isClickThrough);
    }
  });
});

app.on('window-all-closed', () => {
  saveCurrentSession();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  saveCurrentSession();
  unregisterKWinScript();
  globalShortcut.unregisterAll();
  if (journalProcess) {
    journalProcess.kill();
  }
});
