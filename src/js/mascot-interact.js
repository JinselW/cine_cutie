let busy = false;
let bubbleTimer = null;

const MESSAGES = {
  zh: [
    '嘿！点我干嘛呀~', '再点我就要生气啦！', '好吧好吧，你赢了',
    '我是你的AI电影助手哦', '今天想拍什么故事？', '别戳啦，去写剧本吧！',
    '嘻嘻，痒痒的~', '我在思考人生...',
    '你今天的灵感怎么样？', '想我了就直说嘛', '再点我就要罢工了！',
  ],
  en: [
    'Hey! Why are you poking me~', 'One more poke and I\'ll get mad!', 'Fine fine, you win',
    'I\'m your AI movie assistant!', 'What story shall we make today?', 'Stop poking, go write a script!',
    'Hehe, that tickles~', 'I\'m contemplating life...',
    'How\'s your inspiration today?', 'Just say you missed me', 'One more and I\'m going on strike!',
  ],
};

function lang() {
  return localStorage.getItem('cine-cutie-lang') || 'zh';
}

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function showBubble() {
  const mascot = document.getElementById('mascot');
  const existing = document.querySelector('.mascot-bubble');
  if (existing) {
    existing.classList.add('bubble-exit');
    setTimeout(() => existing.remove(), 300);
  }

  const msgs = MESSAGES[lang()] || MESSAGES.zh;
  const bubble = document.createElement('div');
  bubble.className = 'mascot-bubble';
  bubble.textContent = rand(msgs);

  const rect = mascot.getBoundingClientRect();
  bubble.style.left = (rect.left + rect.width / 2 - 60) + 'px';
  bubble.style.top = (rect.top - 48) + 'px';

  document.body.appendChild(bubble);
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (bubble.parentNode) {
      bubble.classList.add('bubble-exit');
      setTimeout(() => bubble.remove(), 300);
    }
  }, 2500);
}

function bounceMascot() {
  const mascot = document.getElementById('mascot');
  mascot.classList.remove('mascot-bounce');
  void mascot.offsetWidth;
  mascot.classList.add('mascot-bounce');
  setTimeout(() => mascot.classList.remove('mascot-bounce'), 600);
}

function handleClick() {
  if (busy) return;
  busy = true;
  Math.random() < 0.5 ? showBubble() : bounceMascot();
  setTimeout(() => { busy = false; }, 700);
}

function initEyeTracking(mascot) {
  const eyeL = mascot.querySelector('.mascot-eye.left');
  const eyeR = mascot.querySelector('.mascot-eye.right');
  if (!eyeL || !eyeR) return;

  const MAX = 3;

  document.addEventListener('mousemove', e => {
    [eyeL, eyeR].forEach(eye => {
      const r = eye.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const clamp = Math.min(dist, 150) / 150 * MAX;
      const angle = Math.atan2(dy, dx);
      eye.style.setProperty('--px', (Math.cos(angle) * clamp).toFixed(2) + 'px');
      eye.style.setProperty('--py', (Math.sin(angle) * clamp).toFixed(2) + 'px');
    });
  });
}

export function initMascotInteraction() {
  const mascot = document.getElementById('mascot');
  if (!mascot) return;
  mascot.style.cursor = 'pointer';
  mascot.title = lang() === 'zh' ? '点我试试！' : 'Click me!';
  mascot.addEventListener('click', handleClick);
  initEyeTracking(mascot);
}
