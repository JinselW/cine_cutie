import './providers/template.js';
import { initHistory } from './ui/history.js';
import './providers/llm.js';
import { getDefaultVideoDuration } from './providers/video.js';
import { getConfig as getDashScopeConfig } from './providers/image.js';
import './providers/videoComfy.js';
import './providers/render.js';
import { $, $$, escapeHtml } from './utils.js';
import { state } from './state.js';
import { STEPS, dataKeyOf } from './config.js';
import { buildPipelineBar, showSection, setMascot, addAgentMessage, updatePipeline, refreshRunningLanguage, clearCurrentMessages } from './ui/render.js';
import { showStepReadOnly } from './navigation.js';
import { startPipeline, restoreSession, continuePipeline, clearSession, stopPipeline, persistWorkflow } from './engine.js';
import { t, applyLang } from './i18n.js';
import { initSettings } from './ui/settings.js';
import { initComfyStatus } from './ui/comfyMonitor.js';
import { initMascotInteraction } from './mascot-interact.js';
import { rerenderCurrentView } from './ui/views.js';
import { startProgressRun } from './progressTracker.js';
import { getIPComplianceAgent } from './agents/ipComplianceAgent.js';

const savedTheme = localStorage.getItem('cine-cutie-theme');
if (savedTheme) {
  state.theme = savedTheme;
  document.documentElement.dataset.theme = savedTheme;
} else {
  document.documentElement.dataset.theme = 'dark';
}
const savedLang = localStorage.getItem('cine-cutie-lang');
if (savedLang) state.lang = savedLang;
applyLang();
initSettings();
initComfyStatus();
initHistory();

function setTheme(theme) {
  if (theme !== 'dark' && theme !== 'light') return;
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('cine-cutie-theme', theme);
  const themeSelect = $('#cfgTheme');
  if (themeSelect) themeSelect.value = theme;
}

$('#cfgTheme')?.addEventListener('change', (event) => {
  setTheme(event.target.value);
});

function setLanguage(lang) {
  if (lang !== 'zh' && lang !== 'en') return;
  state.lang = lang;
  localStorage.setItem('cine-cutie-lang', lang);
  applyLang();
  buildPipelineBar();
  const currentStep = STEPS[state.currentStep];
  const hasCurrentOutput = currentStep && state.data[dataKeyOf(currentStep)] != null;
  updatePipeline(state.currentStep, state.stepRunning ? 'active' : hasCurrentOutput ? 'done' : 'active');
  if (state.stepRunning) refreshRunningLanguage();
  else rerenderCurrentView();
  window.dispatchEvent(new CustomEvent('languagechange'));
}

$('#cfgLanguage')?.addEventListener('change', (event) => {
  setLanguage(event.target.value);
});

buildPipelineBar();
initMascotInteraction();

const restored = restoreSession();
if (restored) {
  $$('.mode-btn').forEach(b => b.classList.remove('active'));
  const restoredModeBtn = $(`.mode-btn[data-mode="${state.mode}"]`);
  if (restoredModeBtn) restoredModeBtn.classList.add('active');
}
const hasData = Object.values(state.data).some(v => v != null);
if (restored && hasData) {
  showSection('pipelineSection');
  updatePipeline(state.currentStep, 'active');
  const viewIdx = state.data[dataKeyOf(STEPS[state.currentStep])] != null
    ? state.currentStep
    : state.currentStep - 1;
  if (viewIdx >= 0) showStepReadOnly(viewIdx);
  addAgentMessage('♻️', t('ui.sessionRestored'));

  const continueBtn = $('#continueMakingBtn');
  const startOverBtn = $('#startOverBtn');
  const actions = $('#restoreActions');
  if (continueBtn) continueBtn.textContent = t('ui.continueMaking');
  if (startOverBtn) startOverBtn.textContent = t('ui.startOver');
  if (actions) actions.classList.remove('hidden');

  continueBtn?.addEventListener('click', async () => {
    if (actions) actions.classList.add('hidden');
    await continuePipeline();
  });

  startOverBtn?.addEventListener('click', async () => {
    console.log('[startOver] clicked');
    try {
      await stopPipeline();
      console.log('[startOver] pipeline stopped');
    } catch (e) {
      console.error('[startOver] stopPipeline error', e);
    }
    try {
      clearSession();
      console.log('[startOver] cleared, switching to input view');
    } catch (e) {
      console.error('[startOver] clearSession error', e);
    }

    // 重置表单字段到默认值
    const userInput = $('#userInput');
    if (userInput) userInput.value = '';

    const totalDuration = $('#totalDuration');
    if (totalDuration) {
      totalDuration.value = '30';
      updateDurationHint();
    }

    // 重置比例按钮到 16:9
    $$('.aspect-btn').forEach(b => b.classList.remove('active'));
    const defaultAspect = $('.aspect-btn[data-ratio="16:9"]');
    if (defaultAspect) defaultAspect.classList.add('active');

    // 重置分辨率按钮到 720P
    $$('.res-btn').forEach(b => b.classList.remove('active'));
    const defaultRes = $('.res-btn[data-res="720P"]');
    if (defaultRes) defaultRes.classList.add('active');

    // 重置视觉风格按钮到 cinematic
    $$('.style-btn').forEach(b => b.classList.remove('active'));
    const defaultStyle = $('.style-btn[data-style="cinematic"]');
    if (defaultStyle) defaultStyle.classList.add('active');

    const customStyleInput = $('#customStyleInput');
    if (customStyleInput) {
      customStyleInput.value = '';
      customStyleInput.classList.add('hidden');
    }

    // 重置模式按钮到 auto
    $$('.mode-btn').forEach(b => b.classList.remove('active'));
    const defaultMode = $('.mode-btn[data-mode="auto"]');
    if (defaultMode) defaultMode.classList.add('active');

    // 清空提示词文件槽
    state.promptDoc = null;
    renderPromptSlot();

    // 隐藏恢复横幅并切换到输入页
    const actions = $('#restoreActions');
    if (actions) actions.classList.add('hidden');
    showSection('inputSection');
  });
}

