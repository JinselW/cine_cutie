import { $, escapeHtml } from '../utils.js';
import { state } from '../state.js';
import { STEPS } from '../config.js';
import { setMascot } from './render.js';
import { t } from '../i18n.js';
import { getExecutionLog, getTotalTokens, getAverageQuality } from '../observability.js';

function feedbackPanel(stepId, approveKey = 'ui.approve') {
  return `
    <div class="feedback-area" style="width:100%">
      <textarea id="feedbackInput" placeholder="${t('ui.feedbackPlaceholder')}"></textarea>
      <div class="feedback-hint">${t('ui.feedbackHint')}</div>
      <div class="action-row" style="margin-top:10px">
        <button class="action-btn primary" id="approveBtn">✅ ${t(approveKey)}</button>
        <button class="action-btn rose" id="reviseBtn">${t('ui.revise')}</button>
      </div>
    </div>
  `;
}

function autoAdvance(delay, callback) {
  const actions = $('#actionRow');
  if (actions) {
    actions.innerHTML = `<button class="action-btn primary" id="autoNextBtn">${t('ui.nextStep')}</button>`;
    const btn = $('#autoNextBtn');
    if (btn) btn.style.display = 'none';
  }
  setTimeout(callback, delay);
}

function bindFeedback(stepId, approveCallback) {
  const approveBtn = $('#approveBtn');
  const reviseBtn = $('#reviseBtn');
  if (approveBtn) approveBtn.addEventListener('click', approveCallback);
  if (reviseBtn) reviseBtn.addEventListener('click', () => {
    const feedback = $('#feedbackInput')?.value.trim();
    if (!feedback) { alert(t('ui.alertFeedback')); return; }
    window.__reviseStep(stepId, feedback);
  });
}

export function renderPlanning(data, onAdvance) {
  const el = $('#stepContent');
  const keyElements = (data.keyElements || []).map(e => `<li style="color:var(--cream2);font-size:0.85rem;margin-bottom:4px">${escapeHtml(e)}</li>`).join('');
  const refs = (data.visualReferences || []).map(r => `<span class="film-ref">${escapeHtml(r)}</span>`).join('');

  el.innerHTML = `
    <div class="result-card">
      <h3>🧠 ${t('ui.planningTitle')}</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px">
          <div style="font-size:0.75rem;color:var(--gold);font-weight:700;margin-bottom:4px">${t('ui.planningTheme')}</div>
          <div style="font-size:0.9rem;color:var(--cream)">${escapeHtml(data.theme)}</div>
        </div>
        <div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px">
          <div style="font-size:0.75rem;color:var(--gold);font-weight:700;margin-bottom:4px">${t('ui.planningTone')}</div>
          <div style="font-size:0.9rem;color:var(--cream)">${escapeHtml(data.tone)}</div>
        </div>
      </div>
      <div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px;margin-bottom:12px">
        <div style="font-size:0.75rem;color:var(--gold);font-weight:700;margin-bottom:4px">${t('ui.planningDirection')}</div>
        <div style="font-size:0.85rem;color:var(--cream2);line-height:1.6">${escapeHtml(data.creativeDirection)}</div>
      </div>
      <div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px;margin-bottom:12px">
        <div style="font-size:0.75rem;color:var(--gold);font-weight:700;margin-bottom:8px">${t('ui.planningKeyElements')}</div>
        <ul style="margin:0;padding-left:18px">${keyElements}</ul>
      </div>
      <div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px">
        <div style="font-size:0.75rem;color:var(--gold);font-weight:700;margin-bottom:8px">${t('ui.planningReferences')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${refs}</div>
      </div>
    </div>
    <div class="action-row" id="actionRow"></div>
  `;

  if (state.mode === 'interactive') {
    $('#actionRow').innerHTML = feedbackPanel('planning', 'ui.approvePlan');
    bindFeedback('planning', onAdvance);
  } else {
    autoAdvance(2000, onAdvance);
  }
  setMascot('happy');
}

