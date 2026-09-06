import { $, $$ } from '../utils.js';
import { t } from '../i18n.js';
import { saveConfig, getConfig, isConfigured, testConnection, inferProvider, MODEL_PRESETS, IMAGE_PRESETS, VIDEO_PRESETS, REF_VIDEO_PRESETS, PROVIDER_DEFAULTS } from '../providers/llm.js';
import { saveConfig as saveDashScopeConfig } from '../providers/image.js';
import { setActiveProvider } from '../providers/registry.js';

const PROVIDER_LIST = ['openai', 'deepseek', 'dashscope', 'ark', 'kling', 'gemini'];
const CUSTOM_VALUE = '__custom__';
const COMFY_MODEL = '__comfyui__';

function updateIndicator() {
  const dot = $('#llmDot');
  if (dot) dot.classList.toggle('active', isConfigured());
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

function populateModelSelect(selectEl, presets, currentProvider, currentName, includeComfy = false) {
  selectEl.innerHTML = '';

  if (presets === MODEL_PRESETS) {
    for (const [provider, models] of Object.entries(MODEL_PRESETS)) {
      const group = document.createElement('optgroup');
      group.label = provider.charAt(0).toUpperCase() + provider.slice(1);
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = `${provider}:${m}`;
        opt.textContent = m;
        if (provider === currentProvider && m === currentName) opt.selected = true;
        group.appendChild(opt);
      }
      selectEl.appendChild(group);
    }
  } else {
    for (const m of presets) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      if (m === currentName) opt.selected = true;
      selectEl.appendChild(opt);
    }

    if (includeComfy) {
      const comfyOpt = document.createElement('option');
      comfyOpt.value = COMFY_MODEL;
      comfyOpt.textContent = 'ComfyUI (DGX Spark / H3)';
      if (currentName === COMFY_MODEL) comfyOpt.selected = true;
      selectEl.appendChild(comfyOpt);
    }
  }

  const customOpt = document.createElement('option');
  customOpt.value = CUSTOM_VALUE;
  customOpt.textContent = t('settings.customModel');
  selectEl.appendChild(customOpt);

  const isCustom = presets === MODEL_PRESETS
    ? !Object.values(MODEL_PRESETS).some(list => list.includes(currentName))
    : (currentName !== COMFY_MODEL && !presets.includes(currentName));

  if (isCustom && currentName) {
    customOpt.selected = true;
  }

  return isCustom && currentName;
}

function getSelectValue(selectEl, customInputEl) {
  if (selectEl.value === CUSTOM_VALUE) {
    return customInputEl?.value?.trim() || '';
  }
  return selectEl.value;
}