const PROMPT_SLOT = { slotEl: '#slotPromptFile', inputEl: '#inputPromptFile', previewEl: '#previewPromptFile' };

function initPromptFileSlot() {
  const slotEl = $(PROMPT_SLOT.slotEl);
  const inputEl = $(PROMPT_SLOT.inputEl);
  if (!slotEl || !inputEl) return;

  slotEl.addEventListener('click', e => {
    if (e.target.closest('.slot-remove') || e.target.closest('.remove')) return;
    inputEl.click();
  });
  slotEl.addEventListener('dragover', e => { e.preventDefault(); slotEl.classList.add('dragover'); });
  slotEl.addEventListener('dragleave', () => slotEl.classList.remove('dragover'));
  slotEl.addEventListener('drop', e => {
    e.preventDefault();
    slotEl.classList.remove('dragover');
    handlePromptFile(e.dataTransfer.files[0]);
  });
  inputEl.addEventListener('change', () => {
    handlePromptFile(inputEl.files[0]);
    inputEl.value = '';
  });
}

async function handlePromptFile(file) {
  if (!file) return;
  const previewEl = $(PROMPT_SLOT.previewEl);
  previewEl.classList.remove('hidden');
  previewEl.innerHTML = `<div class="file-tag">📄 ${escapeHtml(file.name)} · ${t('ui.promptFileParsing')}</div>`;

  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/upload/prompt', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.promptDoc = data;
  } catch (err) {
    state.promptDoc = null;
    alert(err.message);
  }
  renderPromptSlot();
}

function renderPromptSlot() {
  const slotEl = $(PROMPT_SLOT.slotEl);
  const previewEl = $(PROMPT_SLOT.previewEl);
  const doc = state.promptDoc;
  if (!doc) {
    slotEl.classList.remove('has-file');
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';
    return;
  }
  slotEl.classList.add('has-file');
  previewEl.classList.remove('hidden');
  const meta = t('ui.promptFileMeta', { count: doc.chars }) + (doc.truncated ? t('ui.promptFileTruncated') : '');
  previewEl.innerHTML = `
    <div class="file-tag">📄 ${escapeHtml(doc.name)} · ${escapeHtml(meta)}
      <span class="remove" id="promptFileRemove">&times;</span>
    </div>`;
  $('#promptFileRemove').addEventListener('click', e => {
    e.stopPropagation();
    state.promptDoc = null;
    renderPromptSlot();
  });
}

initPromptFileSlot();
renderPromptSlot();

function updateDurationHint() {
  const dsConfig = getDashScopeConfig();
  const secPerClip = getDefaultVideoDuration(dsConfig.videoModel);
  const val = Math.max(secPerClip, parseInt($('#totalDuration').value) || 30);
  const clips = Math.ceil(val / secPerClip);
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
    persistWorkflow();
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
  if (!input && !state.promptDoc) {
    $('#userInput').focus();
    $('#userInput').style.borderColor = 'var(--rose)';
    setTimeout(() => $('#userInput').style.borderColor = '', 2000);
    return;
  }

  const suppliedTexts = [input, state.promptDoc?.text].filter(Boolean);
  const inputCheck = getIPComplianceAgent().checkTexts(suppliedTexts);
  if (inputCheck.verdict === 'FAIL') {
    const names = [...new Set(inputCheck.findings
      .filter(f => f.verdict === 'FAIL')
      .map(f => f.candidateIp))].join(', ');
    window.alert(t('ui.ipInputBlocked', { names }));
    // Deliberately keep both the textarea and uploaded prompt document intact.
    $('#userInput').focus();
    return;
  }

  state.userInput = input;
  state.genre = state.visualStyle === 'custom'
    ? (state.customStyle || 'cinematic')
    : state.visualStyle;
  state.totalDuration = Math.max(5, Math.min(120, parseInt($('#totalDuration').value) || 30));

  const btn = $('#startBtn');
  btn.disabled = true;
  btn.textContent = t('ui.starting');
  startProgressRun();
  clearCurrentMessages();
  $('#stepContent').innerHTML = '';
  buildPipelineBar();
  showSection('pipelineSection');

  const genreLabel = state.visualStyle === 'custom'
    ? (state.customStyle || 'cinematic')
    : t('style.' + state.visualStyle);
  const genreHint = t('ui.genreHint', { genre: genreLabel });
  const modeHint = state.mode === 'auto'
    ? t('ui.modeAutoHint')
    : t('ui.modeCoHint');

  addAgentMessage('🎬', t('ui.welcome', { genreHint, modeHint }));
  await startPipeline();
});

$('#userInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    $('#startBtn').click();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.currentTarget;
    ta.setRangeText(t('ui.example'), ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
