import './providers/template.js';
import './providers/llm.js';
import './providers/image.js';
import './providers/video.js';
import './providers/videoComfy.js';
import './providers/render.js';
import { $, $$ } from './utils.js';
import { state } from './state.js';
import { STEPS, dataKeyOf } from './config.js';
import { setFirstFrame, setLastFrame, addReferenceImages, removeReferenceImage, clearSlot, clearAllUploads, getUploads, hasUploads, uploadToServer } from './media.js';
import { buildPipelineBar, showSection, setMascot, addAgentMessage, updatePipeline } from './ui/render.js';
import { showStepReadOnly } from './navigation.js';
import { startPipeline, restoreSession } from './engine.js';
import { t, applyLang } from './i18n.js';
import { initSettings } from './ui/settings.js';
import { initMascotInteraction } from './mascot-interact.js';

const savedTheme = localStorage.getItem('cine-cutie-theme');
if (savedTheme) {
  state.theme = savedTheme;
  document.documentElement.dataset.theme = savedTheme;
} else {
  document.documentElement.dataset.theme = 'dark';
}
$('#themeToggle').textContent = state.theme === 'dark' ? '🌙' : '☀️';
const savedLang = localStorage.getItem('cine-cutie-lang');
if (savedLang) state.lang = savedLang;
applyLang();
initSettings();

$('#themeToggle').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem('cine-cutie-theme', state.theme);
  $('#themeToggle').textContent = state.theme === 'dark' ? '🌙' : '☀️';
});

$('#langToggle').addEventListener('click', () => {
  state.lang = state.lang === 'zh' ? 'en' : 'zh';
  localStorage.setItem('cine-cutie-lang', state.lang);
  applyLang();
});

buildPipelineBar();
initMascotInteraction();

if (restoreSession() && Object.values(state.data).some(v => v != null)) {
  showSection('pipelineSection');
  updatePipeline(state.currentStep, 'active');
  const viewIdx = state.data[dataKeyOf(STEPS[state.currentStep])] != null
    ? state.currentStep
    : state.currentStep - 1;
  if (viewIdx >= 0) showStepReadOnly(viewIdx);
  addAgentMessage('♻️', t('ui.sessionRestored'));
}

const slotConfig = {
  firstFrame: { slotEl: '#slotFirstFrame', inputEl: '#inputFirstFrame', previewEl: '#previewFirstFrame' },
  lastFrame: { slotEl: '#slotLastFrame', inputEl: '#inputLastFrame', previewEl: '#previewLastFrame' },
  referenceImages: { slotEl: '#slotReferenceImages', inputEl: '#inputReferenceImages', previewEl: '#previewReferenceImages' },
};

function initSlotHandlers(slotName) {
  const cfg = slotConfig[slotName];
  const slotEl = $(cfg.slotEl);
  const inputEl = $(cfg.inputEl);
  if (!slotEl || !inputEl) return;

  slotEl.addEventListener('click', () => inputEl.click());
  slotEl.addEventListener('dragover', e => { e.preventDefault(); slotEl.classList.add('dragover'); });
  slotEl.addEventListener('dragleave', () => slotEl.classList.remove('dragover'));
  slotEl.addEventListener('drop', e => {
    e.preventDefault();
    slotEl.classList.remove('dragover');
    handleSlotFiles(slotName, e.dataTransfer.files);
  });
  inputEl.addEventListener('change', () => {
    handleSlotFiles(slotName, inputEl.files);
    inputEl.value = '';
  });
}

function handleSlotFiles(slotName, fileList) {
  let err;
  if (slotName === 'firstFrame') {
    err = setFirstFrame(fileList[0]);
  } else if (slotName === 'lastFrame') {
    err = setLastFrame(fileList[0]);
  } else if (slotName === 'referenceImages') {
    err = addReferenceImages(fileList);
  }
  if (err) {
    alert(err);
    return;
  }
  renderUploadSlots();
}

function renderUploadSlots() {
  const uploads = getUploads();

  renderSingleSlot('firstFrame', uploads.firstFrame);
  renderSingleSlot('lastFrame', uploads.lastFrame);
  renderRefSlot(uploads.referenceImages);
  updateModeHint();
}

function renderSingleSlot(slotName, entry) {
  const cfg = slotConfig[slotName];
  const slotEl = $(cfg.slotEl);
  const previewEl = $(cfg.previewEl);
  if (!slotEl || !previewEl) return;

  if (entry) {
    slotEl.classList.add('has-file');
    previewEl.classList.remove('hidden');
    previewEl.innerHTML = `
      <div style="position:relative;display:inline-block">
        <img src="${entry.previewUrl}" alt="${entry.name}">
        <button class="slot-remove" data-slot="${slotName}" data-index="-1">&times;</button>
      </div>`;
    previewEl.querySelector('.slot-remove').addEventListener('click', e => {
      e.stopPropagation();
      clearSlot(slotName);
      renderUploadSlots();
    });
  } else {
    slotEl.classList.remove('has-file');
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';
  }
}