function openModal() {
  const modal = $('#settingsModal');
  if (!modal) return;
  const cfg = getConfig();

  for (const p of PROVIDER_LIST) {
    const endpointEl = modal.querySelector(`.api-endpoint[data-p="${p}"]`);
    const keyEl = modal.querySelector(`.api-key[data-p="${p}"]`);
    if (endpointEl) endpointEl.value = cfg.apiProviders[p]?.endpoint || PROVIDER_DEFAULTS[p]?.endpoint || '';
    if (keyEl) keyEl.value = cfg.apiProviders[p]?.apiKey || '';
  }

  const textModel = cfg.models.text;
  const textSelect = $('#cfgTextModel');
  const textCustomWrap = $('#textModelCustomWrap');
  const textCustomInput = $('#cfgTextModelCustom');
  const isTextCustom = populateModelSelect(textSelect, MODEL_PRESETS, textModel.provider, textModel.name);
  if (isTextCustom) {
    textCustomWrap?.classList.remove('hidden');
    if (textCustomInput) textCustomInput.value = textModel.name;
  } else {
    textCustomWrap?.classList.add('hidden');
  }

  const imageSelect = $('#cfgImageModel');
  const imageCustomWrap = $('#imageModelCustomWrap');
  const imageCustomInput = $('#cfgImageModelCustom');
  const isImageCustom = populateModelSelect(imageSelect, IMAGE_PRESETS, null, cfg.models.image.name);
  if (isImageCustom) {
    imageCustomWrap?.classList.remove('hidden');
    if (imageCustomInput) imageCustomInput.value = cfg.models.image.name;
  } else {
    imageCustomWrap?.classList.add('hidden');
  }

  let comfyActive = false;
  try {
    const prefs = JSON.parse(localStorage.getItem('cine-cutie-providers') || '{}');
    comfyActive = cfg.models.video.name === COMFY_MODEL
      || cfg.models.refVideo.name === COMFY_MODEL
      || prefs.video === 'video-comfy';
  } catch {
    comfyActive = cfg.models.video.name === COMFY_MODEL || cfg.models.refVideo.name === COMFY_MODEL;
  }

  const videoSelect = $('#cfgVideoModel');
  const videoCustomWrap = $('#videoModelCustomWrap');
  const videoCustomInput = $('#cfgVideoModelCustom');
  const isVideoCustom = populateModelSelect(
    videoSelect, VIDEO_PRESETS, null,
    comfyActive ? COMFY_MODEL : cfg.models.video.name, true,
  );
  if (isVideoCustom) {
    videoCustomWrap?.classList.remove('hidden');
    if (videoCustomInput) videoCustomInput.value = cfg.models.video.name;
  } else {
    videoCustomWrap?.classList.add('hidden');
  }

  const refVideoSelect = $('#cfgRefVideoModel');
  const refVideoCustomWrap = $('#refVideoModelCustomWrap');
  const refVideoCustomInput = $('#cfgRefVideoModelCustom');
  const isRefVideoCustom = populateModelSelect(
    refVideoSelect, REF_VIDEO_PRESETS, null,
    comfyActive ? COMFY_MODEL : cfg.models.refVideo.name, true,
  );
  if (isRefVideoCustom) {
    refVideoCustomWrap?.classList.remove('hidden');
    if (refVideoCustomInput) refVideoCustomInput.value = cfg.models.refVideo.name;
  } else {
    refVideoCustomWrap?.classList.add('hidden');
  }

  $('#cfgJsonMode').checked = cfg.jsonMode !== false;
  $('#cfgProxy').checked = cfg.useProxy === true;

  const comfyCfg = loadComfySshConfig();
  $('#comfySshHost').value = comfyCfg.host || '';
  $('#comfySshPort').value = comfyCfg.port || '';
  $('#comfySshUser').value = comfyCfg.user || '';
  $('#comfySshComfyPort').value = comfyCfg.comfyPort || '';
  $('#comfyEnableLightning').checked = comfyCfg.enableLightning || false;

  clearStatus();
  modal.classList.remove('hidden');
}

function closeModal() {
  const modal = $('#settingsModal');
  if (modal) modal.classList.add('hidden');
}