export function renderScreenplay(data, onAdvance) {
  const el = $('#stepContent');
  el.innerHTML = `
    <div class="result-card">
      <h3>${t('ui.screenplayHeader', { title: escapeHtml(data.title) })}</h3>
      <div class="content" id="screenplayContent">${escapeHtml(data.text)}</div>
    </div>
    <div class="action-row" id="actionRow"></div>
  `;
  const actions = $('#actionRow');
  if (state.mode === 'interactive') {
    actions.innerHTML = feedbackPanel('screenplay') + `
      <div class="action-row" style="margin-top:8px">
        <button class="action-btn" id="editBtn">${t('ui.editDirectly')}</button>
      </div>
    `;
    bindFeedback('screenplay', () => {
      if ($('#screenplayContent').contentEditable === 'true') {
        state.data.screenplay.text = $('#screenplayContent').textContent;
      }
      onAdvance();
    });
    const editBtn = $('#editBtn');
    if (editBtn) editBtn.addEventListener('click', () => {
      const content = $('#screenplayContent');
      content.contentEditable = content.contentEditable === 'true' ? 'false' : 'true';
      editBtn.textContent = content.contentEditable === 'true' ? t('ui.saveEdits') : t('ui.editDirectly');
    });
  } else {
    autoAdvance(1500, onAdvance);
  }
  setMascot('happy');
}

export function renderCharacters(data, onAdvance) {
  const el = $('#stepContent');
  let html = '<div class="char-grid">';
  data.forEach((char, i) => {
    html += `
      <div class="char-card" style="animation-delay:${i * 0.1}s">
        <div class="char-avatar" style="background:${char.color}20;border:2px solid ${char.color}">${char.emoji}</div>
        <div class="char-name">${escapeHtml(char.name)}</div>
        <div class="char-role">${escapeHtml(char.role)}</div>
        <div class="char-desc">${escapeHtml(char.desc)}</div>
      </div>
    `;
  });
  html += '</div><div class="action-row" id="actionRow"></div>';
  el.innerHTML = html;

  if (state.mode === 'interactive') {
    $('#actionRow').innerHTML = feedbackPanel('characters', 'ui.approveCharacters');
    bindFeedback('characters', onAdvance);
  } else {
    autoAdvance(1500, onAdvance);
  }
  setMascot('happy');
}

export function renderVisualDesign(data, onAdvance) {
  const el = $('#stepContent');
  let swatches = '';
  data.palette.forEach(c => {
    swatches += `
      <div class="color-swatch" style="background:${c.hex}">
        <div class="swatch-label">${escapeHtml(c.name)}</div>
        <div class="swatch-hex">${c.hex}</div>
        <div class="swatch-role">${escapeHtml(c.role)}</div>
      </div>
    `;
  });

  el.innerHTML = `
    <div class="result-card">
      <h3>${t('ui.visualStyleHeader', { style: escapeHtml(data.style) })}</h3>
      <p style="color:var(--cream2);font-size:0.9rem;line-height:1.7;margin-bottom:16px">${escapeHtml(data.description)}</p>
      <div class="color-swatch-grid">${swatches}</div>
    </div>
    <div class="result-card">
      <h3>${t('ui.lighting')}</h3>
      <div class="content">${escapeHtml(data.lighting)}</div>
    </div>
    <div class="result-card">
      <h3>${t('ui.cameraStyle')}</h3>
      <div class="content">${escapeHtml(data.cameraStyle)}</div>
    </div>
    <div class="action-row" id="actionRow"></div>
  `;

  if (state.mode === 'interactive') {
    $('#actionRow').innerHTML = feedbackPanel('visualDesign', 'ui.approveDesign');
    bindFeedback('visualDesign', onAdvance);
  } else {
    autoAdvance(1500, onAdvance);
  }
  setMascot('happy');
}

export function renderStoryboard(data, onAdvance) {
  const el = $('#stepContent');
  let html = '<div class="storyboard-grid">';
  data.forEach((scene, i) => {
    html += `
      <div class="scene-card" style="animation-delay:${i * 0.08}s">
        <div class="scene-thumb" style="background:${scene.color}">
          <span>${scene.icon}</span>
        </div>
        <div class="scene-info">
          <div class="scene-num">${t('ui.scenePrefix', { num: scene.num })}</div>
          <div class="scene-title">${escapeHtml(scene.title)}</div>
          <div class="scene-desc">${escapeHtml(scene.desc)}</div>
        </div>
      </div>
    `;
  });
  html += '</div><div class="action-row" id="actionRow"></div>';
  el.innerHTML = html;

  if (state.mode === 'interactive') {
    $('#actionRow').innerHTML = feedbackPanel('storyboard', 'ui.approveStoryboard');
    bindFeedback('storyboard', onAdvance);
  } else {
    autoAdvance(1500, onAdvance);
  }
  setMascot('happy');
}

