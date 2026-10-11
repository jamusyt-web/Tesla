import { MONSTERS } from '../../../shared/monsters.js';
import { LANDS, REGIONS, ZONES, LAKES, PLAZAS, BUILDINGS, GATES, DOCKS, SPAWNS, STONES, pathSegments } from '../../../shared/world.js';

export const TIER_NAMES = ['', 'Starter', 'Novice', 'Adept', 'Veteran', 'Elite'];
export const tierLabel = (t) => `Tier ${t}${TIER_NAMES[t] ? ` · ${TIER_NAMES[t]}` : ''}`;

// Paints the current world as a parchment map, shared by the in-game world
// map and the editor's overview. v = { W, H, dpr, s (pixels per metre), cx, cz
// (world point at the centre) }. mark: { known (Set of attuned waystone ids,
// or 'all'), picked, here (waystone ids to ring) }. Returns a text() helper
// for drawing more labels in the same style.
export function paintWorld(x, v, mark = {}) {
  const toWorld = (sx, sy) => [v.cx + (sx - v.W / 2) / v.s, v.cz + (sy - v.H / 2) / v.s];
  const toScreen = (wx, wz) => [v.W / 2 + (wx - v.cx) * v.s, v.H / 2 + (wz - v.cz) * v.s];
  const known = mark.known === 'all' ? { has: () => true } : mark.known ?? new Set();
    const s = v.s;
    x.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    x.fillStyle = '#2b4955';
    x.fillRect(0, 0, v.W, v.H);
    // Faint 50 m grid over the sea, like an old chart.
    x.strokeStyle = 'rgba(220, 230, 220, 0.07)';
    x.lineWidth = 1;
    const step = 50 * s >= 24 ? 50 : 250;
    const [gx0, gz0] = toWorld(0, 0);
    const [gx1, gz1] = toWorld(v.W, v.H);
    x.beginPath();
    for (let v = Math.ceil(gx0 / step) * step; v < gx1; v += step) {
      const [px] = toScreen(v, 0);
      x.moveTo(px, 0);
      x.lineTo(px, v.H);
    }
    for (let v = Math.ceil(gz0 / step) * step; v < gz1; v += step) {
      const [, py] = toScreen(0, v);
      x.moveTo(0, py);
      x.lineTo(v.W, py);
    }
    x.stroke();

    x.save();
    x.translate(v.W / 2 - v.cx * s, v.H / 2 - v.cz * s);
    x.scale(s, s);
    const px = 1 / s; // one screen pixel, in metres
    const disc = (o, r = o.r) => {
      x.beginPath();
      x.arc(o.x, o.z, r, 0, Math.PI * 2);
    };
    // Shallows, then an inked coastline: stroke every circle, then fill them
    // all over the inner strokes so only the outer edge of the union shows.
    x.fillStyle = '#3d6878';
    for (const l of LANDS) disc(l, l.r + 5), x.fill();
    x.strokeStyle = '#4a3622';
    x.lineWidth = 3 * px;
    for (const l of LANDS) disc(l), x.stroke();
    x.fillStyle = '#d9c79c';
    for (const l of LANDS) disc(l), x.fill();
    // Zones tinted by their ground colour.
    x.globalAlpha = 0.38;
    for (const z of ZONES) (x.fillStyle = z.ground || '#74a04c'), disc(z), x.fill();
    x.globalAlpha = 1;
    // Monster camps: a hatched red patch.
    x.fillStyle = 'rgba(150, 40, 30, 0.16)';
    for (const sp of SPAWNS) disc(sp), x.fill();
    x.strokeStyle = '#a58457';
    x.lineCap = 'round';
    for (const [ax, az, bx, bz, w] of pathSegments()) {
      x.lineWidth = Math.max(1.6 * px, w * 1.6);
      x.beginPath();
      x.moveTo(ax, az);
      x.lineTo(bx, bz);
      x.stroke();
    }
    x.fillStyle = '#bfae8c';
    for (const p of PLAZAS) disc(p), x.fill();
    x.fillStyle = '#6a9cab';
    x.strokeStyle = '#3d5f6a';
    x.lineWidth = 1.5 * px;
    for (const l of LAKES) disc(l), x.fill(), x.stroke();
    x.fillStyle = '#9a7448';
    for (const d of DOCKS) x.fillRect(d.x - d.w / 2, d.z - d.d / 2, d.w, d.d);
    x.strokeStyle = '#2a2018';
    x.lineWidth = 1.2 * px;
    for (const b of BUILDINGS) {
      x.fillStyle = b.deco ? '#b08a5e' : b.roof || '#8a4b3a';
      x.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
      x.strokeRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
    }
    x.fillStyle = '#5d564c';
    for (const gt of GATES) {
      const sc = gt.scale ?? 4.5;
      x.fillRect(gt.x - 3.5 * sc, gt.z - sc / 2, 7 * sc, sc);
    }
    x.restore();

    // Labels and markers, in screen space so they stay crisp.
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const text = (str, sx, sy, font, fill, stroke = 'rgba(30, 20, 12, 0.85)', w = 3) => {
      x.font = font;
      x.lineJoin = 'round';
      x.strokeStyle = stroke;
      x.lineWidth = w;
      x.strokeText(str, sx, sy);
      x.fillStyle = fill;
      x.fillText(str, sx, sy);
    };
    // Region names sit just above each region's northern edge, clear of what's inside.
    for (const r of REGIONS) {
      const size = Math.round(Math.max(15, Math.min(28, r.r * s * 0.2)));
      const [sx, sy] = toScreen(r.x, r.z - r.r);
      text(r.name.toUpperCase(), sx, sy - size - 10, `700 ${size}px Cinzel, Georgia, serif`, '#f1dfb4');
      text(tierLabel(r.tier), sx, sy - 10, '700 12px "Alegreya Sans", sans-serif', '#e8c983');
    }
    if (s > 2.2) {
      for (const z of ZONES) {
        const [sx, sy] = toScreen(z.x, z.z);
        text(z.label, sx, sy, 'italic 600 14px "Alegreya Sans", sans-serif', '#fff6e0', 'rgba(40, 28, 16, 0.75)');
      }
      for (const b of BUILDINGS) {
        if (b.deco) continue;
        const [sx, sy] = toScreen(b.x, b.z + b.d / 2 + 2.5);
        text(b.label, sx, sy, '700 12px "Alegreya Sans", sans-serif', '#fff6e0', 'rgba(40, 28, 16, 0.8)');
      }
    }
    if (s > 3) {
      for (const sp of SPAWNS) {
        const m = MONSTERS[sp.monster];
        if (!m) continue;
        const [sx, sy] = toScreen(sp.x, sp.z);
        text(`${m.name} · Lv ${m.lvl}`, sx, sy, '700 11px "Alegreya Sans", sans-serif', '#ffb4a0', 'rgba(40, 10, 6, 0.85)');
      }
    }

    for (const st of STONES) {
      const [sx, sy] = toScreen(st.x, st.z);
      const on = known.has(st.id);
      const picked = mark.picked === st.id;
      x.save();
      x.translate(sx, sy);
      if (on) {
        x.shadowColor = '#6fe0ff';
        x.shadowBlur = 12;
      }
      x.beginPath();
      x.moveTo(0, -9);
      x.lineTo(7, 0);
      x.lineTo(0, 9);
      x.lineTo(-7, 0);
      x.closePath();
      x.fillStyle = on ? '#8fe8ff' : '#8c8f94';
      x.fill();
      x.shadowBlur = 0;
      x.lineWidth = 2;
      x.strokeStyle = '#14202a';
      x.stroke();
      if (picked || st.id === mark.here) {
        x.beginPath();
        x.arc(0, 0, 14, 0, Math.PI * 2);
        x.strokeStyle = picked ? '#ffe9a8' : 'rgba(143, 232, 255, 0.8)';
        x.lineWidth = 2;
        x.stroke();
      }
      x.restore();
      if (on || s > 2.2) text(on ? st.name : '?', sx, sy + 19, '700 12px "Alegreya Sans", sans-serif', on ? '#dff8ff' : '#c8c8c8', 'rgba(10, 20, 28, 0.9)');
    }
  return text;
}
