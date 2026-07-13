let serverUrl = '';
let panelPassword = '';
let githubToken = '';
let statusPollInterval = null;

async function invoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args || {});
}

async function init() {
  try {
    if (window.__TAURI_INTERNALS__) {
      const config = await invoke('get_config');
      if (config.password) panelPassword = config.password;
      if (config.github_token) githubToken = config.github_token;
      if (config.password) {
        document.getElementById('pw').value = config.password;
        if (config.github_token) document.getElementById('gh-token').value = config.github_token;
        showPanel();
        return;
      }
    }
  } catch (e) {}
  showSetup();
}

async function detectTunnelUrl() {
  try {
    const url = await invoke('get_tunnel_url');
    if (url && url.startsWith('https://')) {
      serverUrl = url;
      return true;
    }
  } catch (e) {
    console.log('detectTunnelUrl error:', e);
  }
  serverUrl = '';
  return false;
}

function showSetup() {
  clearInterval(statusPollInterval);
  document.getElementById('setup').classList.remove('hidden');
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('panel').classList.add('hidden');
  if (panelPassword) document.getElementById('pw').value = panelPassword;
  if (githubToken) document.getElementById('gh-token').value = githubToken;
}

function showPanel() {
  document.getElementById('setup').classList.add('hidden');
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('panel').classList.remove('hidden');
  document.getElementById('panel').style.display = 'flex';
  document.getElementById('panel').style.flexDirection = 'column';
  document.getElementById('panel').style.height = '100vh';
  showTab('control');
  if (githubToken) {
    refreshBotStatus();
    statusPollInterval = setInterval(refreshBotStatus, 30000);
  }
  setInterval(async () => {
    if (!serverUrl) await detectTunnelUrl();
  }, 15000);
}

async function showTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (activeTab) activeTab.classList.add('active');
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('tab-' + tab);
  if (page) page.classList.add('active');

  if (tab === 'bot') {
    refreshBotStatus();
    return;
  }

  if (!serverUrl) {
    await detectTunnelUrl();
  }

  if (!serverUrl) {
    const frame = document.getElementById('frame-' + tab);
    if (frame) frame.srcdoc = '<div style="display:flex;justify-content:center;align-items:center;height:100%;background:#111;color:#888;font-family:monospace;font-size:16px;">Bot not running. Start it from the Bot tab.</div>';
    return;
  }

  const url = serverUrl.replace(/\/$/, '');
  if (tab === 'control') {
    document.getElementById('frame-control').src = url + '/client';
  } else if (tab === 'status') {
    document.getElementById('frame-status').src = url + '/panel';
  } else if (tab === 'logs') {
    document.getElementById('frame-logs').src = url + '/logs?format=html';
  }
}

async function connect() {
  const pwInput = document.getElementById('pw').value.trim();
  const ghInput = document.getElementById('gh-token').value.trim();

  if (!pwInput) { showError('Enter the panel password'); return; }

  panelPassword = pwInput;
  githubToken = ghInput;

  const btn = document.getElementById('connect-btn');
  const error = document.getElementById('setup-error');
  btn.disabled = true;
  btn.textContent = 'CONNECTING...';
  error.textContent = '';

  try {
    if (window.__TAURI_INTERNALS__) {
      await invoke('set_config', {
        password: panelPassword,
        githubToken: githubToken,
      });
    }
  } catch (e) {
    error.textContent = 'Config save failed: ' + e;
    btn.disabled = false;
    btn.textContent = 'CONNECT';
    return;
  }

  error.textContent = 'Detecting bot...';
  await detectTunnelUrl();
  btn.disabled = false;
  btn.textContent = 'CONNECT';
  showPanel();
}

async function refreshBotStatus() {
  if (!githubToken) {
    document.getElementById('bot-state').textContent = 'GitHub token not set';
    return;
  }

  try {
    const status = await invoke('get_bot_status');

    const botState = document.getElementById('bot-state');
    if (status.online) {
      botState.textContent = 'ONLINE';
      botState.className = 'status-value online';
    } else {
      botState.textContent = 'OFFLINE';
      botState.className = 'status-value offline';
    }

    const workflowState = document.getElementById('workflow-state');
    if (status.run_status) {
      workflowState.textContent = status.run_status;
      workflowState.className = 'status-value ' + status.run_status;
    } else {
      workflowState.textContent = 'No runs';
      workflowState.className = 'status-value';
    }

    const runInfo = document.getElementById('run-info');
    if (status.run_url) {
      runInfo.innerHTML = '<a href="' + status.run_url + '" target="_blank" style="color:#4fc3f7;text-decoration:none;">View Run</a>';
      if (status.run_conclusion) {
        runInfo.innerHTML += ' (' + status.run_conclusion + ')';
      }
    } else {
      runInfo.textContent = '-';
    }
  } catch (e) {
    document.getElementById('bot-state').textContent = 'Error: ' + e;
    document.getElementById('bot-state').className = 'status-value offline';
  }
}

async function startBot() {
  const btn = document.getElementById('btn-start');
  const status = document.getElementById('bot-action-status');
  btn.disabled = true;
  status.className = 'action-status';
  status.textContent = 'Starting bot...';

  try {
    const msg = await invoke('start_bot');
    status.className = 'action-status success';
    status.textContent = msg;
    setTimeout(async () => {
      await detectTunnelUrl();
      refreshBotStatus();
    }, 5000);
  } catch (e) {
    status.className = 'action-status error';
    status.textContent = 'Error: ' + e;
  }
  btn.disabled = false;
}

async function stopBot() {
  const btn = document.getElementById('btn-stop');
  const status = document.getElementById('bot-action-status');
  btn.disabled = true;
  status.className = 'action-status';
  status.textContent = 'Stopping bot...';

  try {
    const msg = await invoke('stop_bot');
    status.className = 'action-status success';
    status.textContent = msg;
    setTimeout(refreshBotStatus, 5000);
  } catch (e) {
    status.className = 'action-status error';
    status.textContent = 'Error: ' + e;
  }
  btn.disabled = false;
}

async function restartBot() {
  const btn = document.getElementById('btn-restart');
  const status = document.getElementById('bot-action-status');
  btn.disabled = true;
  status.className = 'action-status';
  status.textContent = 'Restarting bot...';

  try {
    await invoke('stop_bot');
    status.textContent = 'Stopped. Starting...';
    setTimeout(async () => {
      try {
        const msg = await invoke('start_bot');
        status.className = 'action-status success';
        status.textContent = 'Restarted! ' + msg;
        setTimeout(refreshBotStatus, 5000);
      } catch (e) {
        status.className = 'action-status error';
        status.textContent = 'Stop OK but start failed: ' + e;
      }
      btn.disabled = false;
    }, 3000);
  } catch (e) {
    status.className = 'action-status error';
    status.textContent = 'Error: ' + e;
    btn.disabled = false;
  }
}

function showError(msg) {
  document.getElementById('setup-error').textContent = msg;
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('connect-btn').addEventListener('click', connect);
  document.getElementById('btn-start').addEventListener('click', startBot);
  document.getElementById('btn-stop').addEventListener('click', stopBot);
  document.getElementById('btn-restart').addEventListener('click', restartBot);
  document.querySelectorAll('.tab[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  });
  const settingsBtn = document.querySelector('.settings-btn');
  if (settingsBtn) settingsBtn.addEventListener('click', showSetup);
  const refreshBtn = document.querySelector('.refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshBotStatus);
  init();
});