function handleSave() {
  const apiProviders = {};
  for (const p of PROVIDER_LIST) {
    const endpointEl = $(`.api-endpoint[data-p="${p}"]`);
    const keyEl = $(`.api-key[data-p="${p}"]`);
    apiProviders[p] = {
      endpoint: endpointEl?.value?.trim() || PROVIDER_DEFAULTS[p]?.endpoint || '',
      apiKey: keyEl?.value?.trim() || '',
    };
  }

  const textSelect = $('#cfgTextModel');
  const textCustomInput = $('#cfgTextModelCustom');
  let textModel;
  if (textSelect.value === CUSTOM_VALUE) {
    const name = textCustomInput?.value?.trim();
    if (!name) {
      showStatus(t('settings.model') + ' required', false);
      return;
    }
    textModel = { provider: inferProvider(name) || 'dashscope', name };
  } else {
    const [provider, name] = textSelect.value.split(':');
    textModel = { provider, name };
  }

  const imageSelect = $('#cfgImageModel');
  const imageCustomInput = $('#cfgImageModelCustom');
  const imageName = getSelectValue(imageSelect, imageCustomInput);

  const videoSelect = $('#cfgVideoModel');
  const videoCustomInput = $('#cfgVideoModelCustom');
  const videoName = getSelectValue(videoSelect, videoCustomInput);

  const refVideoSelect = $('#cfgRefVideoModel');
  const refVideoCustomInput = $('#cfgRefVideoModelCustom');
  const refVideoName = getSelectValue(refVideoSelect, refVideoCustomInput);

  if (!textModel.name) {
    showStatus(t('settings.model') + ' required', false);
    return;
  }

  const jsonMode = $('#cfgJsonMode').checked;
  const useProxy = $('#cfgProxy').checked;

  const comfyChosen = videoName === COMFY_MODEL || refVideoName === COMFY_MODEL;
  const realVideoModel = (!videoName || videoName === COMFY_MODEL) ? 'wanx2.1-i2v-plus' : videoName;
  const realRefVideoModel = (!refVideoName || refVideoName === COMFY_MODEL) ? 'wan2.7-r2v' : refVideoName;

  saveConfig({
    apiProviders,
    models: {
      text: textModel,
      image: { name: imageName || 'wanx2.1-t2i-turbo' },
      video: { name: videoName || 'wanx2.1-i2v-plus' },
      refVideo: { name: refVideoName || 'wan2.7-r2v' },
    },
    jsonMode,
    useProxy,
  });

  saveDashScopeConfig({
    apiKey: apiProviders.dashscope?.apiKey || '',
    imageModel: imageName || 'wanx2.1-t2i-turbo',
    videoModel: realVideoModel,
    refVideoModel: realRefVideoModel,
  });

  saveComfySshConfig();

  setActiveProvider('video', comfyChosen ? 'video-comfy' : 'video');

  updateIndicator();
  showStatus(t('settings.saved'), true);
  setTimeout(closeModal, 1200);
}

async function handleTest() {
  const textSelect = $('#cfgTextModel');
  const textCustomInput = $('#cfgTextModelCustom');
  let textModelName;
  let textProvider;

  if (textSelect.value === CUSTOM_VALUE) {
    textModelName = textCustomInput?.value?.trim();
    if (!textModelName) {
      showStatus(t('settings.model') + ' required', false);
      return;
    }
    textProvider = inferProvider(textModelName) || 'dashscope';
  } else {
    [textProvider, textModelName] = textSelect.value.split(':');
  }

  const keyEl = $(`.api-key[data-p="${textProvider}"]`);
  const endpointEl = $(`.api-endpoint[data-p="${textProvider}"]`);
  const apiKey = keyEl?.value?.trim();
  const endpoint = endpointEl?.value?.trim();

  if (!apiKey) {
    showStatus(`${textProvider} ` + t('settings.apiKey') + ' required', false);
    return;
  }
  if (!textModelName) {
    showStatus(t('settings.model') + ' required', false);
    return;
  }

  saveConfig({
    apiProviders: {
      [textProvider]: { endpoint: endpoint || PROVIDER_DEFAULTS[textProvider]?.endpoint, apiKey },
    },
    models: { text: { provider: textProvider, name: textModelName } },
    jsonMode: $('#cfgJsonMode').checked,
  });

  const btn = $('#testConnBtn');
  const textEl = $('#testConnText');
  btn.disabled = true;
  textEl.textContent = t('settings.testing');
  clearStatus();

  const result = await testConnection();

  const videoName = getSelectValue($('#cfgVideoModel'), $('#cfgVideoModelCustom'));
  const refVideoName = getSelectValue($('#cfgRefVideoModel'), $('#cfgRefVideoModelCustom'));
  const comfyChosen = videoName === COMFY_MODEL || refVideoName === COMFY_MODEL;

  let comfyLine = null;
  if (comfyChosen) {
    const config = saveComfySshConfig();
    if (!config.host) {
      comfyLine = { ok: false, msg: 'ComfyUI: Host required' };
    } else {
      try {
        const res = await fetch('/api/comfyui/status', {
          headers: { 'X-Ssh-Config': JSON.stringify(config) },
        });
        const data = await res.json();
        if (data.comfyui?.online) {
          const gpuInfo = data.comfyui.gpu?.map(g => `${g.name} (${g.vram_free}/${g.vram_total}MB)`).join(', ') || 'OK';
          comfyLine = { ok: true, msg: `ComfyUI: Connected (GPU ${gpuInfo})` };
        } else {
          comfyLine = { ok: false, msg: `ComfyUI: offline (${data.comfyui?.error || 'unknown'})` };
        }
      } catch (err) {
        comfyLine = { ok: false, msg: `ComfyUI: ${err.message}` };
      }
    }
  }

  btn.disabled = false;
  textEl.textContent = t('settings.test');

  let ok = result.ok;
  const parts = [`LLM: ${result.ok ? t('settings.testOk') : result.error}`];
  if (comfyLine) {
    ok = ok && comfyLine.ok;
    parts.push(comfyLine.msg);
  }
  showStatus(parts.join(' · '), ok);
}

