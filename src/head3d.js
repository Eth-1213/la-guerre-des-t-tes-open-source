// Reconstruction d'une tête en relief à partir de plusieurs prises de vue.
//
// Le web n'expose aucun capteur de profondeur : impossible de mesurer la
// géométrie réelle d'un visage. On fait donc ce que faisaient les studios
// avant la photogrammétrie : on plaque plusieurs photos prises sous des
// angles connus sur une tête modèle, en mélangeant chaque vue là où elle
// regarde la surface de face. Le résultat est une vraie tête orientable,
// que l'on précalcule en planche de sprites pour rester fluide au rendu.
//
// Repère de la tête : X vers sa droite, Y vers le haut, nez vers -Z.

import { TAU, clamp } from "./util.js";

export const EQUI_W = 320;   // longitude : -180° … +180°
export const EQUI_H = 160;   // latitude : +90° … -90°

export const ATLAS = { tile: 96, yawN: 18, pitchN: 3, pitchMax: 0.7 };

/**
 * Proportions d'une tête humaine, rapportées à la moitié de sa hauteur :
 * plus étroite que haute, et plus profonde que large. Une sphère déformait
 * les traits dès qu'on s'écartait de la vue de face.
 */
export const RAYONS = { x: 0.76, y: 1.08, z: 0.95 };

/** Part du visage occupée par le gabarit ovale, dans le carré capturé. */
const REMPLISSAGE_X = 0.74;
const REMPLISSAGE_Y = 0.94;

/**
 * Repli sans gyroscope : trois poses seulement. Les angles y sont supposés,
 * donc le résultat dépend de la docilité du modèle — c'est précisément ce
 * que le balayage mesuré évite.
 */
export const SCAN_STEPS = [
  { lon: 0, lat: 0, titre: "Bien en face", aide: "Regarde l'objectif, visage centré dans l'ovale." },
  { lon: 0.85, lat: 0, titre: "Trois quarts gauche", aide: "Tourne la tête vers ta gauche, sans bouger le téléphone." },
  { lon: -0.85, lat: 0, titre: "Trois quarts droit", aide: "Et de l'autre côté." },
];

/** Amplitude utile d'un balayage : au-delà, la caméra ne voit plus le visage. */
export const BALAYAGE_MAX = 1.65;

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

/** Direction de l'observateur, dans le repère de la tête. */
function direction(lon, lat) {
  const cl = Math.cos(lat);
  return { x: Math.sin(lon) * cl, y: Math.sin(lat), z: -Math.cos(lon) * cl };
}

/** Point de la surface de la tête à (lon, lat). */
function surface(lon, lat) {
  const cl = Math.cos(lat);
  return {
    x: RAYONS.x * Math.sin(lon) * cl,
    y: RAYONS.y * Math.sin(lat),
    z: -RAYONS.z * Math.cos(lon) * cl,
  };
}

/** Normale géométrique en un point de l'ellipsoïde. */
function normaleEn(p) {
  return normalise({
    x: p.x / (RAYONS.x * RAYONS.x),
    y: p.y / (RAYONS.y * RAYONS.y),
    z: p.z / (RAYONS.z * RAYONS.z),
  });
}

/**
 * Demi-largeur de la silhouette dans une direction donnée de l'écran :
 * fonction d'appui de l'ellipsoïde. Elle vaut exactement le bord de la
 * silhouette, donc le cadrage colle au gabarit ovale quel que soit l'angle.
 */
function demiEtendue(axe) {
  return Math.hypot(RAYONS.x * axe.x, RAYONS.y * axe.y, RAYONS.z * axe.z);
}

const croix = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const normalise = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/**
 * Repère de l'observateur placé à (lon, lat), exprimé dans celui de la tête.
 * Un seul calcul pour la projection des photos et pour le rendu des tuiles :
 * c'est là que se logent les erreurs de signe, autant n'en avoir qu'une copie.
 */
function viewBasis(lon, lat) {
  const d = direction(lon, lat);                       // tête → observateur
  const f = { x: -d.x, y: -d.y, z: -d.z };             // regard de l'observateur
  const r = normalise(croix(f, { x: 0, y: 1, z: 0 })); // droite de l'image
  const u = croix(r, f);                               // haut de l'image
  return { d, f, r, u, demiL: demiEtendue(r), demiH: demiEtendue(u) };
}

/* ------------------------------------------------------------------ */
/*  1. Texture équirectangulaire, mélangée depuis les vues             */
/* ------------------------------------------------------------------ */

