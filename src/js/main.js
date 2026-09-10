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

const INSPIRATION_IDEAS = {
  zh: [
    ['🚀', '一名火星快递员收到一个寄给三十年前自己的包裹。'],
    ['🌧️', '一座永远下雨的小城里，修伞匠发现每把旧伞都保存着主人的一段记忆。'],
    ['🕰️', '每天午夜，整座城市会静止一分钟，只有一个失眠的孩子还能行动。'],
    ['🐋', '漂浮在云海中的小镇，靠一头会唱歌的鲸鱼指引回家的方向。'],
    ['🎭', '一个不会撒谎的骗子，被迫在一场婚礼上扮演完美的新郎。'],
    ['📻', '深夜电台主持人接到来自明天的听众电话，对方请求她阻止一场事故。'],
    ['🌱', '末日后的最后一名园丁，在废墟中种出了一株会说话的植物。'],
    ['🏮', '女孩继承了一家只在梦里营业的灯笼店，顾客都是忘记归路的人。'],
    ['🤖', '陪伴老人多年的家用机器人即将被回收，于是策划了第一次离家旅行。'],
    ['🔍', '侦探调查一宗没有受害者的谋杀案，却发现所有证据都指向未来的自己。'],
    ['🎬', '过气动作演员回到故乡，发现小镇居民仍把他当作真正的超级英雄。'],
    ['🌊', '海边女孩每天捡到一封漂流信，信里记录着一座正在消失的岛。'],
  ],
  en: [
    ['🚀', 'A courier on Mars receives a package addressed to herself thirty years ago.'],
    ['🌧️', 'In a town where it never stops raining, an umbrella repairer finds that old umbrellas preserve their owners’ memories.'],
    ['🕰️', 'Every midnight the city freezes for one minute, and only one sleepless child can still move.'],
    ['🐋', 'A village floating above the clouds relies on a singing whale to guide travelers home.'],
    ['🎭', 'A con artist who cannot lie must pretend to be the perfect groom at a wedding.'],
    ['📻', 'A late-night radio host receives a call from tomorrow asking her to prevent an accident.'],
    ['🌱', 'The last gardener after the apocalypse grows a plant that can speak.'],
    ['🏮', 'A girl inherits a lantern shop that opens only in dreams for customers who have forgotten the way home.'],
    ['🤖', 'A household robot facing recycling plans its first trip away with the elderly owner it has cared for.'],
    ['🔍', 'A detective investigates a murder with no victim, but every clue points to his future self.'],
    ['🎬', 'A washed-up action star returns home and finds the town still believes he is a real superhero.'],
    ['🌊', 'A girl by the sea finds a new drifting letter each day from an island that is slowly disappearing.'],
  ],
};
let inspirationOffset = 0;
const lastPlaceholderIdea = { zh: -1, en: -1 };
let currentPlaceholderIdea = '';

function showRandomInspirationPlaceholder() {
  const input = $('#userInput');
  const ideas = INSPIRATION_IDEAS[state.lang] || INSPIRATION_IDEAS.zh;
  if (!input || !ideas.length) return;

  let index = Math.floor(Math.random() * ideas.length);
  if (ideas.length > 1 && index === lastPlaceholderIdea[state.lang]) {
    index = (index + 1) % ideas.length;
  }
  lastPlaceholderIdea[state.lang] = index;
  currentPlaceholderIdea = ideas[index][1];

  const guidance = t('ui.placeholder').split('\n\n')[0];
  const example = state.lang === 'en'
    ? `e.g. "${currentPlaceholderIdea}"`
    : `比如："${currentPlaceholderIdea}"`;
  input.placeholder = `${guidance}\n\n${example}`;
}

function renderInspirationIdeas(advance = false) {
  const grid = $('#inspirationGrid');
  if (!grid) return;
  const ideas = INSPIRATION_IDEAS[state.lang] || INSPIRATION_IDEAS.zh;
  if (advance) inspirationOffset = (inspirationOffset + 6) % ideas.length;
  grid.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const [icon, story] = ideas[(inspirationOffset + i) % ideas.length];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inspiration-card';
    const mark = document.createElement('span');
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = icon;
    button.append(mark, document.createTextNode(story));
    button.addEventListener('click', () => {
      const input = $('#userInput');
      input.value = story;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      $('#inspirationPanel')?.classList.add('hidden');
      $('#inspirationToggle')?.setAttribute('aria-expanded', 'false');
      input.focus();
    });
    grid.appendChild(button);
  }
}

$('#inspirationToggle')?.addEventListener('click', (event) => {
  const panel = $('#inspirationPanel');
  const open = panel.classList.toggle('hidden') === false;
  event.currentTarget.setAttribute('aria-expanded', String(open));
  if (open) renderInspirationIdeas();
});
$('#inspirationShuffle')?.addEventListener('click', () => renderInspirationIdeas(true));
window.addEventListener('languagechange', () => {
  renderInspirationIdeas();
  showRandomInspirationPlaceholder();
});
showRandomInspirationPlaceholder();

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
    ta.setRangeText(currentPlaceholderIdea || t('ui.example'), ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
