import * as THREE from 'three';

// Ambient emitters (chimney smoke, fountain spray, braziers…) only run within
// this distance of where the camera looks, and each kind keeps to its own share
// of the pool, so a busy fountain never steals the smoke's particles.
const AMBIENT_RANGE = 60;
const AMBIENT_CAP = { smoke: 40, spray: 40, embers: 40, steam: 20, wisps: 30 };
const focus = new THREE.Vector3();
export const setFocus = (x, z) => focus.set(x, 0, z);

// Pooled cube/shard particles in one InstancedMesh — chips, leaves, sparks, dust.
export class Particles {
  constructor(scene, max = 900, round = false) {
    this.max = max;
    const geo = round ? new THREE.IcosahedronGeometry(0.5, 1) : new THREE.BoxGeometry(1, 1, 1);
    // Unshaded, both kinds: one shader for every particle.
    const mat = new THREE.MeshBasicMaterial({ vertexColors: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.p = [];
    this.tmp = new THREE.Object3D();
    this.col = new THREE.Color();
  }

  // Close enough to the view for an ambient emitter to bother?
  near(pos) {
    return (pos.x - focus.x) ** 2 + (pos.z - focus.z) ** 2 < AMBIENT_RANGE ** 2;
  }

  // opts: { n, color(s), speed, up, size, life, gravity, spread, drag, spin }
  // ambient: 'smoke' | 'spray' | …: an ambient emitter's puff (skipped when far,
  // and capped per kind: the kind's oldest goes first).
  burst(pos, o = {}) {
    const n = o.n ?? 12;
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? '#ffffff'];
    const kind = o.ambient ?? null;
    if (kind) {
      if (!this.near(pos)) return;
      this.kinds ??= {};
      const cap = AMBIENT_CAP[kind] ?? 30;
      if ((this.kinds[kind] ?? 0) + n > cap) {
        const i = this.p.findIndex((q) => q.kind === kind);
        if (i >= 0) this.p.splice(i, 1), this.kinds[kind]--;
        else return;
      }
      this.kinds[kind] = (this.kinds[kind] ?? 0) + n;
    }
    for (let i = 0; i < n; i++) {
      if (this.p.length >= this.max) {
        const old = this.p.shift();
        if (old.kind) this.kinds[old.kind]--;
      }
      const a = Math.random() * Math.PI * 2;
      const sp = (o.speed ?? 4) * (0.4 + Math.random() * 0.8);
      const dir = o.dir;
      let vx = Math.cos(a) * sp * (o.spread ?? 1);
      let vz = Math.sin(a) * sp * (o.spread ?? 1);
      if (dir) {
        vx = vx * 0.5 + dir.x * sp;
        vz = vz * 0.5 + dir.z * sp;
      }
      this.p.push({
        x: pos.x + (Math.random() - 0.5) * (o.jitter ?? 0.3),
        y: pos.y + (Math.random() - 0.5) * (o.jitter ?? 0.3),
        z: pos.z + (Math.random() - 0.5) * (o.jitter ?? 0.3),
        vx,
        vy: (o.up ?? 4) * (0.5 + Math.random() * 0.8),
        vz,
        rx: Math.random() * 6,
        ry: Math.random() * 6,
        spin: (o.spin ?? 8) * (Math.random() - 0.5),
        s: (o.size ?? 0.15) * (0.6 + Math.random() * 0.8),
        life: (o.life ?? 0.9) * (0.7 + Math.random() * 0.6),
        age: 0,
        g: o.gravity ?? 14,
        drag: o.drag ?? 0.5,
        flat: o.flat ?? false,
        kind,
        color: this.col.set(colors[i % colors.length]).clone(),
      });
    }
  }

  update(dt) {
    const t = this.tmp;
    let k = 0;
    this.p = this.p.filter((p) => {
      if ((p.age += dt) < p.life) return true;
      if (p.kind) this.kinds[p.kind]--;
      return false;
    });
    for (const p of this.p) {
      p.vy -= p.g * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) {
        p.y = 0.05;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      p.rx += p.spin * dt;
      p.ry += p.spin * dt * 0.7;
      const fade = 1 - Math.max(0, (p.age - p.life * 0.6) / (p.life * 0.4));
      t.position.set(p.x, p.y, p.z);
      t.rotation.set(p.rx, p.ry, 0);
      const s = p.s * fade;
      t.scale.set(s, p.flat ? s * 0.25 : s, s);
      t.updateMatrix();
      this.mesh.setMatrixAt(k, t.matrix);
      this.mesh.setColorAt(k, p.color);
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// Expanding ground ring (click marker, impact shockwave).
export class Rings {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.geo = new THREE.RingGeometry(0.8, 1, 32);
  }
  spawn(pos, { color = '#ffffff', size = 1.2, life = 0.5, y = 0.06 } = {}) {
    const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, y, pos.z);
    this.scene.add(m);
    this.list.push({ m, age: 0, life, size });
  }
  update(dt) {
    this.list = this.list.filter((r) => {
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) {
        this.scene.remove(r.m);
        r.m.material.dispose();
        return false;
      }
      const s = r.size * (0.3 + k * 0.9);
      r.m.scale.set(s, s, s);
      r.m.material.opacity = 0.9 * (1 - k);
      return true;
    });
  }
}
