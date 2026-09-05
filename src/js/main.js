import './providers/template.js';
import './providers/llm.js';
import './providers/image.js';
import './providers/video.js';
import './providers/render.js';
import { $, $$, detectGenre } from './utils.js';
import { state } from './state.js';
import { STEPS } from './config.js';
import { addFiles, removeMedia, listMedia } from './media.js';
import { buildPipelineBar, showSection, setMascot, addAgentMessage } from './ui/render.js';
import { startPipeline } from './engine.js';
import { t, applyLang } from './i18n.js';
import { initSettings } from './ui/settings.js';

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

const fileUpload = $('#fileUpload');
const fileInput = $('#fileInput');

fileUpload.addEventListener('click', () => fileInput.click());
fileUpload.addEventListener('dragover', e => { e.preventDefault(); fileUpload.classList.add('dragover'); });
fileUpload.addEventListener('dragleave', () => fileUpload.classList.remove('dragover'));
fileUpload.addEventListener('drop', e => {
  e.preventDefault();
  fileUpload.classList.remove('dragover');
  addFiles(e.dataTransfer.files);
  renderMediaList();
});
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  renderMediaList();
  fileInput.value = '';
});

function updateDurationHint() {
  const val = Math.max(5, parseInt($('#totalDuration').value) || 30);
  const clips = Math.ceil(val / 5);
  $('#durationHint').textContent = t('ui.durationInputHint', { count: clips });
}
$('#totalDuration').addEventListener('input', updateDurationHint);
updateDurationHint();

function renderMediaList() {
  const fl = $('#fileList');
  const media = listMedia();
  fl.innerHTML = media.map(m =>
    `<span class="file-tag">${m.name}<span class="remove" data-id="${m.id}">×</span></span>`
  ).join('');
  fl.querySelectorAll('.remove').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      removeMedia(+el.dataset.id);
      renderMediaList();
    });
  });
}

$$('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.mode = btn.dataset.mode;
  });
});

$('#startBtn').addEventListener('click', () => {
  const input = $('#userInput').value.trim();
  if (!input && listMedia().length === 0) {
    $('#userInput').focus();
    $('#userInput').style.borderColor = 'var(--rose)';
    setTimeout(() => $('#userInput').style.borderColor = '', 2000);
    return;
  }

  state.userInput = input;
  state.genre = detectGenre(input);
  state.totalDuration = Math.max(5, Math.min(120, parseInt($('#totalDuration').value) || 30));

  const btn = $('#startBtn');
  btn.disabled = true;
  btn.textContent = t('ui.starting');

  const genreHint = state.genre !== 'fantasy' ? t('ui.genreHint', { genre: state.genre }) : '!';
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