export function renderShotGen(shots, storyboard, onAdvance) {
  const el = $('#stepContent');
  let html = '';
  storyboard.forEach(scene => {
    const takes = shots[scene.num] || [];
    html += `<div class="result-card"><h3>🎥 ${t('ui.scenePrefix', { num: scene.num })}: ${escapeHtml(scene.title)}</h3><div class="take-grid">`;
    takes.forEach(take => {
      const statusColor = take.label === 'perfect' ? '#00e5a0' : take.label === 'great' ? 'var(--gold)' : take.label === 'good' ? 'var(--cream2)' : 'var(--rose)';
      const qualityLabel = t(`quality.${take.label}`);
      html += `
        <div class="take-card">
          <div class="take-header">
            <span class="take-num">${t('ui.takePrefix', { num: take.takeNum })}</span>
            <span class="take-badge" style="background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}">${qualityLabel}</span>
          </div>
          <div class="take-angle">${escapeHtml(take.angle)}</div>
          <div class="take-comp">${escapeHtml(take.composition)}</div>
          <div class="take-score">
            <div class="score-bar"><div class="score-fill" style="width:${take.score}%;background:${statusColor}"></div></div>
            <span class="score-num">${take.score}/100</span>
          </div>
        </div>
      `;
    });
    html += '</div></div>';
  });
  html += '<div class="action-row" id="actionRow"></div>';
  el.innerHTML = html;

  if (state.mode === 'interactive') {
    $('#actionRow').innerHTML = feedbackPanel('shotGen', 'ui.approveShots');
    bindFeedback('shotGen', onAdvance);
  } else {
    autoAdvance(3000, onAdvance);
  }
  setMascot('happy');
}

export function renderShotCuration(curated, storyboard, onAdvance) {
  const el = $('#stepContent');
  let html = '';
  storyboard.forEach(scene => {
    const c = curated[scene.num];
    if (!c) return;
    const selectedQualityLabel = t(`quality.${c.selected.label}`);
    html += `
      <div class="result-card">
        <h3>🔍 ${t('ui.scenePrefix', { num: scene.num })}: ${escapeHtml(scene.title)}</h3>
        <div class="take-grid">
          <div class="take-card selected">
            <div class="take-header">
              <span class="take-num">${t('ui.takeSelected', { num: c.selected.takeNum })}</span>
              <span class="take-badge" style="background:#00e5a020;color:#00e5a0;border:1px solid #00e5a0">${selectedQualityLabel}</span>
            </div>
            <div class="take-angle">${escapeHtml(c.selected.angle)}</div>
            <div class="take-comp">${escapeHtml(c.selected.composition)}</div>
            <div class="take-score">
              <div class="score-bar"><div class="score-fill" style="width:${c.selected.score}%;background:#00e5a0"></div></div>
              <span class="score-num">${c.selected.score}/100</span>
            </div>
          </div>
          ${c.rejected.map(rej => {
            const rejectedQualityLabel = t(`quality.${rej.label}`);
            return `
            <div class="take-card rejected">
              <div class="take-header">
                <span class="take-num">${t('ui.takePrefix', { num: rej.takeNum })}</span>
                <span class="take-badge" style="opacity:0.5">${rejectedQualityLabel}</span>
              </div>
              <div class="take-angle" style="opacity:0.5">${escapeHtml(rej.angle)}</div>
              <div class="take-score">
                <div class="score-bar"><div class="score-fill" style="width:${rej.score}%;opacity:0.4"></div></div>
                <span class="score-num" style="opacity:0.5">${rej.score}/100</span>
              </div>
            </div>
          `;
          }).join('')}
        </div>
        <p style="color:var(--cream3);font-size:0.8rem;margin-top:8px;font-style:italic">${escapeHtml(c.reason)}</p>
      </div>
    `;
  });
  html += '<div class="action-row" id="actionRow"></div>';
  el.innerHTML = html;

  if (state.mode === 'interactive') {
    $('#actionRow').innerHTML = feedbackPanel('shotCuration', 'ui.approveSelections');
    bindFeedback('shotCuration', onAdvance);
  } else {
    autoAdvance(2000, onAdvance);
  }
  setMascot('happy');
}

