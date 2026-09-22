// Fabrique des « textures de visage » : capture caméra, import photo,
// masque circulaire et visages de secours dessinés par le code.

import { rand, pick, TAU } from "./util.js";

const TEX_SIZE = 256;
const CROP_SIZE = 192; // taille stockée (JPEG) : compromis qualité / quota localStorage

function makeCanvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

/** Géométrie du gabarit ovale affiché par-dessus la vidéo de capture. */
function guideBox(stageW, stageH) {
  const s = Math.min(stageW, stageH);
  const side = s * 0.78;
  return { x: (stageW - side) / 2, y: (stageH - side) / 2, side };
}

/** Mappe un rectangle de l'élément affiché (object-fit: cover) vers les pixels source. */
function coverRect(srcW, srcH, boxW, boxH, rect, mirror) {
  const scale = Math.max(boxW / srcW, boxH / srcH);
  const dw = srcW * scale, dh = srcH * scale;
  const ox = (boxW - dw) / 2, oy = (boxH - dh) / 2;
  let sx = (rect.x - ox) / scale;
  const sy = (rect.y - oy) / scale;
  const ss = rect.side / scale;
  if (mirror) sx = srcW - sx - ss;
  return { sx, sy, ss };
}

/** Découpe le carré du gabarit dans la vidéo ; renvoie un canvas carré. */
export function cropFromVideo(video, boxW, boxH, mirror) {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const rect = guideBox(boxW, boxH);
  const { sx, sy, ss } = coverRect(vw, vh, boxW, boxH, rect, mirror);
  const out = makeCanvas(CROP_SIZE);
  const ctx = out.getContext("2d");
  ctx.save();
  if (mirror) { ctx.translate(CROP_SIZE, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, sx, sy, ss, ss, 0, 0, CROP_SIZE, CROP_SIZE);
  ctx.restore();
  return out;
}

/** Découpe une image importée selon un cadrage (zoom + déplacement). */
export function cropFromImage(img, view) {
  const out = makeCanvas(CROP_SIZE);
  const ctx = out.getContext("2d");
  const base = Math.min(img.width, img.height);
  const side = base / view.zoom;
  const cx = img.width / 2 + view.px * base;
  const cy = img.height / 2 + view.py * base;
  const sx = Math.max(0, Math.min(img.width - side, cx - side / 2));
  const sy = Math.max(0, Math.min(img.height - side, cy - side / 2));
  ctx.drawImage(img, sx, sy, side, side, 0, 0, CROP_SIZE, CROP_SIZE);
  return out;
}

export function toDataURL(canvas) {
  return canvas.toDataURL("image/jpeg", 0.74);
}

/**
 * Transforme un carré (canvas ou image) en tête ronde ombrée, prête à voler.
 * Le masque circulaire est réappliqué à chaque chargement : on ne stocke que le JPEG.
 */
export function makeTexture(src) {
  const c = makeCanvas(TEX_SIZE);
  const ctx = c.getContext("2d");
  const r = TEX_SIZE / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, TAU);
  ctx.clip();
  ctx.drawImage(src, 0, 0, TEX_SIZE, TEX_SIZE);

  // Volume : lumière en haut à gauche, ombre en bas à droite.
  const shade = ctx.createRadialGradient(r * 0.62, r * 0.55, r * 0.15, r, r, r);
  shade.addColorStop(0, "rgba(255,255,255,0.22)");
  shade.addColorStop(0.55, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  ctx.restore();

  // Double liseré : un reflet clair, puis le contour d'encre de l'habillage.
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(r, r, r - 7, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = "#25222b";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(r, r, r - 4, 0, TAU);
  ctx.stroke();
  return c;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------ */
/*  Visages de secours : le jeu est jouable avant toute photo.         */
/* ------------------------------------------------------------------ */

const SKINS = ["#f2c39b", "#d99a6c", "#a6693f", "#7a4a2b", "#ffd9b8", "#c98a5e"];
const HAIRS = ["#2b1d16", "#6b3f1d", "#1b1b22", "#8d5524", "#b3b3c6", "#c94f2e"];

function drawDoodleFace(ctx, size, seed) {
  const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const skin = SKINS[Math.floor(R() * SKINS.length)];
  const hair = HAIRS[Math.floor(R() * HAIRS.length)];
  const eyeY = size * (0.42 + R() * 0.05);
  const eyeDx = size * (0.15 + R() * 0.04);
  const eyeR = size * (0.045 + R() * 0.02);

  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, size, size);

  // Cheveux
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.ellipse(size / 2, size * 0.26, size * 0.42, size * 0.26, 0, 0, TAU);
  ctx.fill();

  // Yeux
  for (const s of [-1, 1]) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(size / 2 + s * eyeDx, eyeY, eyeR * 1.5, eyeR, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#20242e";
    ctx.beginPath();
    ctx.arc(size / 2 + s * eyeDx, eyeY, eyeR * 0.75, 0, TAU);
    ctx.fill();
  }

  // Sourcils
  ctx.strokeStyle = hair;
  ctx.lineWidth = size * 0.022;
  ctx.lineCap = "round";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(size / 2 + s * eyeDx - size * 0.06, eyeY - size * 0.075);
    ctx.lineTo(size / 2 + s * eyeDx + size * 0.06, eyeY - size * (0.055 + R() * 0.04));
    ctx.stroke();
  }

  // Nez
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.lineWidth = size * 0.018;
  ctx.beginPath();
  ctx.moveTo(size / 2, eyeY + size * 0.04);
  ctx.lineTo(size / 2 - size * 0.03, eyeY + size * 0.14);
  ctx.lineTo(size / 2 + size * 0.02, eyeY + size * 0.155);
  ctx.stroke();

  // Bouche
  ctx.strokeStyle = "#8c3b3b";
  ctx.lineWidth = size * 0.028;
  ctx.beginPath();
  const my = size * 0.72;
  ctx.moveTo(size / 2 - size * 0.12, my);
  ctx.quadraticCurveTo(size / 2, my + size * (R() > 0.5 ? 0.08 : -0.05), size / 2 + size * 0.12, my);
  ctx.stroke();
}

/** Trois têtes « maison » utilisées tant que le joueur n'a rien photographié. */
export function defaultFaces() {
  const names = ["Recrue", "Sergent", "Vétéran"];
  return names.map((name, i) => {
    const c = makeCanvas(CROP_SIZE);
    drawDoodleFace(c.getContext("2d"), CROP_SIZE, 1234 + i * 7717);
    return { id: "default-" + i, name, crop: c, tex: makeTexture(c), saved: false, isDefault: true };
  });
}

/**
 * Découpe la face avant d'une texture panoramique laissée par la version
 * en relief, pour que les visages déjà enregistrés ne disparaissent pas.
 */
function faceAvantDuPanorama(img) {
  const c = makeCanvas(CROP_SIZE);
  const W = img.width, H = img.height;
  // Longitudes -50°..+50° et latitudes -45°..+45° : le visage, sans le crâne.
  c.getContext("2d").drawImage(img, W * 0.361, H * 0.25, W * 0.278, H * 0.5,
    0, 0, CROP_SIZE, CROP_SIZE);
  return c;
}

/** Charge les visages sauvegardés en textures utilisables par le jeu. */
export async function loadFaceTextures(saved) {
  const out = [];
  for (const f of saved) {
    try {
      const img = await loadImage(f.data || f.scan);
      const crop = f.data ? img : faceAvantDuPanorama(img);
      out.push({ id: f.id, name: f.name, crop, tex: makeTexture(crop), saved: f.saved });
    } catch (err) {
      console.warn("Visage illisible ignoré :", f.id);
    }
  }
  return out;
}

/** Petite fantaisie clin d'œil à la 3DS : un « profil » tiré au sort, pas une analyse. */
export function funProfile() {
  return `${pick(["Sujet", "Cible", "Spécimen", "Individu"])} ${pick(["A", "B", "C", "D", "X"])}-${Math.floor(rand(10, 99))} · ` +
    `menace ${pick(["faible", "modérée", "élevée", "maximale"])}`;
}
