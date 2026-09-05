import { $, $$, escapeHtml } from '../utils.js';
import { STEPS, dataKeyOf } from '../config.js';
import { state, resetState } from '../state.js';
import { t } from '../i18n.js';
import { onNodeClick } from '../navigation.js';

let _genAnim = null;
let _msgBuffer = [];
let _allCurrentMsgs = [];

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
    node.classList.remove('active', 'done');
    if (i < step) {
      node.classList.add('done');
      if (line) line.classList.add('done');
    } else if (i === step) {
      if (status === 'active') node.classList.add('active');
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

export function setMascot(mood) {
  const m = $('#mascot');
  m.classList.remove('mascot-happy', 'mascot-thinking');
  if (mood) m.classList.add('mascot-' + mood);
}

export function clearCurrentMessages() {
  _allCurrentMsgs = [];
  _msgBuffer = [];
}

export function showGenerating(stepIndex) {
  const step = STEPS[stepIndex];
  const msgs = step.genKeys.map(key => t(key));
  const agent = t(step.agentKey);
  const label = t(step.labelKey);
  let idx = 0;
  const el = $('#stepContent');
  el.innerHTML = `
    <div class="gen-status">
      <div class="msg" id="genMsg">${msgs[0]}</div>
      <div class="sub-msg">${t('ui.agentWorking', { agent })}</div>
      <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" id="genProgress"></div></div>
        <div class="progress-label"><span>${label}</span><span id="genPercent">0%</span></div>
      </div>
      <div style="margin-top:12px;text-align:center">
        <button class="action-btn" id="pauseBtn" style="padding:6px 20px;font-size:13px">${t('ui.pause')}</button>
      </div>
    </div>
  `;
  setMascot('thinking');

  $('#pauseBtn').addEventListener('click', pauseGeneration);

  const msgInterval = setInterval(() => {
    idx = (idx + 1) % msgs.length;
    const msgEl = $('#genMsg');
    if (msgEl) msgEl.textContent = msgs[idx];
  }, 2000);

  let progress = 0;
  const progressInterval = setInterval(() => {
    progress += Math.random() * 15 + 5;
    if (progress > 95) progress = 95;
    const fill = $('#genProgress');
    const pct = $('#genPercent');
    if (fill) fill.style.width = progress + '%';
    if (pct) pct.textContent = Math.round(progress) + '%';
  }, 400);

  const anim = {
    stop() {
      clearInterval(msgInterval);
      clearInterval(progressInterval);
      const fill = $('#genProgress');
      const pct = $('#genPercent');
      if (fill) fill.style.width = '100%';
      if (pct) pct.textContent = '100%';
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
  state.paused = true;
  const anim = getGenAnim();
  if (anim) anim.stop();
  setGenAnim(null);

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
  setMascot(null);

  $('#resumeBtn').addEventListener('click', resumeGeneration);
  $('#stopBtn').addEventListener('click', stopPipeline);
}

export function resumeGeneration() {
  state.paused = false;
  if (_resumeResolve) {
    _resumeResolve();
    _resumeResolve = null;
  }
  if (state.stepRunning) {
    showGenerating(state.currentStep);
  }
}

export function stopPipeline() {
  state.stopped = true;
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
  setMascot(null);
}

export function addAgentMessage(icon, text) {
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
