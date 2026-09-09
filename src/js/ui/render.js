import { $, $$, escapeHtml } from '../utils.js';
import { STEPS, dataKeyOf } from '../config.js';
import { state, resetState } from '../state.js';
import { t } from '../i18n.js';
import { onNodeClick } from '../navigation.js';
import { beginStage, getProgressSnapshot } from '../progressTracker.js';

let _genAnim = null;
let _msgBuffer = [];
let _allCurrentMsgs = [];
let _controls = null;
let _progressHandler = null;
let _pipelineFailureIssues = [];

export function setPipelineControls(controls) {
  _controls = controls;
}

export function setGenAnim(anim) {
  _genAnim = anim;
}

export function getGenAnim() {
  return _genAnim;
}

export function buildPipelineBar() {
  const container = $('#pipeline');
  container.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'pipeline-row';
  STEPS.forEach((step, i) => {
    if (i > 0) row.appendChild(createLine(i - 1));
    row.appendChild(createNode(step, i));
  });
  container.appendChild(row);
}

function createNode(step, index) {
  const node = document.createElement('div');
  node.className = 'pipe-node pipe-node-sm';
  node.dataset.step = index;
  node.id = `pipe${index}`;
  node.innerHTML = `${step.icon}<span class="pipe-label">${t(step.labelKey)}</span>`;
  node.addEventListener('click', () => onNodeClick(index));
  return node;
}

function createLine(index) {
  const line = document.createElement('div');
  line.className = 'pipe-line pipe-line-sm';
  line.id = `line${index}`;
  return line;
}

export function updatePipeline(step, status) {
  for (let i = 0; i < STEPS.length; i++) {
    const node = $(`#pipe${i}`);
    if (!node) continue;
    const line = $(`#line${i}`);
    node.classList.remove('active', 'done', 'failed');
    if (i < step) {
      node.classList.add('done');
      if (line) line.classList.add('done');
    } else if (i === step) {
      if (status === 'active') node.classList.add('active');
      if (status === 'failed') {
        node.classList.add('failed');
        if (line) line.classList.remove('done');
      }
      if (status === 'done') {
        node.classList.add('done');
        if (line) line.classList.add('done');
      }
    }
  }
  for (let i = 0; i < STEPS.length; i++) {
    const node = $(`#pipe${i}`);
    if (!node) continue;
    node.classList.remove('clickable', 'viewing');
    if (node.classList.contains('done')) {
      if (i < state.currentStep) node.classList.add('clickable');
      if (i === state.viewingStep) node.classList.add('viewing');
    }
    if (i === state.currentStep && state.viewingStep !== null) node.classList.add('clickable');
  }
}

export function showPipelineFailure(issues) {
  _pipelineFailureIssues = Array.isArray(issues) ? [...issues] : [];
  $('#stepContent').innerHTML = `
    <div class="gen-status pipeline-failure">
      <div class="msg">${t('ui.stageBlocked')}</div>
      <ul class="pipeline-failure-issues">${_pipelineFailureIssues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>
      <div class="pipeline-failure-actions">
        <button class="action-btn primary" id="failedRetryBtn">${t('ui.retryCurrentStep')}</button>
        <button class="action-btn" id="failedBackBtn">${t('ui.backToInput')}</button>
      </div>
    </div>`;
  $('#failedRetryBtn').addEventListener('click', async () => {
    const buttons = document.querySelectorAll('#failedRetryBtn, #failedBackBtn');
    buttons.forEach(button => { button.disabled = true; });
    try {
      await _controls?.retry();
    } catch (error) {
      buttons.forEach(button => { button.disabled = false; });
      console.error('[pipeline] failed to retry current step', error);
    }
  });
  $('#failedBackBtn').addEventListener('click', stopGeneration);
  setMascotCompact(false);
  setMascot(null);
}

export function restorePipelineFailure() {
  showPipelineFailure(_pipelineFailureIssues);
}

export function setMascot(mood) {
  const m = $('#mascot');
  m.classList.remove('mascot-happy', 'mascot-thinking');
  if (mood) m.classList.add('mascot-' + mood);
}

export function setMascotCompact(compact) {
  const wrap = $('.mascot-wrap');
  const header = $('.header');
  if (wrap) wrap.classList.toggle('mascot-compact', compact);
  if (header) header.classList.toggle('header-compact', compact);
}

export function clearCurrentMessages() {
  _allCurrentMsgs = [];
  _msgBuffer = [];
}

