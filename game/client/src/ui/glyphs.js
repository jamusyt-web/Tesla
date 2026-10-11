import { h } from '../util/dom.js';

// Single-colour icons (game-icons.net, CC BY 3.0) used as CSS masks, so they
// take the text colour of whatever they sit in. Files: public/ui/icons/<name>.svg
const BASE = import.meta.env.BASE_URL + 'ui/icons/';

export function glyph(name, size) {
  const el = h('span.g', { 'aria-hidden': 'true' });
  el.style.setProperty('--m', `url(${BASE}${name}.svg)`);
  if (size) el.style.fontSize = size;
  return el;
}

// A small rendered gold coin (pure CSS).
export const coin = () => h('i.coin', { 'aria-hidden': 'true' });

// Gold amounts are written as "12 🪙" all over the UI; render every 🪙 as the
// coin above instead of the platform's emoji, whichever code wrote the text.
export function coinify(root) {
  const COIN = '🪙';
  const split = (t) => {
    const frag = document.createDocumentFragment();
    t.data.split(COIN).forEach((p, i) => {
      if (i) frag.append(coin());
      if (p) frag.append(p);
    });
    t.replaceWith(frag);
  };
  const fix = (n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      if (n.data.includes(COIN) && n.parentNode) split(n);
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE || !n.textContent.includes(COIN)) return;
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let t; (t = w.nextNode()); ) if (t.data.includes(COIN)) hits.push(t);
    hits.forEach(split);
  };
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') fix(m.target);
      else m.addedNodes.forEach(fix);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
  fix(root);
}
