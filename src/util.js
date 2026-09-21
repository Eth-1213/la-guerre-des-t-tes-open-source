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

  /** Repère fourni tel quel par les capteurs : roulis et paysage compris. */
  setBasis(right, up, fwd) {
    this.right = right;
    this.up = up;
    this.fwd = fwd;
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

/* ------------------------------------------------------------------ */
/*  Quaternions : orientation du téléphone sans blocage de cardan      */
/* ------------------------------------------------------------------ */

export const quat = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });

/** Quaternion d'angles d'Euler appliqués dans l'ordre YXZ. */
export function quatFromEulerYXZ(x, y, z) {
  const c1 = Math.cos(x / 2), s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2), s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2), s3 = Math.sin(z / 2);
  return quat(
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  );
}

export function quatFromAxisAngle(ax, ay, az, angle) {
  const h = angle / 2, s = Math.sin(h);
  return quat(ax * s, ay * s, az * s, Math.cos(h));
}

export function quatMul(a, b) {
  return quat(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  );
}

/** Applique un quaternion à un vecteur. */
export function quatRotate(q, v) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return v3(
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  );
}

/** Interpolation sphérique : lissage sans à-coups ni blocage de cardan. */
export function quatSlerp(a, b, t) {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (cos > 0.9995) {
    const r = quat(a.x + (bx - a.x) * t, a.y + (by - a.y) * t, a.z + (bz - a.z) * t, a.w + (bw - a.w) * t);
    const l = Math.hypot(r.x, r.y, r.z, r.w) || 1;
    return quat(r.x / l, r.y / l, r.z / l, r.w / l);
  }
  const theta = Math.acos(clamp(cos, -1, 1));
  const sin = Math.sin(theta);
  const k0 = Math.sin((1 - t) * theta) / sin;
  const k1 = Math.sin(t * theta) / sin;
  return quat(a.x * k0 + bx * k1, a.y * k0 + by * k1, a.z * k0 + bz * k1, a.w * k0 + bw * k1);
}

/**
 * Orientation de la caméra arrière à partir d'un événement deviceorientation.
 * Repère du jeu : Y vers le haut, -Z devant (cap nul = nord).
 * alpha/beta/gamma en radians, ecran = angle de rotation de l'écran en radians.
 */
export function cameraQuaternion(alpha, beta, gamma, ecran) {
  // Le capteur décrit l'écran ; on bascule de -90° autour de X pour viser
  // par l'arrière de l'appareil, puis on compense la rotation de l'écran.
  let q = quatFromEulerYXZ(beta, alpha, -gamma);
  q = quatMul(q, quat(-Math.SQRT1_2, 0, 0, Math.SQRT1_2));
  q = quatMul(q, quatFromAxisAngle(0, 0, 1, -ecran));
  return q;
}

export const vCross = (a, b) => v3(
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x,
);
