// Fabrique des « textures de visage » : capture caméra, import photo,
// masque circulaire et visages de secours dessinés par le code.

import { rand, pick, TAU } from "./util.js";
import { buildEquirect, buildAtlas, renderView, EQUI_W, EQUI_H } from "./head3d.js";

export const TEX_SIZE = 256;
export const CROP_SIZE = 192; // taille stockée (JPEG) : compromis qualité / quota localStorage

function makeCanvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

/** Géométrie du gabarit ovale affiché par-dessus la vidéo de capture. */
export function guideBox(stageW, stageH) {
  const s = Math.min(stageW, stageH);
  const side = s * 0.78;
  return { x: (stageW - side) / 2, y: (stageH - side) / 2, side };
}

/** Mappe un rectangle de l'élément affiché (object-fit: cover) vers les pixels source. */
function coverRect(srcW, srcH, boxW, boxH, rect) {
  const scale = Math.max(boxW / srcW, boxH / srcH);
  const dw = srcW * scale, dh = srcH * scale;
  const ox = (boxW - dw) / 2, oy = (boxH - dh) / 2;
  return {
    sx: (rect.x - ox) / scale,
    sy: (rect.y - oy) / scale,
    ss: rect.side / scale,
  };
}

/**
 * Découpe le carré du gabarit dans la vidéo ; renvoie un canvas carré.
 *
 * L'aperçu de la caméra frontale est retourné par CSS, par confort : on se
 * voit comme dans un miroir. Le flux, lui, arrive déjà dans le bon sens.
 * Le retourner à la capture donnait un portrait inversé — sans conséquence
 * pour une photo de face, mais désastreux pour le scan : les profils se
 * retrouvaient collés du mauvais côté du crâne.
 */
export function cropFromVideo(video, boxW, boxH) {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const { sx, sy, ss } = coverRect(vw, vh, boxW, boxH, guideBox(boxW, boxH));
  const out = makeCanvas(CROP_SIZE);
  out.getContext("2d").drawImage(video, sx, sy, ss, ss, 0, 0, CROP_SIZE, CROP_SIZE);
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

/* ------------------------------------------------------------------ */
/*  Têtes en relief                                                     */
/* ------------------------------------------------------------------ */

export const PORTRAIT = 256;

/**
 * Assemble une tête jouable à partir de prises de vue.
 * `equirect` est la seule chose à conserver : portrait et planche de
 * sprites s'en déduisent, et se reconstruisent au chargement en ~150 ms.
 */
export function buildHead(vues) {
  const equirect = buildEquirect(vues);
  return {
    equirect,
    tex: renderView(equirect, 0, 0, PORTRAIT),  // vue de face, pleine résolution
    atlas: null,                                 // construite à la demande
  };
}

/** La planche de sprites ne sert qu'aux têtes qui volent : on la bâtit tard. */
export function ensureAtlas(face) {
  if (!face.atlas && face.equirect) face.atlas = buildAtlas(face.equirect);
  return face.atlas;
}

export function equirectToDataURL(equirect) {
  return equirect.toDataURL("image/jpeg", 0.78);
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

/**
 * Tête de secours peinte directement en coordonnées longitude/latitude :
 * cheveux sur tout l'arrière, oreilles sur les côtés, traits devant. Bien
 * meilleur qu'une photo de face extrapolée, puisque rien n'est inventé.
 */
function drawDoodleEquirect(ctx, seed) {
  const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const skin = SKINS[Math.floor(R() * SKINS.length)];
  const hair = HAIRS[Math.floor(R() * HAIRS.length)];
  const W = EQUI_W, H = EQUI_H;
  // lon -PI..PI sur la largeur, lat +PI/2..-PI/2 sur la hauteur
  const X = (lon) => ((lon + Math.PI) / (Math.PI * 2)) * W;
  const Y = (lat) => (0.5 - lat / Math.PI) * H;
  const ellipse = (lon, lat, rlon, rlat, couleur) => {
    ctx.fillStyle = couleur;
    for (const d of [-Math.PI * 2, 0, Math.PI * 2]) {   // répétition pour traverser la couture
      ctx.beginPath();
      ctx.ellipse(X(lon + d), Y(lat), (rlon / (Math.PI * 2)) * W, (rlat / Math.PI) * H, 0, 0, TAU);
      ctx.fill();
    }
  };

  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, W, H);

  // Chevelure : calotte sur le haut, et tout l'arrière du crâne
  ctx.fillStyle = hair;
  ctx.fillRect(0, 0, W, Y(0.70 + R() * 0.12));
  ellipse(Math.PI, 0.14, 1.32, 0.92, hair);
  ellipse(0, 0.78, 1.4, 0.5, hair);

  // Oreilles, là où le profil les place
  for (const s of [-1, 1]) ellipse(s * 1.5, -0.02, 0.16, 0.22, skin);
  for (const s of [-1, 1]) ellipse(s * 1.5, -0.02, 0.09, 0.13, "rgba(0,0,0,.22)");

  // Yeux, sourcils, nez, bouche
  const ecart = 0.26 + R() * 0.05;
  for (const s of [-1, 1]) {
    ellipse(s * ecart, 0.1, 0.11, 0.075, "#fff");
    ellipse(s * ecart, 0.1, 0.05, 0.05, "#20242e");
    ctx.strokeStyle = hair;
    ctx.lineWidth = H * 0.028;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(X(s * ecart - 0.13), Y(0.24));
    ctx.lineTo(X(s * ecart + 0.13), Y(0.22 + R() * 0.05));
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.lineWidth = H * 0.02;
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0.06));
  ctx.lineTo(X(-0.05), Y(-0.16));
  ctx.lineTo(X(0.04), Y(-0.19));
  ctx.stroke();
  ctx.strokeStyle = "#8c3b3b";
  ctx.lineWidth = H * 0.03;
  ctx.beginPath();
  ctx.moveTo(X(-0.2), Y(-0.42));
  ctx.quadraticCurveTo(X(0), Y(-0.42 + (R() > 0.5 ? -0.09 : 0.06)), X(0.2), Y(-0.42));
  ctx.stroke();
}

/** Trois têtes « maison » utilisées tant que le joueur n'a rien photographié. */
export function defaultFaces() {
  const names = ["Recrue", "Sergent", "Vétéran"];
  return names.map((name, i) => {
    const equirect = makeCanvas(1);
    equirect.width = EQUI_W; equirect.height = EQUI_H;
    drawDoodleEquirect(equirect.getContext("2d"), 1234 + i * 7717);
    return {
      id: "default-" + i, name, saved: false, isDefault: true,
      equirect, tex: renderView(equirect, 0, 0, PORTRAIT), atlas: null,
    };
  });
}

/**
 * Charge les visages sauvegardés en têtes jouables.
 * Les visages d'avant le scan n'ont qu'une photo de face : ils deviennent
 * une tête à vue unique, dont l'arrière est extrapolé.
 */
export async function loadFaceTextures(saved) {
  const out = [];
  for (const f of saved) {
    try {
      if (f.scan) {
        const img = await loadImage(f.scan);
        const equirect = makeCanvas(1);
        equirect.width = img.width; equirect.height = img.height;
        equirect.getContext("2d").drawImage(img, 0, 0);
        out.push({
          id: f.id, name: f.name, saved: f.saved, scan: true,
          equirect, tex: renderView(equirect, 0, 0, PORTRAIT), atlas: null,
        });
      } else {
        const img = await loadImage(f.data);
        out.push({ id: f.id, name: f.name, saved: f.saved, crop: img, ...buildHead([{ image: img, lon: 0, lat: 0 }]) });
      }
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