export function showGenerating(stepIndex) {
  const step = STEPS[stepIndex];
  const agent = t(step.agentKey);
  const label = t(step.labelKey);
  const el = $('#stepContent');
  beginStage(step.id);
  el.innerHTML = `
    <div class="gen-status">
      <div class="sub-msg">${t('ui.agentWorking', { agent })}</div>
      <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
      <div class="progress-wrap" id="genProgressWrap">
        <div class="progress-bar indeterminate" id="genProgressBar" role="progressbar" aria-label="${label}"><div class="progress-fill" id="genProgress"></div></div>
        <div class="progress-label"><span id="genPhase">${t('progress.preparing')}</span><span id="genPercent"></span></div>
        <div class="progress-detail" id="genProgressDetail">${label}</div>
      </div>
      <div style="margin-top:12px;text-align:center">
        <button class="action-btn" id="pauseBtn" style="padding:6px 20px;font-size:13px">${t('ui.pause')}</button>
      </div>
    </div>
  `;
  setMascot('thinking');
  setMascotCompact(true);

  $('#pauseBtn').addEventListener('click', pauseGeneration);

  const renderProgress = detail => {
    const fill = $('#genProgress');
    const pct = $('#genPercent');
    const bar = $('#genProgressBar');
    const phase = $('#genPhase');
    const meta = $('#genProgressDetail');
    if (!fill || !pct || !bar || !phase || !meta || detail.stageId !== step.id) return;
    phase.textContent = t(`progress.${detail.phase}`);
    bar.classList.toggle('indeterminate', detail.mode !== 'determinate');
    if (detail.mode === 'determinate' && detail.total > 0) {
      const percent = Math.round((detail.completed / detail.total) * 100);
      fill.style.width = `${percent}%`;
      pct.textContent = `${percent}%`;
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(percent));
      meta.textContent = detail.unit === 'percent' || detail.total === 1
        ? label
        : t('progress.items', { completed: detail.completed, total: detail.total, current: detail.activeItem });
    } else {
      fill.style.width = '';
      pct.textContent = '';
      bar.removeAttribute('aria-valuemin');
      bar.removeAttribute('aria-valuemax');
      bar.removeAttribute('aria-valuenow');
      meta.textContent = detail.phase === 'retrying'
        ? t('progress.attempt', { attempt: detail.attempt })
        : label;
    }
  };
  _progressHandler = event => renderProgress(event.detail);
  window.addEventListener('pipeline-progress', _progressHandler);
  renderProgress(getProgressSnapshot());

  const anim = {
    stop() {
      if (_progressHandler) window.removeEventListener('pipeline-progress', _progressHandler);
      _progressHandler = null;
    }
  };
  setGenAnim(anim);
  return anim;
}

let _resumeResolve = null;

export function waitForResume() {
  if (!state.paused) return Promise.resolve();
  return new Promise(resolve => { _resumeResolve = resolve; });
}

export function pauseGeneration() {
  _controls?.pause();
  const anim = getGenAnim();
  if (anim) anim.stop();
  setGenAnim(null);

  renderPausedStatus();
}

function renderPausedStatus() {
  const el = $('#stepContent');
  el.innerHTML = `
    <div class="gen-status" style="text-align:center">
      <div style="font-size:48px;margin-bottom:12px">⏸️</div>
      <div class="msg">${t('ui.stepPaused')}</div>
      <div style="margin-top:20px;display:flex;gap:10px;justify-content:center">
        <button class="action-btn primary" id="resumeBtn">${t('ui.resume')}</button>
        <button class="action-btn" id="stopBtn">${t('ui.stop')}</button>
      </div>
    </div>
  `;
  setMascotCompact(false);
  setMascot(null);

  $('#resumeBtn').addEventListener('click', resumeGeneration);
  $('#stopBtn').addEventListener('click', stopGeneration);
}

export function refreshRunningLanguage() {
  const anim = getGenAnim();
  if (anim) anim.stop();
  setGenAnim(null);
  if (state.paused) {
    renderPausedStatus();
    return;
  }
  showGenerating(state.currentStep);
}

export function resumeGeneration() {
  _controls?.resume();
  if (_resumeResolve) {
    _resumeResolve();
    _resumeResolve = null;
  }
  if (state.stepRunning) {
    showGenerating(state.currentStep);
  }
}

export async function stopGeneration() {
  await _controls?.stop();
  state.paused = false;
  if (_resumeResolve) {
    _resumeResolve();
    _resumeResolve = null;
  }
  setGenAnim(null);
  resetState();
  state.stopped = true;
  showSection('inputSection');
  const btn = $('#startBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = t('ui.startBtn');
  }
  setMascotCompact(false);
  setMascot(null);
}

export function addAgentMessage(icon, text) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('agent-memory-message', { detail: { icon, text } }));
  }
  _allCurrentMsgs.push({ icon, text });
  if (state.viewingStep !== null && state.stepRunning) {
    _msgBuffer.push({ icon, text });
    return;
  }
  _prependMsg(icon, text);
}

function _prependMsg(icon, text) {
  const msg = document.createElement('div');
  msg.className = 'agent-msg';
  msg.innerHTML = `
    <div class="agent-icon">${icon}</div>
    <div class="agent-text">${text}</div>
  `;
  $('#stepContent').prepend(msg);
}

export function renderCurrentMessages() {
  const content = $('#stepContent');
  content.querySelectorAll('.agent-msg').forEach(el => el.remove());
  for (const { icon, text } of _allCurrentMsgs) {
    _prependMsg(icon, text);
  }
}

export function flushBufferedMessages() {
  if (_msgBuffer.length === 0) return;
  for (const { icon, text } of _msgBuffer) {
    _prependMsg(icon, text);
  }
  _msgBuffer = [];
}

export function showSection(id) {
  $$('.section').forEach(s => s.classList.add('hidden'));
  $(`#${id}`).classList.remove('hidden');
}