/**
 * @param {Array<{image: CanvasImageSource, lon: number, lat: number}>} vues
 * @returns {HTMLCanvasElement} texture longitude/latitude de la tête
 */
export function buildEquirect(vues) {
  const N = 192;
  const sources = vues.map((v) => {
    const c = canvas(N, N);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(v.image, 0, 0, N, N);
    const base = viewBasis(v.lon, v.lat);
    return { data: ctx.getImageData(0, 0, N, N).data, base, gain: 1 };
  });

  // Les caméras réajustent leur exposition à chaque angle : sans correction,
  // la tête reconstruite est zébrée de bandes claires et sombres.
  harmoniserExposition(sources, N);

  // Beaucoup de vues : chacune peut régner sur une bande étroite, le rendu
  // gagne en netteté. Peu de vues : il faut mélanger largement.
  const durete = vues.length > 10 ? 7 : vues.length > 5 ? 4 : 3;
  const seuil = vues.length > 10 ? 0.55 : 0.42;

  const total = EQUI_W * EQUI_H;
  const somme = new Float32Array(total * 3);
  const poids = new Float32Array(total);

  for (let j = 0; j < EQUI_H; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / EQUI_H) * Math.PI;
    for (let i = 0; i < EQUI_W; i++) {
      const lon = ((i + 0.5) / EQUI_W) * TAU - Math.PI;
      const p = surface(lon, lat);
      const n = normaleEn(p);
      const idx = j * EQUI_W + i;

      for (const src of sources) {
        const { d, r, u, demiL, demiH } = src.base;
        const face = n.x * d.x + n.y * d.y + n.z * d.z;
        if (face <= seuil) continue;              // trop rasant : on y capte le décor
        const w = Math.pow(face, durete);

        const sx = (p.x * r.x + p.y * r.y + p.z * r.z) / demiL;
        const sy = (p.x * u.x + p.y * u.y + p.z * u.z) / demiH;
        const ui = (0.5 + (sx * REMPLISSAGE_X) / 2) * N;
        const vi = (0.5 - (sy * REMPLISSAGE_Y) / 2) * N;
        if (ui < 0 || vi < 0 || ui >= N || vi >= N) continue;
        const q = ((vi | 0) * N + (ui | 0)) * 4;
        somme[idx * 3] += src.data[q] * src.gain * w;
        somme[idx * 3 + 1] += src.data[q + 1] * src.gain * w;
        somme[idx * 3 + 2] += src.data[q + 2] * src.gain * w;
        poids[idx] += w;
      }
    }
  }

  const out = canvas(EQUI_W, EQUI_H);
  const ctx = out.getContext("2d");
  const img = ctx.createImageData(EQUI_W, EQUI_H);
  for (let k = 0; k < total; k++) {
    const w = poids[k];
    if (w > 0) {
      img.data[k * 4] = somme[k * 3] / w;
      img.data[k * 4 + 1] = somme[k * 3 + 1] / w;
      img.data[k * 4 + 2] = somme[k * 3 + 2] / w;
      img.data[k * 4 + 3] = 255;
    }
  }
  comblerTrous(img, poids);
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Aligne la luminosité de chaque vue sur celle de la première. */
function harmoniserExposition(sources, N) {
  const luminance = (data) => {
    let somme = 0, n = 0;
    const r = N * 0.28;
    for (let y = N / 2 - r; y < N / 2 + r; y += 3) {
      for (let x = N / 2 - r; x < N / 2 + r; x += 3) {
        const p = ((y | 0) * N + (x | 0)) * 4;
        somme += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        n++;
      }
    }
    return n ? somme / n : 1;
  };
  const reference = luminance(sources[0].data);
  for (const src of sources) {
    const l = luminance(src.data);
    src.gain = l > 1 ? clamp(reference / l, 0.72, 1.4) : 1;
  }
}

/**
 * L'arrière du crâne n'est jamais photographié. Plutôt que d'interpoler
 * entre les deux bords — ce qui laissait une couture franche et des traînées —
 * on replie la zone vue vers l'intérieur du trou, en l'assombrissant
 * progressivement : les couleurs se raccordent, et ça passe pour une nuque.
 */
