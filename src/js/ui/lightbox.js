import { $ } from '../utils.js';

function close() {
  const lb = $('#imageLightbox');
  if (lb) lb.classList.add('hidden');
}

export function openLightbox(src, alt = '') {
  const lb = $('#imageLightbox');
  if (!lb) return;
  const img = $('#imageLightboxImg');
  if (img) {
    img.src = src;
    img.alt = alt;
  }
  lb.classList.remove('hidden');
}

function initLightbox() {
  const lb = $('#imageLightbox');
  if (!lb) return;
  $('#imageLightboxClose')?.addEventListener('click', close);
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

function onDocumentClick(e) {
  const thumb = e.target.closest?.('.media-thumb');
  if (!thumb) return;
  openLightbox(thumb.dataset.src || thumb.currentSrc || thumb.src, thumb.alt);
}

let _delegated = false;

// Event delegation: any .media-thumb rendered anywhere opens the lightbox,
// so there's no need to re-bind after each view re-render.
export function bindImageLightbox() {
  initLightbox();
  if (_delegated) return;
  _delegated = true;
  document.addEventListener('click', onDocumentClick);
}
