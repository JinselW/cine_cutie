export const $ = s => document.querySelector(s);
export const $$ = s => document.querySelectorAll(s);

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) e.dataset[dk] = dv;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  }
  return e;
}

export function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function detectGenre(text) {
  const keywords = {
    scifi: /\b(ai|robot|space|cyber|future|alien|android|quantum|matrix|neural|tech|飞船|机器人|太空|未来|赛博|人工智能|量子)\b/i,
    romance: /\b(love|romance|heart|crush|date|wedding|kiss|relationship|lover|beloved|爱情|浪漫|恋人|暗恋|约会|心动)\b/i,
    mystery: /\b(murder|mystery|detective|clue|secret|crime|suspense|thriller|investigation|whodunit|谋杀|悬疑|侦探|秘密|犯罪|推理)\b/i,
    adventure: /\b(adventure|explore|quest|journey|treasure|ruins|expedition|survival|discover|冒险|探索|宝藏|遗迹|远征|旅程)\b/i,
    comedy: /\b(comedy|funny|humor|parody|absurd|witty|prank|chaos|hilarious|laugh|喜剧|搞笑|幽默|荒诞|笑话|恶搞)\b/i,
    fantasy: /\b(magic|wizard|dragon|fairy|enchanted|mythical|spell|kingdom|prophecy|魔法|巫师|龙|精灵|咒语|王国|预言)\b/i
  };
  for (const [genre, re] of Object.entries(keywords)) {
    if (re.test(text)) return genre;
  }
  return 'fantasy';
}

export async function typeText(element, text, speed = 8) {
  let i = 0;
  element.textContent = '';
  return new Promise(resolve => {
    const timer = setInterval(() => {
      if (i < text.length) {
        element.textContent += text[i];
        i++;
        element.scrollTop = element.scrollHeight;
      } else {
        clearInterval(timer);
        resolve();
      }
    }, speed);
  });
}