function comblerTrous(img, poids) {
  const rempli = new Uint8Array(EQUI_W * EQUI_H);

  for (let j = 0; j < EQUI_H; j++) {
    const base = j * EQUI_W;
    let premier = -1, dernier = -1;
    for (let i = 0; i < EQUI_W; i++) {
      if (poids[base + i] > 0.001) { if (premier < 0) premier = i; dernier = i; }
    }
    if (premier < 0) {
      for (let i = 0; i < EQUI_W; i++) {
        const p = (base + i) * 4;
        img.data[p] = 58; img.data[p + 1] = 50; img.data[p + 2] = 46; img.data[p + 3] = 255;
        rempli[base + i] = 1;
      }
      continue;
    }

    for (let i = 0; i < EQUI_W; i++) {
      if (poids[base + i] > 0.001) continue;
      const dA = (i - dernier + EQUI_W) % EQUI_W;     // distance au bord droit vu
      const dB = (premier - i + EQUI_W) % EQUI_W;     // distance au bord gauche vu
      // Repli : on relit la zone vue en s'éloignant du bord
      const src = dA <= dB
        ? clamp(dernier - dA, premier, dernier)
        : clamp(premier + dB, premier, dernier);
      const t = Math.min(dA, dB) / ((dA + dB) / 2 || 1);
      const fondu = t * t * (3 - 2 * t);               // adoucissement aux deux bouts
      const ombre = 0.9 - 0.45 * fondu;
      const ps = (base + src) * 4, p = (base + i) * 4;
      for (let c = 0; c < 3; c++) img.data[p + c] = img.data[ps + c] * ombre;
      img.data[p + 3] = 255;
      rempli[base + i] = 1;
    }
  }

  // Flou horizontal sur la seule zone reconstruite : efface les traînées
  // du repli sans toucher au visage.
  for (let passe = 0; passe < 2; passe++) {
    const copie = new Uint8ClampedArray(img.data);
    for (let j = 0; j < EQUI_H; j++) {
      const base = j * EQUI_W;
      for (let i = 0; i < EQUI_W; i++) {
        if (!rempli[base + i]) continue;
        const p = (base + i) * 4;
        for (let c = 0; c < 3; c++) {
          let somme = 0;
          for (let k = -2; k <= 2; k++) {
            const ii = (i + k + EQUI_W) % EQUI_W;
            somme += copie[(base + ii) * 4 + c];
          }
          img.data[p + c] = somme / 5;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  2. Planche de sprites : la tête vue sous tous les angles           */
/* ------------------------------------------------------------------ */

/**
 * Lance un rayon par pixel sur une sphère : pas de triangles, pas de
 * coutures, et c'est assez rapide pour être recalculé au chargement.
 */
function lireTexture(equirect) {
  const src = document.createElement("canvas");
  src.width = EQUI_W; src.height = EQUI_H;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(equirect, 0, 0, EQUI_W, EQUI_H);
  return sctx.getImageData(0, 0, EQUI_W, EQUI_H).data;
}

/** Une seule vue, à la taille voulue : portraits, boss, aperçu tournant. */
export function renderView(equirect, lon, lat, taille) {
  const tex = lireTexture(equirect);
  const out = canvas(taille, taille);
  const ctx = out.getContext("2d");
  const img = ctx.createImageData(taille, taille);
  rendreTuile(img, tex, lon, lat, taille, taille / 2);
  ctx.putImageData(img, 0, 0);
  return out;
}

export function buildAtlas(equirect) {
  const { tile, yawN, pitchN, pitchMax } = ATLAS;
  const tex = lireTexture(equirect);

  const out = canvas(tile * yawN, tile * pitchN);
  const octx = out.getContext("2d");
  const img = octx.createImageData(tile, tile);
  const half = tile / 2;

  for (let pj = 0; pj < pitchN; pj++) {
    const lat = pitchN === 1 ? 0 : -pitchMax + (pj / (pitchN - 1)) * 2 * pitchMax;
    for (let yi = 0; yi < yawN; yi++) {
      const lon = (yi / yawN) * TAU - Math.PI;
      rendreTuile(img, tex, lon, lat, tile, half);
      octx.putImageData(img, yi * tile, pj * tile);
    }
  }
  return { canvas: out, tile, yawN, pitchN, pitchMax };
}

function rendreTuile(img, tex, lon, lat, tile, half) {
  const { d, r, u, demiL, demiH } = viewBasis(lon, lat);

  // Lumière fixe dans le repère de l'observateur : haut, gauche, devant
  const lx = -0.45 * r.x + 0.55 * u.x + 0.75 * d.x;
  const ly = -0.45 * r.y + 0.55 * u.y + 0.75 * d.y;
  const lz = -0.45 * r.z + 0.55 * u.z + 0.75 * d.z;
  const ll = Math.hypot(lx, ly, lz) || 1;

  // Rayon parallèle : direction constante, seule l'origine bouge.
  const Dx = d.x / RAYONS.x, Dy = d.y / RAYONS.y, Dz = d.z / RAYONS.z;
  const DD = Dx * Dx + Dy * Dy + Dz * Dz;

  const data = img.data;
  data.fill(0);

  for (let py = 0; py < tile; py++) {
    const y = (half - 0.5 - py) / (half - 2);
    for (let px = 0; px < tile; px++) {
      const x = (px + 0.5 - half) / (half - 2);
      const o = (py * tile + px) * 4;

      // Point du plan de l'image, ramené à l'échelle de la silhouette
      const ax = x * demiL * r.x + y * demiH * u.x;
      const ay = x * demiL * r.y + y * demiH * u.y;
      const az = x * demiL * r.z + y * demiH * u.z;
      const Ax = ax / RAYONS.x, Ay = ay / RAYONS.y, Az = az / RAYONS.z;

      const AD = Ax * Dx + Ay * Dy + Az * Dz;
      const disc = AD * AD - DD * (Ax * Ax + Ay * Ay + Az * Az - 1);
      if (disc < 0) continue;                         // hors silhouette
      const t = (-AD + Math.sqrt(disc)) / DD;         // face tournée vers nous

      const sx = ax + t * d.x, sy = ay + t * d.y, sz = az + t * d.z;
      const n = normaleEn({ x: sx, y: sy, z: sz });

      const tlon = Math.atan2(sx / RAYONS.x, -sz / RAYONS.z);
      const tlat = Math.asin(clamp(sy / RAYONS.y, -1, 1));
      const tu = clamp(Math.floor(((tlon + Math.PI) / TAU) * EQUI_W), 0, EQUI_W - 1);
      const tv = clamp(Math.floor((0.5 - tlat / Math.PI) * EQUI_H), 0, EQUI_H - 1);
      const tp = (tv * EQUI_W + tu) * 4;

      const diffus = (n.x * lx + n.y * ly + n.z * lz) / ll;
      const eclat = 0.62 + 0.45 * Math.max(0, diffus);

      // Distance au bord de la silhouette, 0 au centre et 1 sur le contour
      const bord = Math.sqrt(clamp(1 - disc / DD, 0, 1));
      if (bord > 0.9) {
        const k = clamp((bord - 0.9) / 0.1, 0, 1);
        data[o] = 0x25 * k + tex[tp] * eclat * (1 - k);
        data[o + 1] = 0x22 * k + tex[tp + 1] * eclat * (1 - k);
        data[o + 2] = 0x2b * k + tex[tp + 2] * eclat * (1 - k);
      } else {
        data[o] = tex[tp] * eclat;
        data[o + 1] = tex[tp + 1] * eclat;
        data[o + 2] = tex[tp + 2] * eclat;
      }
      data[o + 3] = 255 * clamp((1 - bord) * (half - 2), 0, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  3. Utilisation au rendu                                            */
/* ------------------------------------------------------------------ */

/** Tuile la plus proche de la direction d'observation demandée. */
export function tileFor(atlas, lon, lat) {
  const { tile, yawN, pitchN, pitchMax } = atlas;
  let yi = Math.round((((lon + Math.PI) % TAU) / TAU) * yawN) % yawN;
  if (yi < 0) yi += yawN;
  const pj = pitchN === 1 ? 0
    : Math.round(((clamp(lat, -pitchMax, pitchMax) + pitchMax) / (2 * pitchMax)) * (pitchN - 1));
  return { sx: yi * tile, sy: pj * tile, size: tile };
}

/**
 * Direction sous laquelle un observateur placé en `vers` voit une tête
 * dont le nez pointe vers (yaw, pitch). Renvoie longitude et latitude.
 */
export function viewAngles(faceYaw, facePitch, vers) {
  const cy = Math.cos(faceYaw), sy = Math.sin(faceYaw);
  const cp = Math.cos(facePitch), sp = Math.sin(facePitch);
  const fwd = { x: sy * cp, y: sp, z: -cy * cp };
  const right = { x: cy, y: 0, z: sy };
  const up = {
    x: right.y * fwd.z - right.z * fwd.y,
    y: right.z * fwd.x - right.x * fwd.z,
    z: right.x * fwd.y - right.y * fwd.x,
  };
  const dx = vers.x * right.x + vers.y * right.y + vers.z * right.z;
  const dy = vers.x * up.x + vers.y * up.y + vers.z * up.z;
  const dz = -(vers.x * fwd.x + vers.y * fwd.y + vers.z * fwd.z);
  return { lon: Math.atan2(dx, -dz), lat: Math.asin(clamp(dy, -1, 1)) };
}
