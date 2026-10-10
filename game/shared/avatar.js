// Avatar customization options. The 3D builder reads these; adding a costume
// is just adding an entry here (and optionally a mesh variant in the builder).
export const AVATAR_OPTIONS = {
  skin: ['#ffe0c4', '#f5c9a3', '#e0a87e', '#c68857', '#9c6440', '#6e4428'],
  hairStyle: ['spiky', 'bob', 'long', 'bun', 'ponytail', 'mohawk', 'bald'],
  hairColor: ['#3b2618', '#7a4a26', '#d9a441', '#f2e1a0', '#c0392b', '#e86fa3', '#5b7be0', '#ececec', '#2b2b2b', '#5fbf8f'],
  eyes: ['round', 'happy', 'sleepy', 'sparkle'],
  eyeColor: ['#2b2b2b', '#3b6fb6', '#3f8f4f', '#7a4a26', '#9b59b6'],
  outfit: ['adventurer', 'tunic', 'robe', 'overalls', 'vest'],
  outfitColor: ['#e2574c', '#3b82c4', '#4caf6a', '#f2b33d', '#8e5cc9', '#ee8fb5', '#4a4a5a', '#f4f1e8'],
  pantsColor: ['#4a3b32', '#2f3e5c', '#6b5a45', '#33473a', '#555555'],
  hat: ['none', 'wizard', 'crown', 'beanie', 'straw', 'bandana', 'leaf'],
  back: ['none', 'cape', 'backpack', 'wings'],
};

export const DEFAULT_AVATAR = {
  skin: '#f5c9a3',
  hairStyle: 'spiky',
  hairColor: '#7a4a26',
  eyes: 'round',
  eyeColor: '#2b2b2b',
  outfit: 'adventurer',
  outfitColor: '#3b82c4',
  pantsColor: '#4a3b32',
  hat: 'none',
  back: 'none',
};

export function sanitizeAvatar(a) {
  const out = { ...DEFAULT_AVATAR };
  if (!a || typeof a !== 'object') return out;
  for (const k of Object.keys(AVATAR_OPTIONS)) if (AVATAR_OPTIONS[k].includes(a[k])) out[k] = a[k];
  return out;
}

export function randomAvatar(rng = Math.random) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const a = {};
  for (const k of Object.keys(AVATAR_OPTIONS)) a[k] = pick(AVATAR_OPTIONS[k]);
  return a;
}

export const NAME_RE = /^[A-Za-z0-9_ ]{3,16}$/;