function setupModelSelectChange(selectId, customWrapId, presets) {
  const select = $(selectId);
  const wrap = $(customWrapId);
  if (!select || !wrap) return;

  select.addEventListener('change', () => {
    if (select.value === CUSTOM_VALUE) {
      wrap.classList.remove('hidden');
    } else {
      wrap.classList.add('hidden');
    }
  });
}

function loadComfySshConfig() {
  try {
    const saved = localStorage.getItem('cine-cutie-comfy-ssh');
    if (saved) return JSON.parse(saved);
  } catch {}
  return {};
}

function saveComfySshConfig() {
  const config = {
    host: $('#comfySshHost')?.value?.trim() || '',
    port: parseInt($('#comfySshPort')?.value) || 6078,
    user: $('#comfySshUser')?.value?.trim() || 'Developer',
    comfyPort: parseInt($('#comfySshComfyPort')?.value) || 8188,
    enableLightning: $('#comfyEnableLightning')?.checked || false,
  };
  localStorage.setItem('cine-cutie-comfy-ssh', JSON.stringify(config));
  return config;
}

function linkVideoSelects() {
  const pairs = [
    { select: $('#cfgVideoModel'), wrap: $('#videoModelCustomWrap'), presets: VIDEO_PRESETS },
    { select: $('#cfgRefVideoModel'), wrap: $('#refVideoModelCustomWrap'), presets: REF_VIDEO_PRESETS },
  ];

  const resetToDefault = (entry) => {
    entry.select.value = entry.presets[0];
    entry.wrap?.classList.add('hidden');
  };

  const setToComfy = (entry) => {
    entry.select.value = COMFY_MODEL;
    entry.wrap?.classList.add('hidden');
  };

  pairs.forEach((entry, i) => {
    const other = pairs[1 - i];
    if (!entry.select) return;
    entry.select.addEventListener('change', () => {
      const val = entry.select.value;
      if (val === COMFY_MODEL) {
        setToComfy(other);
      } else if (val !== CUSTOM_VALUE && other.select.value === COMFY_MODEL) {
        resetToDefault(other);
      }
    });
  });
}

export function initSettings() {
  const settingsBtn = $('#settingsBtn');
  const settingsClose = $('#settingsClose');
  const modal = $('#settingsModal');

  if (settingsBtn) settingsBtn.addEventListener('click', openModal);
  if (settingsClose) settingsClose.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  modal?.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-vis-btn');
    if (!btn) return;
    const target = btn.dataset.target;
    if (!target) return;
    const input = modal.querySelector(`.api-key[data-p="${target}"]`);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  setupModelSelectChange('#cfgTextModel', '#textModelCustomWrap', MODEL_PRESETS);
  setupModelSelectChange('#cfgImageModel', '#imageModelCustomWrap', IMAGE_PRESETS);
  setupModelSelectChange('#cfgVideoModel', '#videoModelCustomWrap', VIDEO_PRESETS);
  setupModelSelectChange('#cfgRefVideoModel', '#refVideoModelCustomWrap', REF_VIDEO_PRESETS);

  const saveBtn = $('#saveSettingsBtn');
  if (saveBtn) saveBtn.addEventListener('click', handleSave);

  const testBtn = $('#testConnBtn');
  if (testBtn) testBtn.addEventListener('click', handleTest);

  linkVideoSelects();

  updateIndicator();
}
