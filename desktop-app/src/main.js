let serverUrl = '';
let panelPassword = '';

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
    }
  } catch (e) {
    // Tauri not available (running in browser for dev)
  }
  showSetup();
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
      }
    })
    .catch(() => {
      showError('Cannot reach server. Check the URL and try again.');
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
    showError('Enter the server URL');
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
  } catch (e) {
    // Not in Tauri, just continue
  }

  showPanel();
}

function showError(msg) {
  document.getElementById('setup-error').textContent = msg;
}

window.addEventListener('DOMContentLoaded', init);
