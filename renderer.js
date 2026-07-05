const { ipcRenderer } = require('electron');

// UI Elements
const timerTime = document.getElementById('timer-time');
const timerModeBadge = document.getElementById('timer-mode-badge');
const activeAppName = document.getElementById('active-app-name');
const btnTimerToggle = document.getElementById('btn-timer-toggle');
const btnTimerReset = document.getElementById('btn-timer-reset');
const btnGoStats = document.getElementById('btn-go-stats');
const btnGoSettings = document.getElementById('btn-go-settings');

const screenTimer = document.getElementById('screen-timer');
const screenStats = document.getElementById('screen-stats');
const screenSettings = document.getElementById('screen-settings');

const btnStatsBack = document.getElementById('btn-stats-back');
const btnClearStats = document.getElementById('btn-clear-stats');
const statsSummaryList = document.getElementById('stats-summary-list');

const btnSettingsBack = document.getElementById('btn-settings-back');
const modeStopwatch = document.getElementById('mode-stopwatch');
const modeCountdown = document.getElementById('mode-countdown');
const settingsCountdownGroup = document.getElementById('settings-countdown-group');
const inputLimitMinutes = document.getElementById('input-limit-minutes');
const btnStepDown = document.getElementById('btn-step-down');
const btnStepUp = document.getElementById('btn-step-up');
const toggleClickthrough = document.getElementById('toggle-clickthrough');

const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');

// App State
let timerMode = 'stopwatch'; // 'stopwatch' or 'countdown'
let timerInterval = null;
let timerSeconds = 0;
let countdownLimitSeconds = 30 * 60; // default 30 mins
let isTimerRunning = false;
let trackingApp = null;
let trackingAppDuration = 0;
let trackingAppInterval = null;
let myChart = null;

// Audio for countdown completion
const beepAudio = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YV9vT19AQAECBAQEBQYGBwcHCAkJCgoKCwsMDQ0ODg8PEBARERITExQUFRYWFhcYGRkaGxscHR4eHxAgISIiIyQlJicoKSorLC0uLzAxMjIzNDU2Nzg5Ojo7PD0+P0BBQkNERUZHSElKS0tMTU5PUFFSU1RVVlZYWFlaW1tcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==');

