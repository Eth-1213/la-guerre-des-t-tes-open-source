// Outils mathématiques et petites fonctions partagées.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/** Ramène un angle dans l'intervalle ]-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Interpolation d'angles par le plus court chemin. */
export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const vAdd = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const vSub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const vScale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
export const vDot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const vLen = (a) => Math.hypot(a.x, a.y, a.z);

export function vNorm(a) {
  const l = vLen(a) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
}

/** Point sur une sphère de rayon r, vu depuis le joueur (yaw horizontal, pitch vertical). */
export function sphere(yaw, pitch, r) {
  const cp = Math.cos(pitch);
  return v3(Math.sin(yaw) * cp * r, Math.sin(pitch) * r, -Math.cos(yaw) * cp * r);
}

/** Direction (yaw, pitch) d'un point du monde. */
export function toSpherical(p) {
  const r = vLen(p) || 1e-6;
  return { yaw: Math.atan2(p.x, -p.z), pitch: Math.asin(clamp(p.y / r, -1, 1)), r };
}

/** Caméra : repère orthonormé construit depuis yaw/pitch. */
export class Camera {
  constructor() {
    this.yaw = 0;
    this.pitch = 0;
    this.fov = rad(68);
    this.w = 1;
    this.h = 1;
    this.focal = 1;
    this.right = v3(1, 0, 0);
    this.up = v3(0, 1, 0);
    this.fwd = v3(0, 0, -1);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    // Champ de vision vertical constant : la scène colle au cadrage de la caméra du téléphone.
    this.focal = h / 2 / Math.tan(this.fov / 2);
  }

  update() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.fwd = v3(sy * cp, sp, -cy * cp);
    this.right = v3(cy, 0, sy);
    this.up = v3(-sy * sp, cp, cy * sp);
  }

  /** Projette un point du monde ; renvoie null si derrière la caméra. */
  project(p, out = {}) {
    const z = vDot(p, this.fwd);
    if (z <= 0.08) return null;
    const x = vDot(p, this.right);
    const y = vDot(p, this.up);
    const k = this.focal / z;
    out.x = this.w / 2 + x * k;
    out.y = this.h / 2 - y * k;
    out.z = z;
    out.scale = k;
    return out;
  }
}

/** File d'événements simple (écrans, sons, succès…). */
export class Emitter {
  constructor() { this.map = new Map(); }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(fn);
    return () => this.map.get(evt).delete(fn);
  }
  emit(evt, data) {
    const set = this.map.get(evt);
    if (set) for (const fn of set) fn(data);
  }
}

export function formatScore(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
