import { $, $$, escapeHtml } from '../utils.js';
import { STEPS } from '../config.js';
import { t } from '../i18n.js';

export function buildPipelineBar() {
  const container = $('#pipeline');
  container.innerHTML = '';

  const half = Math.ceil(STEPS.length / 2);
  const row1 = STEPS.slice(0, half);
  const row2 = STEPS.slice(half);

  const topRow = document.createElement('div');
  topRow.className = 'pipeline-row';
  row1.forEach((step, i) => {
    if (i > 0) topRow.appendChild(createLine(i - 1, 'top'));
    topRow.appendChild(createNode(step, i));
  });
  container.appendChild(topRow);

  const connector = document.createElement('div');
  connector.className = 'pipeline-connector';
  connector.innerHTML = '<div class="connector-line"></div>';
  container.appendChild(connector);

  const bottomRow = document.createElement('div');
  bottomRow.className = 'pipeline-row';
  row2.forEach((step, i) => {
    if (i > 0) bottomRow.appendChild(createLine(half + i - 1, 'bottom'));
    bottomRow.appendChild(createNode(step, half + i));
  });
  container.appendChild(bottomRow);
}

function createNode(step, index) {
  const node = document.createElement('div');
  node.className = 'pipe-node pipe-node-sm';
  node.dataset.step = index;
  node.id = `pipe${index}`;
  node.innerHTML = `${step.icon}<span class="pipe-label">${t(step.labelKey)}</span>`;
  return node;
}

function createLine(index, row) {
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
}

export function setMascot(mood) {
  const m = $('#mascot');
  m.classList.remove('mascot-happy', 'mascot-thinking');
  if (mood) m.classList.add('mascot-' + mood);
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
    </div>
  `;
  setMascot('thinking');

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

  return {
    stop() {
      clearInterval(msgInterval);
      clearInterval(progressInterval);
      const fill = $('#genProgress');
      const pct = $('#genPercent');
      if (fill) fill.style.width = '100%';
      if (pct) pct.textContent = '100%';
    }
  };
}

export function addAgentMessage(icon, text) {
  const msg = document.createElement('div');
  msg.className = 'agent-msg';
  msg.innerHTML = `
    <div class="agent-icon">${icon}</div>
    <div class="agent-text">${text}</div>
  `;
  $('#stepContent').prepend(msg);
}

export function showSection(id) {
  $$('.section').forEach(s => s.classList.add('hidden'));
  $(`#${id}`).classList.remove('hidden');
}