// --- Helper Functions ---
function formatTime(totalSeconds) {
  const isNegative = totalSeconds < 0;
  const absSeconds = Math.abs(totalSeconds);
  const hrs = Math.floor(absSeconds / 3600);
  const mins = Math.floor((absSeconds % 3600) / 60);
  const secs = absSeconds % 60;
  
  const padded = [
    hrs.toString().padStart(2, '0'),
    mins.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
  
  return isNegative ? `-${padded}` : padded;
}

function updateTimerDisplay() {
  timerTime.textContent = formatTime(timerSeconds);
  
  // Visual alerts if countdown timer exceeds limit
  if (timerMode === 'countdown') {
    if (timerSeconds <= 0) {
      timerTime.style.color = '#ef4444';
      timerTime.style.textShadow = '0 0 15px rgba(239, 68, 68, 0.6)';
    } else {
      timerTime.style.color = '#ffffff';
      timerTime.style.textShadow = '0 0 20px rgba(255, 255, 255, 0.2)';
    }
  } else {
    timerTime.style.color = '#ffffff';
    timerTime.style.textShadow = '0 0 20px rgba(255, 255, 255, 0.2)';
  }
}

// --- Timer Core Logic ---
function startTimer() {
  if (isTimerRunning) return;
  isTimerRunning = true;
  btnTimerToggle.innerHTML = '<span class="material-icons-round">pause</span>';
  
  timerInterval = setInterval(() => {
    if (timerMode === 'stopwatch') {
      timerSeconds++;
    } else {
      timerSeconds--;
      if (timerSeconds === 0) {
        triggerNotification();
      }
    }
    updateTimerDisplay();
  }, 1000);
}

function pauseTimer() {
  if (!isTimerRunning) return;
  isTimerRunning = false;
  btnTimerToggle.innerHTML = '<span class="material-icons-round">play_arrow</span>';
  clearInterval(timerInterval);
}

function resetTimer() {
  pauseTimer();
  if (timerMode === 'stopwatch') {
    timerSeconds = 0;
  } else {
    timerSeconds = countdownLimitSeconds;
  }
  updateTimerDisplay();
}

function triggerNotification() {
  try {
    beepAudio.play();
  } catch(e) {}
  
  new Notification('時間制限に達しました！', {
    body: '設定されたタイマー時間が終了しました。作業を切り替えるか、休憩を取りましょう！',
    silent: false
  });
}

// --- Navigation ---
function showScreen(screen) {
  [screenTimer, screenStats, screenSettings].forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
  
  if (screen === screenStats) {
    renderStats();
  }
}

// --- Active App Monitoring ---
ipcRenderer.on('active-app-changed', (event, data) => {
  const displayApp = data.app && data.app !== 'unknown' ? data.app : 'デスクトップ';
  trackingApp = data.app;
  trackingAppDuration = 0;
  
  activeAppName.textContent = `${displayApp}`;
  
  // Visual pulse on change
  activeAppName.parentElement.style.animation = 'none';
  void activeAppName.parentElement.offsetWidth; // trigger reflow
  activeAppName.parentElement.style.animation = 'pulse 1.5s ease-out';
});

// Update local tracking duration
setInterval(() => {
  if (trackingApp) {
    trackingAppDuration++;
    const displayApp = trackingApp !== 'unknown' ? trackingApp : 'デスクトップ';
    activeAppName.textContent = `${displayApp} (${formatTime(trackingAppDuration)})`;
  }
}, 1000);

// --- Stats and Charts ---
function renderStats() {
  const records = ipcRenderer.sendSync('get-records');
  const sessions = records.sessions || [];
  
  // Aggregate duration by app
  const appMap = {};
  let totalTime = 0;
  
  sessions.forEach(s => {
    const app = s.app || '不明なアプリ';
    appMap[app] = (appMap[app] || 0) + s.duration;
    totalTime += s.duration;
  });
  
  // Sort apps by duration
  const sortedApps = Object.entries(appMap).sort((a, b) => b[1] - a[1]);
  
  // Render Summary List
  statsSummaryList.innerHTML = '';
  if (sortedApps.length === 0) {
    statsSummaryList.innerHTML = '<div class="version-info">データがありません</div>';
  } else {
    sortedApps.forEach(([app, duration]) => {
      const pct = totalTime > 0 ? Math.round((duration / totalTime) * 100) : 0;
      const item = document.createElement('div');
      item.className = 'stat-item';
      item.style.borderLeftColor = getAppColor(app);
      item.innerHTML = `
        <div class="stat-item-info">
          <span class="stat-item-app">${app}</span>
          <span class="stat-item-time">${formatTime(duration)} (${pct}%)</span>
        </div>
      `;
      statsSummaryList.appendChild(item);
    });
  }

  // Draw/Update Doughnut Chart
  const labels = sortedApps.map(([app]) => app);
  const dataValues = sortedApps.map(([, duration]) => duration);
  const backgroundColors = labels.map(app => getAppColor(app));
  
  if (myChart) {
    myChart.destroy();
  }
  
  const ctx = document.getElementById('time-chart').getContext('2d');
  myChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: dataValues,
        backgroundColor: backgroundColors,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const app = context.label;
              const val = context.raw;
              return ` ${app}: ${formatTime(val)}`;
            }
          }
        }
      },
      cutout: '70%'
    }
  });
}

const colorPalette = [
  '#a855f7', // Purple
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#3b82f6', // Blue
  '#ef4444', // Red
  '#84cc16'  // Lime
];

const appColorCache = {};
let colorIndex = 0;

