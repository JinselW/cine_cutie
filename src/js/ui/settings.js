import { $ } from '../utils.js';
import { t } from '../i18n.js';
import { saveConfig, getConfig, isConfigured, testConnection } from '../providers/llm.js';
import { saveConfig as saveDashScopeConfig, getConfig as getDashScopeConfig, isConfigured as isDashScopeConfigured } from '../providers/image.js';

function updateIndicator() {
  const dot = $('#llmDot');
  if (dot) dot.classList.toggle('active', isConfigured() || isDashScopeConfigured());
}

function showStatus(msg, ok) {
  const el = $('#settingsStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'settings-status ' + (ok ? 'ok' : 'err');
}

function clearStatus() {
  const el = $('#settingsStatus');
  if (!el) return;
  el.textContent = '';
  el.className = 'settings-status';
}

function openModal() {
  const modal = $('#settingsModal');
  if (!modal) return;
  const cfg = getConfig();
  $('#cfgEndpoint').value = cfg.endpoint || '';
  $('#cfgApiKey').value = cfg.apiKey || '';
  $('#cfgModel').value = cfg.model || '';
  $('#cfgJsonMode').checked = cfg.jsonMode !== false;
  $('#cfgProxy').checked = cfg.useProxy === true;

  const dsCfg = getDashScopeConfig();
  const dsKeyInput = $('#cfgDashScopeKey');
  if (dsKeyInput) dsKeyInput.value = dsCfg.apiKey || '';
  const dsImgInput = $('#cfgImageModel');
  if (dsImgInput) dsImgInput.value = dsCfg.imageModel || 'wanx2.1-t2i-turbo';
  const dsVidInput = $('#cfgVideoModel');
  if (dsVidInput) dsVidInput.value = dsCfg.videoModel || 'wanx2.1-i2v-turbo';

  clearStatus();
  modal.classList.remove('hidden');
}

function closeModal() {
  const modal = $('#settingsModal');
  if (modal) modal.classList.add('hidden');
}

function handleSave() {
  const endpoint = $('#cfgEndpoint').value.trim();
  const apiKey = $('#cfgApiKey').value.trim();
  const model = $('#cfgModel').value.trim();
  const jsonMode = $('#cfgJsonMode').checked;
  const useProxy = $('#cfgProxy').checked;

  if (!apiKey && !model) {
    saveConfig({ endpoint: '', apiKey: '', model: '', jsonMode, useProxy });
    const dsKeyEl = $('#cfgDashScopeKey');
    if (dsKeyEl) {
      saveDashScopeConfig({
        apiKey: dsKeyEl.value.trim(),
        imageModel: ($('#cfgImageModel')?.value.trim() || 'wanx2.1-t2i-turbo'),
        videoModel: ($('#cfgVideoModel')?.value.trim() || 'wanx2.1-i2v-turbo')
      });
    }
    closeModal();
    updateIndicator();
    return;
  }

  if (model && /t2v|i2v|video/i.test(model)) {
    showStatus('⚠️ 模型名称看起来像视频模型，这里应填文本模型（如 qwen-plus）', false);
    return;
  }

  if (!apiKey || !model) {
    showStatus(t('settings.endpoint') + ' & ' + t('settings.model') + ' required', false);
    return;
  }

  saveConfig({ endpoint: endpoint || 'https://api.openai.com/v1', apiKey, model, jsonMode, useProxy });

  const dsKeyEl = $('#cfgDashScopeKey');
  if (dsKeyEl) {
    saveDashScopeConfig({
      apiKey: dsKeyEl.value.trim(),
      imageModel: ($('#cfgImageModel')?.value.trim() || 'wanx2.1-t2i-turbo'),
      videoModel: ($('#cfgVideoModel')?.value.trim() || 'wanx2.1-i2v-turbo')
    });
  }

  updateIndicator();
  showStatus(t('settings.saved'), true);
  setTimeout(closeModal, 1200);
}

async function handleTest() {
  const apiKey = $('#cfgApiKey').value.trim();
  const model = $('#cfgModel').value.trim();
  const endpoint = $('#cfgEndpoint').value.trim();

  if (model && /t2v|i2v|video/i.test(model)) {
    showStatus('⚠️ 模型名称看起来像视频模型，这里应填文本模型（如 qwen-plus）', false);
    return;
  }

  if (!apiKey || !model) {
    showStatus(t('settings.apiKey') + ' & ' + t('settings.model') + ' required', false);
    return;
  }

  saveConfig({ endpoint: endpoint || 'https://api.openai.com/v1', apiKey, model, jsonMode: $('#cfgJsonMode').checked });

  const btn = $('#testConnBtn');
  const textEl = $('#testConnText');
  btn.disabled = true;
  textEl.textContent = t('settings.testing');
  clearStatus();

  const result = await testConnection();

  btn.disabled = false;
  textEl.textContent = t('settings.test');

  if (result.ok) {
    showStatus(t('settings.testOk'), true);
  } else {
    showStatus(result.error, false);
  }
}

export function initSettings() {
  const settingsBtn = $('#settingsBtn');
  const settingsClose = $('#settingsClose');
  const modal = $('#settingsModal');
  const toggleKeyVis = $('#toggleKeyVis');

  if (settingsBtn) settingsBtn.addEventListener('click', openModal);
  if (settingsClose) settingsClose.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  if (toggleKeyVis) {
    toggleKeyVis.addEventListener('click', () => {
      const input = $('#cfgApiKey');
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }

  const saveBtn = $('#saveSettingsBtn');
  if (saveBtn) saveBtn.addEventListener('click', handleSave);

  const testBtn = $('#testConnBtn');
  if (testBtn) testBtn.addEventListener('click', handleTest);

  updateIndicator();
}