export function renderEditing(timeline, onAdvance) {
  const el = $('#stepContent');
  let clips = '';
  timeline.clips.forEach((clip, i) => {
    clips += `
      <div class="timeline-clip" style="animation-delay:${i * 0.1}s">
        <div class="clip-scene">${t('ui.scenePrefix', { num: clip.sceneNum })}</div>
        <div class="clip-title">${escapeHtml(clip.sceneTitle)}</div>
        <div class="clip-meta">${clip.duration} · ${escapeHtml(clip.shot?.angle || t('ui.na'))}</div>
        ${clip.transition ? `<div class="timeline-transition">→ ${escapeHtml(clip.transition)}</div>` : ''}
      </div>
    `;
  });

  el.innerHTML = `
    <div class="result-card">
      <h3>${t('ui.editTimeline')}</h3>
      <div style="color:var(--cream3);font-size:0.85rem;margin-bottom:12px">
        ${t('ui.totalRuntime')}: <strong style="color:var(--cream)">${timeline.totalDuration}</strong> · 
        ${t('ui.pacing')}: <strong style="color:var(--cream)">${escapeHtml(timeline.pacing)}</strong>
      </div>
      <div class="timeline-bar">${clips}</div>
    </div>
    <div class="action-row" id="actionRow"></div>
  `;

  if (state.mode === 'interactive') {
    $('#actionRow').innerHTML = feedbackPanel('editing', 'ui.approveEdit');
    bindFeedback('editing', onAdvance);
  } else {
    autoAdvance(2000, onAdvance);
  }
  setMascot('happy');
}

export function renderAudio(data, onAdvance) {
  const el = $('#stepContent');
  const m = data.music;

  let sceneTracks = '';
  data.sceneAudio.forEach(sa => {
    sceneTracks += `
      <div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px;margin-bottom:8px">
        <div style="font-size:0.8rem;color:var(--gold);font-weight:700">${t('ui.scenePrefix', { num: sa.sceneNum })}: ${escapeHtml(sa.sceneTitle)}</div>
        <div style="font-size:0.78rem;color:var(--cream3);margin-top:4px">🎵 ${escapeHtml(sa.musicCue)} · ${t('ui.sfx')}: ${sa.sfx.map(s => escapeHtml(s)).join(', ')}</div>
        <div style="font-size:0.75rem;color:var(--cream3);margin-top:2px">${t('ui.durationLabel')}: ${sa.duration}</div>
      </div>
    `;
  });

  el.innerHTML = `
    <div class="result-card">
      <h3>${t('ui.musicDirection')}</h3>
      <div class="audio-tracks">
        <div class="audio-track">
          <div class="track-label">${t('ui.theme')}</div>
          <div class="track-info">${escapeHtml(m.theme)} · ${m.tempo}</div>
          <div class="track-wave"></div>
        </div>
        <div class="audio-track">
          <div class="track-label">${t('ui.instruments')}</div>
          <div class="track-info">${escapeHtml(m.instruments)}</div>
        </div>
        <div class="audio-track">
          <div class="track-label">${t('ui.mood')}</div>
          <div class="track-info">${escapeHtml(m.mood)}</div>
        </div>
      </div>
    </div>
    <div class="result-card">
      <h3>${t('ui.sceneAudio')}</h3>
      ${sceneTracks}
    </div>
    <div class="result-card">
      <h3>${t('ui.mixNotes')}</h3>
      <div class="content">${t('ui.dialogue')}: ${escapeHtml(data.mixNotes.dialogue)}<br>${t('ui.music')}: ${escapeHtml(data.mixNotes.music)}<br>${t('ui.sfx')}: ${escapeHtml(data.mixNotes.sfx)}</div>
    </div>
    <div class="action-row" id="actionRow"></div>
  `;

  if (state.mode === 'interactive') {
    $('#actionRow').innerHTML = feedbackPanel('audio', 'ui.approveAudio');
    bindFeedback('audio', onAdvance);
  } else {
    autoAdvance(2000, onAdvance);
  }
  setMascot('happy');
}