function getAppColor(app) {
  if (appColorCache[app]) return appColorCache[app];
  
  if (app.toLowerCase() === 'google-chrome' || app.toLowerCase().includes('chrome')) return '#f59e0b'; // Gold
  if (app.toLowerCase().includes('code') || app.toLowerCase().includes('ide')) return '#2563eb'; // Blue
  if (app.toLowerCase().includes('timer')) return '#a855f7'; // Theme Purple
  if (app.toLowerCase() === 'none') return '#4b5563'; // Grey
  
  const color = colorPalette[colorIndex % colorPalette.length];
  appColorCache[app] = color;
  colorIndex++;
  return color;
}

// --- Event Listeners ---

// Timer buttons
btnTimerToggle.addEventListener('click', () => {
  if (isTimerRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
});

btnTimerReset.addEventListener('click', resetTimer);

// Screen Navigation
btnGoStats.addEventListener('click', () => showScreen(screenStats));
btnGoSettings.addEventListener('click', () => showScreen(screenSettings));
btnStatsBack.addEventListener('click', () => showScreen(screenTimer));
btnSettingsBack.addEventListener('click', () => showScreen(screenTimer));

// Clear stats records
btnClearStats.addEventListener('click', () => {
  if (confirm('すべての時間記録を消去しますか？')) {
    const success = ipcRenderer.sendSync('clear-records');
    if (success) {
      renderStats();
    }
  }
});

// Settings Event Handlers
modeStopwatch.addEventListener('click', () => {
  modeStopwatch.classList.add('active');
  modeCountdown.classList.remove('active');
  settingsCountdownGroup.classList.add('hidden');
  timerMode = 'stopwatch';
  timerModeBadge.textContent = 'STOPWATCH';
  resetTimer();
});

modeCountdown.addEventListener('click', () => {
  modeCountdown.classList.add('active');
  modeStopwatch.classList.remove('active');
  settingsCountdownGroup.classList.remove('hidden');
  timerMode = 'countdown';
  timerModeBadge.textContent = 'COUNTDOWN';
  resetTimer();
});

// Stepper controls
function setLimitFromInput() {
  let val = parseInt(inputLimitMinutes.value, 10);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 720) val = 720;
  inputLimitMinutes.value = val;
  countdownLimitSeconds = val * 60;
  if (timerMode === 'countdown') {
    timerSeconds = countdownLimitSeconds;
    updateTimerDisplay();
  }
}

inputLimitMinutes.addEventListener('change', setLimitFromInput);
btnStepUp.addEventListener('click', () => {
  inputLimitMinutes.value = parseInt(inputLimitMinutes.value, 10) + 5;
  setLimitFromInput();
});
btnStepDown.addEventListener('click', () => {
  const current = parseInt(inputLimitMinutes.value, 10);
  inputLimitMinutes.value = current > 5 ? current - 5 : 1;
  setLimitFromInput();
});

// Click-through Toggle
toggleClickthrough.addEventListener('change', (e) => {
  ipcRenderer.send('toggle-click-through', e.target.checked);
});

// IPC event to trigger clickthrough check toggle from main process shortcut
ipcRenderer.on('update-click-through-checkbox', (event, ignore) => {
  toggleClickthrough.checked = ignore;
});

// Window controls
btnMinimize.addEventListener('click', () => {
  const { remote } = require('electron'); // Optional, or IPC
  ipcRenderer.send('window-minimize');
});

btnClose.addEventListener('click', () => {
  ipcRenderer.send('window-close');
});

// Document level keyboard event listener to toggle clickthrough if focused
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key.toLowerCase() === 't') {
    const nextVal = !toggleClickthrough.checked;
    toggleClickthrough.checked = nextVal;
    ipcRenderer.send('toggle-click-through', nextVal);
  }
});

// Window Resize Scaling Logic
function handleResize() {
  const scaleFactor = window.innerWidth / 320;
  document.documentElement.style.setProperty('--scale-factor', scaleFactor);
}
window.addEventListener('resize', handleResize);
handleResize(); // Initial call

// Initial Setup
resetTimer();
