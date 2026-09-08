import { $, $$ } from '../utils.js';
import { t } from '../i18n.js';
import { saveConfig, getConfig, isConfigured, testConnection, inferProvider, MODEL_PRESETS, IMAGE_PRESETS, IMG2IMG_PRESETS, VIDEO_MODES, videoModeById, PROVIDER_DEFAULTS } from '../providers/llm.js';
import { saveConfig as saveDashScopeConfig } from '../providers/image.js';
import { setActiveProvider } from '../providers/registry.js';

const PROVIDER_LIST = ['openai', 'deepseek', 'dashscope', 'ark', 'kling', 'gemini'];
const CUSTOM_VALUE = '__custom__';
const COMFY_MODEL = '__comfyui__';

let bgmPath = '';
let bgmName = '';

function renderBgmFileUi() {
  const nameEl = $('#bgmFileName');
  if (nameEl) {
    nameEl.textContent = bgmName || (bgmPath ? bgmPath.split('/').pop() : t('settings.bgm.none'));
    nameEl.classList.toggle('dim', !bgmName && !bgmPath);
  }
  const clearBtn = $('#bgmClearBtn');
  if (clearBtn) clearBtn.disabled = !bgmPath;
}

// Three side-by-side video model dropdowns, one per generation mode.
const MODEL_SLOTS = [
  { modeId: 'firstFrame', configKey: 'video', dashKey: 'videoModel', selId: '#cfgVideoModelFirstFrame', wrapId: '#videoModelFirstFrameCustomWrap', customId: '#cfgVideoModelFirstFrameCustom', labelId: '#lblVideoModelFirstFrame' },
  { modeId: 'firstLastFrame', configKey: 'lastFrameVideo', dashKey: 'lastFrameVideoModel', selId: '#cfgVideoModelFirstLastFrame', wrapId: '#videoModelFirstLastFrameCustomWrap', customId: '#cfgVideoModelFirstLastFrameCustom', labelId: '#lblVideoModelFirstLastFrame' },
  { modeId: 'referenceImage', configKey: 'refVideo', dashKey: 'refVideoModel', selId: '#cfgVideoModelRefImage', wrapId: '#videoModelRefImageCustomWrap', customId: '#cfgVideoModelRefImageCustom', labelId: '#lblVideoModelRefImage' },
];

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
      comfyOpt.textContent = t('settings.comfyUIOption');
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

function applyComfyUiState(on) {
  const block = $('#comfySettingsBlock');
  if (block) block.classList.toggle('hidden', !on);

  const cfg = getConfig();
  for (const slot of MODEL_SLOTS) {
    const select = $(slot.selId);
    const wrap = $(slot.wrapId);
    const input = $(slot.customId);
    if (!select) continue;

    if (on) {
      select.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = COMFY_MODEL;
      opt.textContent = t('settings.comfyUIOption');
      opt.selected = true;
      select.appendChild(opt);
      select.disabled = true;
      wrap?.classList.add('hidden');
    } else {
      select.disabled = false;
      const mode = videoModeById(slot.modeId);
      let name = cfg.models?.[slot.configKey]?.name || mode.defaultModel;
      if (name === COMFY_MODEL) name = mode.defaultModel;
      const isCustom = populateModelSelect(select, mode.presets, null, name);
      if (isCustom) {
        wrap?.classList.remove('hidden');
        if (input) input.value = name;
      } else {
        wrap?.classList.add('hidden');
      }
    }
  }

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

  const img2imgSelect = $('#cfgImg2ImgModel');
  const img2imgCustomWrap = $('#img2imgModelCustomWrap');
  const img2imgCustomInput = $('#cfgImg2ImgModelCustom');
  const img2imgName = cfg.models.img2img?.name || IMG2IMG_PRESETS[0];
  const isImg2ImgCustom = populateModelSelect(img2imgSelect, IMG2IMG_PRESETS, null, img2imgName);
  if (isImg2ImgCustom) {
    img2imgCustomWrap?.classList.remove('hidden');
    if (img2imgCustomInput) img2imgCustomInput.value = img2imgName;
  } else {
    img2imgCustomWrap?.classList.add('hidden');
  }

  let comfyActive = false;
  try {
    const prefs = JSON.parse(localStorage.getItem('cine-cutie-providers') || '{}');
    comfyActive = cfg.models.video?.name === COMFY_MODEL
      || cfg.models.refVideo?.name === COMFY_MODEL
      || prefs.video === 'video-comfy';
  } catch {
    comfyActive = cfg.models.video?.name === COMFY_MODEL || cfg.models.refVideo?.name === COMFY_MODEL;
  }

  const modeSelect = $('#cfgVideoMode');
  if (modeSelect) {
    modeSelect.innerHTML = '';
    for (const m of VIDEO_MODES) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = t('settings.videoMode.' + m.id);
      modeSelect.appendChild(opt);
    }
    modeSelect.value = videoModeById(cfg.videoMode).id;
  }

  $('#cfgJsonMode').checked = cfg.jsonMode !== false;
  $('#cfgProxy').checked = cfg.useProxy === true;

  const bgmCfg = cfg.bgm || {};
  bgmPath = bgmCfg.path || '';
  bgmName = bgmCfg.name || '';
  const bgmEnable = $('#cfgBgmEnabled');
  if (bgmEnable) bgmEnable.checked = !!bgmCfg.enabled;
  const bgmVol = $('#cfgBgmVolume');
  const vol = Number(bgmCfg.volume);
  const volPct = Number.isFinite(vol) ? Math.round(vol * 100) : 60;
  if (bgmVol) bgmVol.value = volPct;
  const volVal = $('#bgmVolumeVal');
  if (volVal) volVal.textContent = volPct + '%';
  renderBgmFileUi();

  const comfyCfg = loadComfySshConfig();
  $('#comfySshHost').value = comfyCfg.host || '';
  $('#comfySshPort').value = comfyCfg.port || '';
  $('#comfySshUser').value = comfyCfg.user || '';
  $('#comfySshComfyPort').value = comfyCfg.comfyPort || '';
  $('#comfyEnableLightning').checked = comfyCfg.enableLightning || false;

  const useComfyToggle = $('#cfgUseComfyVideo');
  if (useComfyToggle) useComfyToggle.checked = comfyActive;
  applyComfyUiState(comfyActive);

  clearStatus();
  activateSettingsTab('api');
  modal.classList.remove('hidden');
}

