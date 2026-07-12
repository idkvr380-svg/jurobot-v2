let serverUrl = '';
let panelPassword = '';

const TUNNEL_URL_REPO = 'https://raw.githubusercontent.com/idkvr380-svg/jurobot-v2/main/tunnel-url.txt';

async function init() {
  try {
    if (window.__TAURI_INTERNALS__) {
      const config = await window.__TAURI_INTERNALS__.invoke('get_config');
      if (config.server_url) {
        serverUrl = config.server_url;
        panelPassword = config.password;
        showPanel();
        return;
      }
      // If password saved but no URL, auto-detect
      if (config.password) {
        panelPassword = config.password;
        document.getElementById('pw').value = config.password;
        autoDetectUrl();
        return;
      }
    }
  } catch (e) {}
  showSetup();
}

async function autoDetectUrl() {
  const status = document.getElementById('setup-error');
  const btn = document.getElementById('detect-btn');
  status.className = '';
  status.textContent = 'Fetching tunnel URL from GitHub...';
  btn.disabled = true;

  try {
    const res = await fetch(TUNNEL_URL_REPO + '?_=' + Date.now());
    if (!res.ok) throw new Error('Not found');
    const url = (await res.text()).trim();
    if (url && url.startsWith('https://')) {
      document.getElementById('url').value = url;
      status.className = '';
      status.textContent = 'URL detected! Click CONNECT.';
      btn.disabled = false;
    } else {
      throw new Error('Invalid URL');
    }
  } catch (e) {
    status.className = '';
    status.textContent = 'Could not detect URL. Is the bot running?';
    btn.disabled = false;
  }
}

function showSetup() {
  document.getElementById('setup').classList.remove('hidden');
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('panel').classList.add('hidden');
  if (serverUrl) document.getElementById('url').value = serverUrl;
  if (panelPassword) document.getElementById('pw').value = panelPassword;
}

function showPanel() {
  document.getElementById('setup').classList.add('hidden');
  document.getElementById('loading').classList.remove('hidden');

  const url = serverUrl.replace(/\/$/, '');
  const testUrl = url + '/api/health';

  fetch(testUrl)
    .then(r => r.json())
    .then(data => {
      if (data.active) {
        loadFrame(url);
      } else {
        showError('Bot is not online. Is it running on GitHub Actions?');
        showSetup();
      }
    })
    .catch(() => {
      showError('Cannot reach server. Check the URL and try again.');
      showSetup();
    });
}

function loadFrame(url) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('panel').classList.remove('hidden');
  document.getElementById('panel').style.display = 'flex';
  document.getElementById('panel').style.flexDirection = 'column';
  document.getElementById('panel').style.height = '100vh';

  showTab('control');
}

function showTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[onclick="showTab('${tab}')"]`).classList.add('active');

  const frame = document.getElementById('frame');
  const url = serverUrl.replace(/\/$/, '');

  switch (tab) {
    case 'control':
      frame.src = url + '/client';
      break;
    case 'status':
      frame.src = url + '/panel';
      break;
    case 'logs':
      frame.src = url + '/logs?format=html';
      break;
  }
}

async function connect() {
  const urlInput = document.getElementById('url').value.trim();
  const pwInput = document.getElementById('pw').value.trim();

  if (!urlInput) {
    showError('Enter the server URL or click Detect');
    return;
  }
  if (!pwInput) {
    showError('Enter the panel password');
    return;
  }

  serverUrl = urlInput;
  panelPassword = pwInput;

  try {
    if (window.__TAURI_INTERNALS__) {
      await window.__TAURI_INTERNALS__.invoke('set_config', {
        serverUrl: serverUrl,
        password: panelPassword
      });
    }
  } catch (e) {}

  showPanel();
}

function showError(msg) {
  document.getElementById('setup-error').textContent = msg;
}

window.addEventListener('DOMContentLoaded', init);
