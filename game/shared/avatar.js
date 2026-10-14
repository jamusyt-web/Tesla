// Avatar customization options. The 3D builder reads these; adding a costume
// is just adding an entry here (and optionally a mesh variant in the builder).
export const AVATAR_OPTIONS = {
  skin: ['#ffe0c4', '#f5c9a3', '#e0a87e', '#c68857', '#9c6440', '#6e4428'],
  hairStyle: ['spiky', 'bob', 'long', 'bun', 'ponytail', 'mohawk', 'bald'],
  hairColor: ['#3b2618', '#7a4a26', '#d9a441', '#f2e1a0', '#c0392b', '#b0506e', '#4a5f9e', '#ececec', '#2b2b2b', '#4f8f72'],
  eyes: ['round', 'happy', 'sleepy', 'sparkle'],
  eyeColor: ['#2b2b2b', '#3b6fb6', '#3f8f4f', '#7a4a26', '#9b59b6'],
  outfit: ['adventurer', 'tunic', 'robe', 'overalls', 'vest'],
  outfitColor: ['#9b3b2e', '#2f5d8a', '#3e6b45', '#b8862e', '#5b3f7a', '#8a4a5e', '#3a3d45', '#d9cfb8'],
  pantsColor: ['#4a3b32', '#2f3e5c', '#6b5a45', '#33473a', '#555555'],
  hat: ['none', 'wizard', 'crown', 'beanie', 'straw', 'bandana', 'leaf'],
  back: ['none', 'cape', 'backpack', 'wings'],
  // A cape in a region's colours: earned at 75% of that region's journal
  // page; or a field guide page's colours, earned at 50% of it.
  cloakTint: ['none', 'meadow', 'autumn', 'snow', 'desert', 'crystal', 'grove', 'slate', 'bloom', 'tide', 'hunter'],
};
export const CLOAK_TINTS = { meadow: '#4f8f3a', autumn: '#b5562a', snow: '#9fc4e0', desert: '#d6a24a', crystal: '#7a5cc9', grove: '#2e6b3f', slate: '#6f7d8c', bloom: '#d878a8', tide: '#2f8db5', hunter: '#8f3f2c' };

export const DEFAULT_AVATAR = {
  skin: '#f5c9a3',
  hairStyle: 'spiky',
  hairColor: '#7a4a26',
  eyes: 'round',
  eyeColor: '#2b2b2b',
  outfit: 'adventurer',
  outfitColor: '#2f5d8a',
  pantsColor: '#4a3b32',
  hat: 'none',
  back: 'none',
  cloakTint: 'none',
};

// Colours from the brighter first palette, mapped onto today's, so saved
// heroes keep (roughly) the look their player chose.
const LEGACY = {
  outfitColor: { '#e2574c': '#9b3b2e', '#3b82c4': '#2f5d8a', '#4caf6a': '#3e6b45', '#f2b33d': '#b8862e', '#8e5cc9': '#5b3f7a', '#ee8fb5': '#8a4a5e', '#4a4a5a': '#3a3d45', '#f4f1e8': '#d9cfb8' },
  hairColor: { '#e86fa3': '#b0506e', '#5b7be0': '#4a5f9e', '#5fbf8f': '#4f8f72' },
};

export function sanitizeAvatar(a) {
  const out = { ...DEFAULT_AVATAR };
  if (!a || typeof a !== 'object') return out;
  for (const k of Object.keys(AVATAR_OPTIONS)) {
    const v = LEGACY[k]?.[a[k]] ?? a[k];
    if (AVATAR_OPTIONS[k].includes(v)) out[k] = v;
  }
  return out;
}

export function randomAvatar(rng = Math.random) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const a = {};
  for (const k of Object.keys(AVATAR_OPTIONS)) a[k] = pick(AVATAR_OPTIONS[k]);
  // Keep random heroes grounded: most go bare-headed, wings and sparkly eyes are rare.
  if (rng() < 0.5) a.hat = 'none';
  const b = rng();
  a.back = b < 0.5 ? 'none' : b < 0.53 ? 'wings' : pick(['cape', 'backpack']);
  if (a.eyes === 'sparkle' && rng() > 0.2) a.eyes = 'round';
  a.cloakTint = 'none'; // earned, never rolled
  return a;
}

export const NAME_RE = /^[A-Za-z0-9_ ]{3,16}$/;