function activateSettingsTab(tabId) {
  const modal = $('#settingsModal');
  if (!modal) return;
  modal.querySelectorAll('[data-settings-tab]').forEach((button) => {
    const active = button.dataset.settingsTab === tabId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  modal.querySelectorAll('[data-settings-panel]').forEach((panel) => {
    const active = panel.dataset.settingsPanel === tabId;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
    if (active) panel.scrollTop = 0;
  });
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
      showStatus(t('settings.required', { field: t('settings.model') }), false);
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

  const img2imgSelect = $('#cfgImg2ImgModel');
  const img2imgCustomInput = $('#cfgImg2ImgModelCustom');
  const img2imgName = getSelectValue(img2imgSelect, img2imgCustomInput);

  const mode = videoModeById($('#cfgVideoMode')?.value);
  const useComfy = $('#cfgUseComfyVideo')?.checked === true;

  const llmModels = {};
  const dashVideo = {};
  if (useComfy) {
    for (const slot of MODEL_SLOTS) llmModels[slot.configKey] = { name: COMFY_MODEL };
  } else {
    for (const slot of MODEL_SLOTS) {
      const slotMode = videoModeById(slot.modeId);
      let name = getSelectValue($(slot.selId), $(slot.customId));
      if (!name || name === COMFY_MODEL) name = slotMode.defaultModel;
      llmModels[slot.configKey] = { name };
      dashVideo[slot.dashKey] = name;
    }
  }

  if (!textModel.name) {
    showStatus(t('settings.required', { field: t('settings.model') }), false);
    return;
  }

  const jsonMode = $('#cfgJsonMode').checked;
  const useProxy = $('#cfgProxy').checked;
  const bgmVolEl = $('#cfgBgmVolume');
  const bgmVolPct = Math.max(0, Math.min(100, Number(bgmVolEl?.value ?? 60)));

  saveConfig({
    apiProviders,
    models: {
      text: textModel,
      image: { name: imageName || IMAGE_PRESETS[0] },
      img2img: { name: img2imgName || IMG2IMG_PRESETS[0] },
      video: llmModels.video,
      lastFrameVideo: llmModels.lastFrameVideo,
      refVideo: llmModels.refVideo,
    },
    videoMode: mode.id,
    jsonMode,
    useProxy,
    bgm: {
      enabled: $('#cfgBgmEnabled')?.checked === true,
      path: bgmPath,
      name: bgmName,
      volume: bgmVolPct / 100,
    },
  });

  const dashScopeConfig = {
    apiKey: apiProviders.dashscope?.apiKey || '',
    imageModel: imageName || IMAGE_PRESETS[0],
    img2imgModel: img2imgName || IMG2IMG_PRESETS[0],
  };
  // The ComfyUI sentinel lives only in the llm settings record; the DashScope
  // API provider keeps its previously selected real models when ComfyUI is on.
  if (!useComfy) {
    dashScopeConfig.videoModel = dashVideo.videoModel;
    dashScopeConfig.lastFrameVideoModel = dashVideo.lastFrameVideoModel;
    dashScopeConfig.refVideoModel = dashVideo.refVideoModel;
  }
  saveDashScopeConfig(dashScopeConfig);

  if (useComfy) saveComfySshConfig();

  setActiveProvider('video', useComfy ? 'video-comfy' : 'video');
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
      showStatus(t('settings.required', { field: t('settings.model') }), false);
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
    showStatus(t('settings.required', { field: `${textProvider} ${t('settings.apiKey')}` }), false);
    return;
  }
  if (!textModelName) {
    showStatus(t('settings.required', { field: t('settings.model') }), false);
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

  const comfyChosen = $('#cfgUseComfyVideo')?.checked === true;

  let comfyLine = null;
  if (comfyChosen) {
    const config = saveComfySshConfig();
    if (!config.host) {
      comfyLine = { ok: false, msg: t('settings.comfyHostRequired') };
    } else {
      try {
        const res = await fetch('/api/comfyui/status', {
          headers: { 'X-Ssh-Config': JSON.stringify(config) },
        });
        const data = await res.json();
        if (data.comfyui?.online) {
          const gpuInfo = data.comfyui.gpu?.map(g => `${g.name} (${g.vram_free}/${g.vram_total}MB)`).join(', ') || 'OK';
          comfyLine = { ok: true, msg: t('settings.comfyConnected', { gpu: gpuInfo }) };
        } else {
          comfyLine = { ok: false, msg: t('settings.comfyOffline', { reason: data.comfyui?.error || t('ui.na') }) };
        }
      } catch (err) {
        comfyLine = { ok: false, msg: t('settings.comfyError', { reason: err.message }) };
      }
    }
  }

  btn.disabled = false;
  textEl.textContent = t('settings.test');

  let ok = result.ok;
  const parts = [t('settings.llmTestPrefix', { result: result.ok ? t('settings.testOk') : result.error })];
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

  modal?.querySelectorAll('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => activateSettingsTab(button.dataset.settingsTab));
  });

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
  setupModelSelectChange('#cfgImg2ImgModel', '#img2imgModelCustomWrap', IMG2IMG_PRESETS);
  for (const slot of MODEL_SLOTS) setupModelSelectChange(slot.selId, slot.wrapId, []);
  $('#cfgUseComfyVideo')?.addEventListener('change', (event) => {
    applyComfyUiState(event.target.checked);
  });

  const bgmFileInput = $('#cfgBgmFile');
  if (bgmFileInput) {
    bgmFileInput.addEventListener('change', async () => {
      const file = bgmFileInput.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('/api/upload/bgm', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        bgmPath = data.path;
        bgmName = data.originalName || file.name;
        renderBgmFileUi();
        const enable = $('#cfgBgmEnabled');
        if (enable) enable.checked = true;
        showStatus(t('settings.bgm.uploaded', { name: bgmName }), true);
        setTimeout(clearStatus, 4000);
      } catch (err) {
        showStatus(t('settings.bgm.uploadError', { reason: err.message || 'unknown' }), false);
        bgmFileInput.value = '';
      }
    });
  }

  const bgmClearBtn = $('#bgmClearBtn');
  if (bgmClearBtn) {
    bgmClearBtn.addEventListener('click', () => {
      bgmPath = '';
      bgmName = '';
      const enable = $('#cfgBgmEnabled');
      if (enable) enable.checked = false;
      if (bgmFileInput) bgmFileInput.value = '';
      renderBgmFileUi();
      clearStatus();
    });
  }

  const bgmVolInput = $('#cfgBgmVolume');
  if (bgmVolInput) {
    bgmVolInput.addEventListener('input', () => {
      const val = $('#bgmVolumeVal');
      if (val) val.textContent = bgmVolInput.value + '%';
    });
  }

  const saveBtn = $('#saveSettingsBtn');
  if (saveBtn) saveBtn.addEventListener('click', handleSave);

  const testBtn = $('#testConnBtn');
  if (testBtn) testBtn.addEventListener('click', handleTest);

  updateIndicator();
}