function renderRefSlot(refImages) {
  const cfg = slotConfig.referenceImages;
  const slotEl = $(cfg.slotEl);
  const previewEl = $(cfg.previewEl);
  if (!slotEl || !previewEl) return;

  if (refImages.length > 0) {
    slotEl.classList.add('has-file');
    previewEl.classList.remove('hidden');
    previewEl.innerHTML = refImages.map((entry, i) => `
      <div style="position:relative;display:inline-block">
        <img src="${entry.previewUrl}" alt="${entry.name}">
        <button class="slot-remove" data-index="${i}">&times;</button>
      </div>`).join('');
    previewEl.querySelectorAll('.slot-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        removeReferenceImage(+btn.dataset.index);
        renderUploadSlots();
      });
    });
  } else {
    slotEl.classList.remove('has-file');
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';
  }
}

function updateModeHint() {
  const hint = $('#uploadModeHint');
  if (!hint) return;
  const uploads = getUploads();
  if (uploads.referenceImages.length > 0) {
    hint.textContent = t('ui.uploadModeR2v');
    hint.classList.remove('hidden');
  } else if (uploads.firstFrame || uploads.lastFrame) {
    hint.textContent = t('ui.uploadModeI2v');
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
}

for (const name of Object.keys(slotConfig)) initSlotHandlers(name);
renderUploadSlots();

function updateDurationHint() {
  const val = Math.max(5, parseInt($('#totalDuration').value) || 30);
  const clips = Math.ceil(val / 5);
  $('#durationHint').textContent = t('ui.durationInputHint', { count: clips });
}
$('#totalDuration').addEventListener('input', updateDurationHint);
updateDurationHint();

$$('.aspect-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.aspect-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.aspectRatio = btn.dataset.ratio;
    state.imageSize = btn.dataset.size;
  });
});

$$('.res-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.res-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.resolution = btn.dataset.res;
  });
});

$$('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.mode = btn.dataset.mode;
  });
});

$$('#styleOptions .style-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#styleOptions .style-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.visualStyle = btn.dataset.style;
    const customInput = $('#customStyleInput');
    if (btn.dataset.style === 'custom') {
      customInput.classList.remove('hidden');
      customInput.focus();
    } else {
      customInput.classList.add('hidden');
    }
  });
});

$('#customStyleInput').addEventListener('input', e => {
  state.customStyle = e.target.value.trim();
});

$('#startBtn').addEventListener('click', async () => {
  const input = $('#userInput').value.trim();
  if (!input && !hasUploads()) {
    $('#userInput').focus();
    $('#userInput').style.borderColor = 'var(--rose)';
    setTimeout(() => $('#userInput').style.borderColor = '', 2000);
    return;
  }

  if (hasUploads()) {
    const uploads = getUploads();
    if (uploads.lastFrame && !uploads.firstFrame) {
      alert(t('ui.slotNeedFirstForLast'));
      return;
    }
  }

  state.userInput = input;
  state.genre = state.visualStyle === 'custom'
    ? (state.customStyle || 'cinematic')
    : state.visualStyle;
  state.totalDuration = Math.max(5, Math.min(120, parseInt($('#totalDuration').value) || 30));

  const btn = $('#startBtn');
  btn.disabled = true;
  btn.textContent = t('ui.starting');

  try {
    if (hasUploads()) {
      btn.textContent = t('ui.uploading') || 'Uploading...';
      await uploadToServer();
    }
  } catch (err) {
    alert('Upload failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = t('ui.startBtn') || '✨ Lights, Camera, Action!';
    return;
  }

  const genreLabel = state.visualStyle === 'custom'
    ? (state.customStyle || 'cinematic')
    : t('style.' + state.visualStyle);
  const genreHint = t('ui.genreHint', { genre: genreLabel });
  const modeHint = state.mode === 'auto'
    ? t('ui.modeAutoHint')
    : t('ui.modeCoHint');

  setTimeout(() => {
    showSection('pipelineSection');
    $('#stepContent').innerHTML = '';
    addAgentMessage('🎬', t('ui.welcome', { genreHint, modeHint }));
    setTimeout(() => startPipeline(), 2000);
  }, 800);
});

$('#userInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    $('#startBtn').click();
  }
});