export function renderPostProduction(data, onAdvance) {
  const el = $('#stepContent');
  const vfxList = data.vfx.map(v => `
    <div class="vfx-item">
      <span class="vfx-type">${escapeHtml(v.type)}</span>
      <span class="vfx-desc">${escapeHtml(v.description)}</span>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="result-card">
      <h3>${t('ui.colorGradingHeader', { name: escapeHtml(data.colorGrading.name) })}</h3>
      <div class="content">${escapeHtml(data.colorGrading.description)}</div>
    </div>
    <div class="result-card">
      <h3>${t('ui.visualEffects')}</h3>
      <div class="vfx-list">${vfxList}</div>
    </div>
    <div class="result-card">
      <h3>${t('ui.finalMix')}</h3>
      <div class="content">${t('ui.mix')}: ${escapeHtml(data.finalMix)}<br>${t('ui.output')}: ${escapeHtml(data.outputFormat)}</div>
    </div>
    <div class="action-row" id="actionRow"></div>
  `;

  if (state.mode === 'interactive') {
    $('#actionRow').innerHTML = feedbackPanel('postProduction', 'ui.approvePost');
    bindFeedback('postProduction', onAdvance);
  } else {
    autoAdvance(2000, onAdvance);
  }
  setMascot('happy');
}

export function renderFinalFilm(filmData, onAdvance) {
  const el = $('#stepContent');
  const scenes = state.data.storyboard || [];

  el.innerHTML = `
    <div class="result-card">
      <h3>🎞️ ${escapeHtml(filmData.title)}</h3>
      <div class="video-preview" id="videoPreview">
        <div class="play-icon" id="playBtn"></div>
        <div class="video-player-content" id="playerContent" style="display:none"></div>
        <div class="video-progress" id="videoProgress" style="width:0"></div>
      </div>
      <div style="margin-top:12px;text-align:center">
        <div style="font-weight:700;font-size:1.1rem">${escapeHtml(filmData.title)}</div>
        <div style="color:var(--cream3);font-size:0.82rem;margin-top:4px">${escapeHtml(filmData.genre)} · ${escapeHtml(filmData.runtime)} · ${filmData.scenes} ${t('ui.scenes')}</div>
        <div style="color:var(--cream3);font-size:0.78rem;margin-top:2px">${t('ui.clickPlay')}</div>
      </div>
    </div>
    <div class="action-row" id="actionRow"></div>
  `;

  let playing = false;
  let sceneIdx = 0;
  const screenplay = state.data.screenplay;

  $('#playBtn').addEventListener('click', () => {
    if (playing) return;
    playing = true;
    const preview = $('#videoPreview');
    const content = $('#playerContent');
    const progress = $('#videoProgress');
    preview.classList.add('playing');
    content.style.display = 'flex';

    function playScene() {
      if (sceneIdx >= scenes.length) {
        content.innerHTML = `<div class="scene-text" style="opacity:1;font-size:1.4rem;font-weight:700">${t('ui.theEnd')}<br><span style="font-size:0.9rem;font-weight:400;color:var(--cream3)">${escapeHtml(filmData.title)}</span></div>`;
        setTimeout(() => {
          preview.classList.remove('playing');
          content.style.display = 'none';
          progress.style.width = '0';
          playing = false;
          sceneIdx = 0;
        }, 3000);
        return;
      }
      const scene = scenes[sceneIdx];
      const actScenes = screenplay ? screenplay.acts.flatMap(a => a.scenes) : [];
      const actScene = actScenes[sceneIdx];
      content.innerHTML = `
        <div style="font-size:0.7rem;color:var(--gold);margin-bottom:8px">${t('ui.scenePrefix', { num: scene.num })}</div>
        <div class="scene-text" key="${sceneIdx}">${actScene ? escapeHtml(actScene.location) : escapeHtml(scene.title)}</div>
        <div class="scene-text" style="animation-delay:0.5s;font-size:0.85rem;color:var(--cream2)">${actScene ? escapeHtml(actScene.action.substring(0, 150)) + '...' : escapeHtml(scene.desc)}</div>
      `;
      progress.style.width = ((sceneIdx + 1) / scenes.length * 100) + '%';
      sceneIdx++;
      setTimeout(playScene, 3000);
    }
    playScene();
  });

  if (state.mode === 'interactive') {
    $('#actionRow').innerHTML = `
      <div class="feedback-area" style="width:100%">
        <div class="action-row">
          <button class="action-btn primary" id="finalizeBtn">${t('ui.finalize')}</button>
        </div>
      </div>
    `;
    $('#finalizeBtn').addEventListener('click', onAdvance);
  } else {
    autoAdvance(scenes.length * 3000 + 4000, onAdvance);
  }
}

export function renderExecutionLog() {
  const el = $('#stepContent');
  const log = getExecutionLog();
  const totalTokens = getTotalTokens();
  const avgQuality = getAverageQuality();

  let rows = '';
  log.forEach(entry => {
    const step = STEPS.find(s => s.id === entry.stepId);
    const label = step ? t(step.labelKey) : entry.stepId;
    const scoreDisplay = entry.qualityScore != null
      ? `<span style="color:${entry.qualityScore >= 8 ? '#00e5a0' : entry.qualityScore >= 7 ? 'var(--gold)' : 'var(--rose)'}">${entry.qualityScore.toFixed(1)}</span>`
      : '—';
    const tokensTotal = entry.tokens.prompt + entry.tokens.completion;
    const tokensDisplay = tokensTotal > 0 ? tokensTotal.toLocaleString() : '—';
    const retryDisplay = entry.retryCount > 0 ? entry.retryCount : '—';
    const fallbackBadge = entry.fallbackUsed ? '<span class="log-badge fallback">FALLBACK</span>' : '';

    rows += `
      <tr>
        <td>${step?.icon || ''} ${escapeHtml(label)}</td>
        <td>${escapeHtml(entry.agentName)}</td>
        <td>${entry.duration}s</td>
        <td>${tokensDisplay}</td>
        <td>${scoreDisplay}</td>
        <td>${retryDisplay}</td>
        <td>${fallbackBadge || '—'}</td>
      </tr>
    `;
  });

  const totalTokensAll = totalTokens.prompt + totalTokens.completion;
  const qualityDisplay = avgQuality != null ? avgQuality.toFixed(1) + '/10' : '—';

  el.innerHTML = `
    <div class="result-card">
      <h3>📊 ${t('log.title')}</h3>
      <div class="log-summary">
        <div class="log-stat">
          <div class="log-stat-value">${log.length}</div>
          <div class="log-stat-label">${t('log.stepsCompleted')}</div>
        </div>
        <div class="log-stat">
          <div class="log-stat-value">${totalTokensAll > 0 ? totalTokensAll.toLocaleString() : '—'}</div>
          <div class="log-stat-label">${t('log.totalTokens')}</div>
        </div>
        <div class="log-stat">
          <div class="log-stat-value">${qualityDisplay}</div>
          <div class="log-stat-label">${t('log.avgQuality')}</div>
        </div>
        <div class="log-stat">
          <div class="log-stat-value">${log.reduce((s, e) => s + e.duration, 0).toFixed(1)}s</div>
          <div class="log-stat-label">${t('log.totalDuration')}</div>
        </div>
      </div>
      <table class="log-table">
        <thead>
          <tr>
            <th>${t('log.step')}</th>
            <th>${t('log.agent')}</th>
            <th>${t('log.duration')}</th>
            <th>${t('log.tokens')}</th>
            <th>${t('log.quality')}</th>
            <th>${t('log.retries')}</th>
            <th>${t('log.fallback')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="action-row" id="actionRow">
      <button class="action-btn primary" id="backBtn">${t('log.back')}</button>
    </div>
  `;

  $('#backBtn').addEventListener('click', () => {
    renderFinalFilm(state.data.video || state.data.postProduction || {}, () => {});
  });
}

export function showCompletion() {
  const el = $('#stepContent');
  const title = state.data.screenplay?.title || 'Your Film';
  el.innerHTML = `
    <div class="completion">
      <div class="big-icon">🎉</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${t('ui.filmComplete')}</p>
      <div style="margin-top:24px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="action-btn primary" onclick="location.reload()">${t('ui.createAnother')}</button>
        <button class="action-btn" id="exportBtn">${t('ui.exportProject')}</button>
        <button class="action-btn" id="logBtn">📊 ${t('log.viewLog')}</button>
      </div>
    </div>
  `;
  setMascot('happy');

  $('#exportBtn').addEventListener('click', () => {
    const d = state.data;
    const data = {
      title: d.screenplay?.title || 'Untitled',
      genre: d.screenplay?.genre || 'Unknown',
      screenplay: d.screenplay?.text || '',
      characters: d.characters?.map(c => ({ name: c.name, role: c.role, desc: c.desc })) || [],
      visualDesign: d.visualDesign ? { style: d.visualDesign.style, palette: d.visualDesign.palette } : null,
      storyboard: d.storyboard?.map(s => ({ num: s.num, title: s.title, desc: s.desc })) || [],
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.title.replace(/\s+/g, '_')}_project.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#logBtn').addEventListener('click', () => {
    renderExecutionLog();
  });
}
