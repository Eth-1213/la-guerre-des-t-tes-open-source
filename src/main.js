// Point d'entrée : assemble capteurs, visages, écrans et boucle de jeu.

import * as store from "./storage.js";
import * as audio from "./audio.js";
import { sfx } from "./audio.js";
import { Orientation, CameraFeed } from "./sensors.js";
import * as F from "./faces.js";
import { SCAN_STEPS, BALAYAGE_MAX, tileFor } from "./head3d.js";
import { Game } from "./game.js";
import { LEVELS, indexInMode, nextLevel } from "./levels.js";
import { $, $$, showScreen, hideScreens, setHud, toast, hud, renderLevels, renderFaces, drawFaceInto } from "./ui.js";
import { clamp, wrapAngle, TAU } from "./util.js";

store.load();
const settings = store.settings();
audio.setEnabled(settings.sound);
audio.setVibrate(settings.vibrate);

// Ouvert par double-clic depuis le système de fichiers : les navigateurs
// interdisent la caméra sur une URL file://, on le dit plutôt que d'échouer.
const FICHIER_LOCAL = location.protocol === "file:";

const video = $("#world-video");
const scene = $("#scene");
const orientation = new Orientation();
const feed = new CameraFeed(video);
const captureFeed = new CameraFeed($("#capture-video"));

const game = new Game({ canvas: scene, radar: $("#radar"), orientation, settings });

let faces = [];          // visages jouables (sauvegardés + secours)
let currentLevel = null;
let lastResult = null;
let wakeLock = null;
let levelMode = "expert";

/* ------------------------------------------------------------------ */
/*  Visages                                                            */
/* ------------------------------------------------------------------ */

async function refreshFaces() {
  const saved = await F.loadFaceTextures(store.faces());
  faces = saved.length ? saved : F.defaultFaces();
  renderFaces(faces, { onDelete: onDeleteFace });
}

function onDeleteFace(face) {
  if (face.isDefault) return;
  store.removeFace(face.id);
  sfx.ui();
  refreshFaces();
}

/* ------------------------------------------------------------------ */
/*  Navigation                                                         */
/* ------------------------------------------------------------------ */

$$("[data-go]").forEach((btn) => {
  btn.addEventListener("click", () => {
    audio.unlock();
    sfx.ui();
    const target = btn.dataset.go;
    if (target === "screen-levels") renderLevels(levelMode, store.progress(), openReady);
    if (target === "screen-faces") refreshFaces();
    showScreen(target);
  });
});

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    levelMode = tab.dataset.mode;
    $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    renderLevels(levelMode, store.progress(), openReady);
    sfx.ui();
  });
});

/* ------------------------------------------------------------------ */
/*  Lancement d'un niveau                                              */
/* ------------------------------------------------------------------ */

function openReady(level) {
  currentLevel = level;
  $("#ready-title").textContent = `${level.mode === "ami" ? "Démo" : "Niveau"} ${indexInMode(level) + 1} — ${level.name}`;
  $("#ready-desc").textContent = level.desc;
  const holder = $("#ready-face");
  holder.innerHTML = "";
  faces.slice(0, 5).forEach((f) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 132;
    drawFaceInto(cv, f.tex);
    holder.appendChild(cv);
  });
  $("#ready-perm").textContent = FICHIER_LOCAL
    ? "Fichier local : la caméra est indisponible ici. Décor de secours et visée au doigt."
    : settings.camera
      ? "Le jeu va demander l'accès à la caméra et aux capteurs de mouvement."
      : "Mode sans caméra : glisse le doigt pour tourner la vue.";
  showScreen("screen-ready");
}

$("#btn-ready-back").addEventListener("click", () => {
  sfx.ui();
  renderLevels(levelMode, store.progress(), openReady);
  showScreen("screen-levels");
});

$("#btn-start-level").addEventListener("click", async () => {
  audio.unlock();
  sfx.ui();
  await startLevel(currentLevel);
});

async function startLevel(level) {
  if (!level) return;
  currentLevel = level;

  // Plein écran : gagne la place des barres de navigation sur mobile.
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    }
  } catch (err) { /* facultatif */ }

  // Gyroscope
  const granted = await orientation.requestPermission();
  orientation.sensitivity = settings.sensitivity / 100;
  orientation.invertY = settings.invertY;
  if (granted) orientation.acquire("partie");

  // Caméra arrière
  let camOk = false;
  if (settings.camera && !FICHIER_LOCAL) {
    camOk = await feed.start("environment");
    video.classList.toggle("on", camOk);
    if (!camOk) toast("Caméra indisponible\u00a0: décor de secours activé.", 3200);
  } else {
    video.classList.remove("on");
  }

  await requestWakeLock();

  hideScreens();
  setHud(true);
  hud.level(`${level.mode === "ami" ? "Démo" : "Niveau"} ${indexInMode(level) + 1} · ${level.name}`);
  game.load(level, faces, camOk);
  orientation.recenterWhenReady();
  game.start();

  if (!orientation.hasGyro) {
    setTimeout(() => {
      if (!orientation.hasGyro) toast("Pas de gyroscope\u00a0: glisse le doigt pour tourner la vue.", 3600);
    }, 1200);
  } else {
    toast("Tourne sur toi-même : elles arrivent de partout !", 2600);
  }
}

function stopPlaying() {
  game.stop();
  feed.stop();
  video.classList.remove("on");
  orientation.release("partie");
  releaseWakeLock();
  setHud(false);
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (err) { /* non critique */ }
}
function releaseWakeLock() {
  if (wakeLock) { try { wakeLock.release(); } catch (e) { /* ignoré */ } wakeLock = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.running && !game.paused) doPause();
  else if (!document.hidden && wakeLock === null && game.running) requestWakeLock();
});

/* ------------------------------------------------------------------ */
/*  HUD et événements de jeu                                           */
/* ------------------------------------------------------------------ */

game.on("hearts", hud.hearts);
game.on("score", hud.score);
game.on("combo", hud.combo);
game.on("boss", hud.boss);
game.on("remaining", (n) => { if (!currentLevel || !currentLevel.timeLimit) hud.remaining(n); });
let lastShownSecond = -1;
game.on("time", (t) => {
  const s = Math.ceil(t);
  if (s !== lastShownSecond) { lastShownSecond = s; hud.time(t); }
});
game.on("toast", (m) => toast(m));
game.on("lock", (v) => hud.crosshair(v ? "lock" : ""));
game.on("shot", () => hud.crosshair("shoot"));
game.on("end", onLevelEnd);

/* ------------------------------------------------------------------ */
/*  Tir                                                                */
/* ------------------------------------------------------------------ */

function isUiTarget(el) {
  return !!(el && el.closest && el.closest("button, input, label, select, .screen"));
}

window.addEventListener("pointerdown", (e) => {
  if (!game.running || game.paused) return;
  if (isUiTarget(e.target)) return;
  if (settings.touchAim) game.shoot(e.clientX, e.clientY);
  else game.shoot();
});

$("#btn-fire").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (game.running && !game.paused) game.shoot();
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && game.running && !game.paused) { e.preventDefault(); game.shoot(); }
  if (e.code === "Escape" && game.running && !game.paused) doPause();
});

orientation.attachDrag(document.body);

/* ------------------------------------------------------------------ */
/*  Pause                                                              */
/* ------------------------------------------------------------------ */

function doPause() {
  if (!game.running) return;
  game.pause();
  showScreen("screen-pause");
}

$("#btn-pause").addEventListener("click", () => { sfx.ui(); doPause(); });
$("#btn-resume").addEventListener("click", () => {
  sfx.ui();
  hideScreens();
  game.resume();
});
$("#btn-recenter").addEventListener("click", () => {
  orientation.recenter();
  sfx.ui();
  toast("Vue recentrée.");
});
$("#btn-restart").addEventListener("click", () => {
  sfx.ui();
  hideScreens();
  game.load(currentLevel, faces, game.useCameraFeed);
  orientation.recenter();
  game.start();
});
$("#btn-quit").addEventListener("click", () => {
  sfx.ui();
  stopPlaying();
  renderLevels(levelMode, store.progress(), openReady);
  showScreen("screen-levels");
});

/* ------------------------------------------------------------------ */
/*  Fin de niveau                                                      */
/* ------------------------------------------------------------------ */

function onLevelEnd(res) {
  lastResult = res;
  stopPlaying();

  const level = res.level;
  store.recordResult(level.id, res.score, res.won);

  const messages = { boss: "Grande Tête vaincue !", quota: "Zone nettoyée !", temps: "Temps écoulé", vie: "Tu as été submergé" };
  $("#result-title").textContent = res.won ? messages[res.reason] || "Niveau terminé" : messages[res.reason] || "Partie perdue";
  $("#result-score").textContent = res.score.toLocaleString("fr-FR");
  $("#result-combo").textContent = "x" + res.bestCombo;
  $("#result-acc").textContent = res.accuracy + " %";
  $("#result-best").textContent = (store.progress().best[level.id] || 0).toLocaleString("fr-FR");
  drawFaceInto($("#result-portrait"), res.face ? res.face.tex : null);

  const unlockBox = $("#result-unlock");
  const notes = [];

  if (res.won) {
    const next = nextLevel(level);
    if (next && store.unlock(level.mode, indexInMode(next) + 1)) {
      notes.push(`Niveau débloqué : ${next.name}`);
    }
    // Vaincre le boss « sauve » le visage utilisé, comme sur 3DS.
    if (res.reason === "boss" && res.face && !res.face.isDefault && store.markFaceSaved(res.face.id)) {
      res.face.saved = true;
      notes.push(`Visage sauvé : ${res.face.name}`);
    }
    if (level.mode === "expert" && !nextLevel(level)) {
      notes.push("Campagne terminée ! Les démos « Montrer à un ami » t'attendent.");
    }
  }

  unlockBox.classList.toggle("hidden", notes.length === 0);
  unlockBox.innerHTML = notes.map((n) => `<div>🏅 ${n}</div>`).join("");
  $("#btn-next").classList.toggle("hidden", !(res.won && nextLevel(level)));
  showScreen("screen-result");
}

$("#btn-next").addEventListener("click", async () => {
  sfx.ui();
  const next = nextLevel(lastResult.level);
  if (next) await startLevel(next);
});
$("#btn-replay").addEventListener("click", async () => {
  sfx.ui();
  await startLevel(lastResult.level);
});
$("#btn-result-menu").addEventListener("click", () => {
  sfx.ui();
  showScreen("screen-title");
});

/* ------------------------------------------------------------------ */
/*  Capture de visage                                                  */
/* ------------------------------------------------------------------ */

const capVideo = $("#capture-video");
const capPreview = $("#capture-preview");
const capStage = $(".capture-stage");
let capFacing = "user";
let pendingCrop = null;         // canvas carré prêt à être enregistré
let importImage = null;         // image en cours de cadrage
const importView = { zoom: 1.2, px: 0, py: 0 };

// Scan en relief. Deux modes : balayage continu quand le gyroscope mesure
// vraiment l'angle de prise de vue, trois poses supposées sinon.
const scan = {
  actif: false, mode: null, etape: 0, vues: [], tete: null, apercu: 0, anim: null,
  boucle: null, lon0: 0, lat0: 0, dernierLon: 0, dernierT: 0, vitesse: 0,
  capPrec: 0, calme: 0,
};

const CASES_ARC = 26;                 // découpage de l'arc de couverture
const PAS_ECHANTILLON = 0.13;         // ~7,5° entre deux prises
const VITESSE_MAX = 1.6;              // rad/s : au-delà, l'image est filée
const VUES_MAX = 26;

async function openCapture() {
  audio.unlock();
  showScreen("screen-capture");
  resetCaptureUi();
  const ok = await captureFeed.start(capFacing);
  capVideo.classList.toggle("mirror", capFacing === "user");
  if (!ok) {
    $("#capture-hint").textContent = "Caméra inaccessible. Utilise « Importer une photo ».";
    $("#btn-shutter").disabled = true;
  }
}

function resetCaptureUi() {
  pendingCrop = null;
  importImage = null;
  scan.actif = false;
  scan.mode = null;
  scan.vues.length = 0;
  scan.tete = null;
  if (scan.anim) { cancelAnimationFrame(scan.anim); scan.anim = null; }
  if (scan.boucle) { cancelAnimationFrame(scan.boucle); scan.boucle = null; }
  $("#scan-bar").classList.add("hidden");
  $("#sweep-controls").classList.add("hidden");
  $("#scan-arc").classList.add("hidden");
  $("#scan-dots").classList.remove("hidden");
  $("#capture-heading").textContent = "Aligne le visage";
  capPreview.classList.remove("on");
  $("#capture-confirm").classList.add("hidden");
  $("#capture-controls").classList.remove("hidden");
  $("#import-controls").classList.add("hidden");
  $("#capture-count").classList.add("hidden");
  $("#btn-shutter").disabled = false;
  $("#btn-face-save").textContent = "Garder ce visage";
  $("#capture-hint").textContent = "Place les yeux et le nez sur les repères, puis capture.";
}

function closeCapture() {
  captureFeed.stop();
  orientation.release("scan");
  resetCaptureUi();
  refreshFaces();
  showScreen("screen-faces");
}

$("#btn-new-face").addEventListener("click", () => { sfx.ui(); openCapture(); });
$("#btn-scan-face").addEventListener("click", () => { sfx.ui(); ouvrirScan(); });
$("#capture-back").addEventListener("click", () => { sfx.ui(); closeCapture(); });
$("#btn-capture-cancel").addEventListener("click", () => { sfx.ui(); closeCapture(); });

$("#btn-switch-cam").addEventListener("click", async () => {
  sfx.ui();
  capFacing = capFacing === "user" ? "environment" : "user";
  const ok = await captureFeed.start(capFacing);
  capVideo.classList.toggle("mirror", ok && capFacing === "user");
});

$("#btn-shutter").addEventListener("click", async () => {
  if (!captureFeed.ready) { toast("La caméra n'est pas prête."); return; }
  if (scan.actif) { await prendreVueScan(); return; }
  const count = $("#capture-count");
  count.classList.remove("hidden");
  for (let i = 3; i > 0; i--) {
    count.textContent = i;
    sfx.ui();
    await wait(650);
  }
  count.classList.add("hidden");
  sfx.shutter();
  const rect = capStage.getBoundingClientRect();
  pendingCrop = F.cropFromVideo(capVideo, rect.width, rect.height);
  showCropPreview();
});

function showCropPreview() {
  const rect = capStage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  capPreview.width = Math.round(rect.width * dpr);
  capPreview.height = Math.round(rect.height * dpr);
  const ctx = capPreview.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#05060d";
  ctx.fillRect(0, 0, rect.width, rect.height);
  const tex = F.makeTexture(pendingCrop);
  const size = Math.min(rect.width, rect.height) * 0.72;
  ctx.drawImage(tex, (rect.width - size) / 2, (rect.height - size) / 2, size, size);
  capPreview.classList.add("on");
  $("#capture-controls").classList.add("hidden");
  $("#import-controls").classList.add("hidden");
  $("#capture-confirm").classList.remove("hidden");
  $("#capture-hint").textContent = F.funProfile();
}

$("#btn-face-retry").addEventListener("click", async () => {
  sfx.ui();
  if (scan.tete || scan.actif) { resetCaptureUi(); await ouvrirScan(); return; }
  if (importImage) { resetCaptureUi(); startImportFraming(importImage); return; }
  resetCaptureUi();
  if (!captureFeed.stream) await captureFeed.start(capFacing);
});

$("#btn-face-save").addEventListener("click", () => {
  if (scan.tete) {
    const face = store.addFace(F.equirectToDataURL(scan.tete.equirect), "Visage " + (store.faces().length + 1), true);
    sfx.heal();
    toast(`${face.name} scanné et enrôlé dans la guerre des têtes.`, 2800);
    closeCapture();
    return;
  }
  if (!pendingCrop) return;
  const face = store.addFace(F.toDataURL(pendingCrop), "Visage " + (store.faces().length + 1));
  sfx.heal();
  toast(`${face.name} enrôlé dans la guerre des têtes.`, 2600);
  closeCapture();
});

/* ---- Scan en relief ---- */

async function ouvrirScan() {
  audio.unlock();
  showScreen("screen-capture");
  resetCaptureUi();
  scan.actif = true;
  scan.etape = 0;
  $("#capture-heading").textContent = "Scan en relief";
  $("#scan-bar").classList.remove("hidden");

  // Le gyroscope mesure réellement sous quel angle chaque image est prise ;
  // sans lui on retombe sur des poses supposées, forcément approximatives.
  const accorde = await orientation.requestPermission();
  if (accorde) orientation.acquire("scan");
  await wait(350);
  scan.mode = orientation.hasGyro ? "balayage" : "poses";

  const ok = await captureFeed.start(capFacing);
  capVideo.classList.toggle("mirror", ok && capFacing === "user");
  if (!ok) {
    $("#capture-hint").textContent = "Caméra inaccessible : le scan a besoin de l'appareil photo.";
    $("#btn-shutter").disabled = true;
    return;
  }
  if (scan.mode === "balayage") demarrerBalayage();
  else majEtapeScan();
}

/* --- Mode mesuré : un seul geste continu --- */

function demarrerBalayage() {
  scan.vues.length = 0;
  scan.lon0 = null;
  scan.dernierT = performance.now();
  scan.vitesse = 0;
  scan.calme = 0;
  scan.capPrec = null;
  $("#scan-arc").classList.remove("hidden");
  $("#scan-dots").classList.add("hidden");
  $("#capture-controls").classList.add("hidden");
  $("#sweep-controls").classList.remove("hidden");
  $("#scan-title").textContent = "Balaie autour du visage";
  $("#scan-help").textContent = "Garde la tête immobile et promène lentement le téléphone d'une oreille à l'autre, visage dans l'ovale.";
  $("#capture-hint").textContent = "C'est le téléphone qui tourne, pas la tête : c'est ainsi que l'angle est mesuré.";
  scan.boucle = requestAnimationFrame(tourBalayage);
}

function tourBalayage(now) {
  if (!scan.actif || scan.mode !== "balayage") return;
  const dt = Math.min(0.1, Math.max(0.001, (now - scan.dernierT) / 1000));
  scan.dernierT = now;
  orientation.update(dt);

  if (scan.lon0 === null) {
    // La toute première image définit le « droit devant » et sert de
    // référence d'exposition : la prendre en plein mouvement fausserait
    // tout le balayage. On attend donc que le téléphone soit posé.
    const cap = orientation.yaw;
    const bouge = scan.capPrec === null ? 1 : Math.abs(wrapAngle(cap - scan.capPrec)) / dt;
    scan.capPrec = cap;
    scan.calme = bouge < 0.25 ? scan.calme + dt : 0;
    $("#capture-hint").textContent = scan.calme > 0
      ? "Ne bouge plus…"
      : "Place le visage dans l'ovale et immobilise le téléphone.";
    if (scan.calme > 0.4) {
      scan.lon0 = cap;
      scan.lat0 = orientation.pitch;
      scan.dernierLon = 0;
      $("#capture-hint").textContent = "C'est le téléphone qui tourne, pas la tête : c'est ainsi que l'angle est mesuré.";
      echantillonner(0, 0);
    }
    dessinerArc(0);
  } else {
    const lon = wrapAngle(orientation.yaw - scan.lon0);
    const lat = -(orientation.pitch - scan.lat0);
    scan.vitesse = Math.abs(wrapAngle(lon - scan.dernierLon)) / dt;
    const assezLoin = scan.vues.every((v) => Math.abs(wrapAngle(v.lon - lon)) >= PAS_ECHANTILLON);
    if (assezLoin && Math.abs(lon) <= BALAYAGE_MAX && Math.abs(lat) <= 0.7
        && scan.vitesse < VITESSE_MAX && scan.vues.length < VUES_MAX) {
      echantillonner(lon, clamp(lat, -0.6, 0.6));
    }
    scan.dernierLon = lon;
    dessinerArc(lon);
  }
  scan.boucle = requestAnimationFrame(tourBalayage);
}

function echantillonner(lon, lat) {
  const rect = capStage.getBoundingClientRect();
  scan.vues.push({ image: F.cropFromVideo(capVideo, rect.width, rect.height), lon, lat });
  sfx.ui();
  dessinerArc(lon);
  majBoutonBalayage();
}

/** Assez de matière pour reconstruire ? Il faut de l'étendue, pas du nombre. */
function couvertureBalayage() {
  if (scan.vues.length < 2) return { cases: 0, etendue: 0, pret: false };
  const lons = scan.vues.map((v) => v.lon);
  const etendue = Math.max(...lons) - Math.min(...lons);
  const cases = new Set(scan.vues.map((v) => Math.round((v.lon / BALAYAGE_MAX) * (CASES_ARC / 2)))).size;
  return { cases, etendue, pret: scan.vues.length >= 7 && etendue >= 1.0 };
}

function majBoutonBalayage() {
  const { pret, etendue } = couvertureBalayage();
  const btn = $("#btn-sweep-done");
  btn.disabled = !pret;
  btn.textContent = pret
    ? `Reconstruire (${scan.vues.length} vues)`
    : `Continue à balayer… ${Math.round((etendue * 180) / Math.PI)}°`;
}

function dessinerArc(lonActuel) {
  const c = $("#scan-arc");
  const ctx = c.getContext("2d");
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H - 8, R = H - 20;

  const vues = new Set(scan.vues.map((v) => Math.round((v.lon / BALAYAGE_MAX) * (CASES_ARC / 2))));
  for (let k = -CASES_ARC / 2; k <= CASES_ARC / 2; k++) {
    const lon = (k / (CASES_ARC / 2)) * BALAYAGE_MAX;
    const a = -Math.PI / 2 + lon * 0.92;
    const x = cx + Math.sin(a + Math.PI / 2) * 0 + Math.cos(a) * R;
    const y = cy + Math.sin(a) * R;
    const fait = vues.has(k);
    ctx.beginPath();
    ctx.arc(x, y, fait ? 6 : 4, 0, TAU);
    ctx.fillStyle = fait ? "#e63b2e" : "#f6e6ca";
    ctx.strokeStyle = "#25222b";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  }

  // Position actuelle du téléphone sur l'arc
  const a = -Math.PI / 2 + clamp(lonActuel, -BALAYAGE_MAX, BALAYAGE_MAX) * 0.92;
  ctx.beginPath();
  ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 11, 0, TAU);
  ctx.strokeStyle = scan.vitesse > VITESSE_MAX ? "#e63b2e" : "#25222b";
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = "#25222b";
  ctx.font = '700 13px ui-rounded, "Trebuchet MS", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(scan.vitesse > VITESSE_MAX ? "moins vite" : `${scan.vues.length} vues`, cx, cy - 6);
}

$("#btn-sweep-done").addEventListener("click", async () => {
  if (!couvertureBalayage().pret) return;
  sfx.ui();
  if (scan.boucle) { cancelAnimationFrame(scan.boucle); scan.boucle = null; }
  $("#sweep-controls").classList.add("hidden");
  await reconstruireScan();
});
$("#btn-sweep-cancel").addEventListener("click", () => { sfx.ui(); closeCapture(); });

/* --- Repli sans gyroscope : trois poses --- */

function majEtapeScan() {
  const etape = SCAN_STEPS[scan.etape];
  $("#scan-arc").classList.add("hidden");
  $("#scan-dots").classList.remove("hidden");
  $("#scan-title").textContent = `${scan.etape + 1}/${SCAN_STEPS.length} · ${etape.titre}`;
  $("#scan-help").textContent = etape.aide;
  $("#capture-hint").textContent = "Sans gyroscope, les angles sont supposés : tiens la pose au plus près.";
  $("#scan-dots").innerHTML = SCAN_STEPS
    .map((_, i) => `<i class="${i < scan.etape ? "fait" : i === scan.etape ? "en-cours" : ""}"></i>`)
    .join("");
}

async function prendreVueScan() {
  const count = $("#capture-count");
  count.classList.remove("hidden");
  for (let i = 3; i > 0; i--) {
    count.textContent = i;
    sfx.ui();
    await wait(600);
  }
  count.classList.add("hidden");
  sfx.shutter();

  const rect = capStage.getBoundingClientRect();
  const etape = SCAN_STEPS[scan.etape];
  scan.vues.push({
    image: F.cropFromVideo(capVideo, rect.width, rect.height),
    lon: etape.lon,
    lat: etape.lat,
  });

  scan.etape++;
  if (scan.etape < SCAN_STEPS.length) { majEtapeScan(); return; }
  await reconstruireScan();
}

/* --- Reconstruction, commune aux deux modes --- */

async function reconstruireScan() {
  const voile = document.createElement("div");
  voile.className = "scan-progress";
  voile.textContent = "Reconstruction de la tête…";
  capStage.appendChild(voile);
  await wait(50);   // laisse le voile s'afficher avant de bloquer le fil

  scan.tete = F.buildHead(scan.vues);
  F.ensureAtlas(scan.tete);
  captureFeed.stop();
  orientation.release("scan");
  voile.remove();

  $("#scan-bar").classList.add("hidden");
  $("#capture-controls").classList.add("hidden");
  $("#sweep-controls").classList.add("hidden");
  $("#capture-confirm").classList.remove("hidden");
  $("#btn-face-save").textContent = "Garder cette tête";
  $("#capture-hint").textContent = scan.mode === "balayage"
    ? `Tête reconstruite depuis ${scan.vues.length} vues, angles mesurés au gyroscope.`
    : `Tête reconstruite depuis ${scan.vues.length} poses.`;
  animerApercu();
}

/** Aperçu : la tête tourne, pour montrer que le relief est bien là. */
function animerApercu() {
  const rect = capStage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  capPreview.width = Math.round(rect.width * dpr);
  capPreview.height = Math.round(rect.height * dpr);
  const ctx = capPreview.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  capPreview.classList.add("on");

  const taille = Math.min(rect.width, rect.height) * 0.76;
  const boucle = () => {
    if (!scan.tete) return;
    scan.apercu += 0.018;
    ctx.fillStyle = "#10131c";
    ctx.fillRect(0, 0, rect.width, rect.height);
    const lon = Math.sin(scan.apercu) * 1.5;
    const lat = Math.sin(scan.apercu * 0.6) * 0.35;
    const t = tileFor(scan.tete.atlas, lon, lat);
    ctx.drawImage(scan.tete.atlas.canvas, t.sx, t.sy, t.size, t.size,
      (rect.width - taille) / 2, (rect.height - taille * 1.12) / 2, taille, taille * 1.12);
    scan.anim = requestAnimationFrame(boucle);
  };
  boucle();
}

/* ---- Import depuis la galerie ---- */

$("#file-face").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const url = await F.readFile(file);
    const img = await F.loadImage(url);
    showScreen("screen-capture");
    captureFeed.stop();
    resetCaptureUi();
    startImportFraming(img);
  } catch (err) {
    toast("Image illisible.");
  }
});

function startImportFraming(img) {
  importImage = img;
  importView.zoom = 1.2; importView.px = 0; importView.py = 0;
  capVideo.classList.remove("mirror");
  $("#capture-controls").classList.add("hidden");
  $("#import-controls").classList.remove("hidden");
  $("#capture-confirm").classList.remove("hidden");
  $("#btn-face-save").textContent = "Garder ce cadrage";
  $("#capture-hint").textContent = "Cadre le visage : glisse pour déplacer, le curseur pour zoomer.";
  $("#import-zoom").value = String(Math.round(importView.zoom * 100));
  drawImportPreview();
}

function drawImportPreview() {
  if (!importImage) return;
  pendingCrop = F.cropFromImage(importImage, importView);
  const rect = capStage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  capPreview.width = Math.round(rect.width * dpr);
  capPreview.height = Math.round(rect.height * dpr);
  const ctx = capPreview.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#05060d";
  ctx.fillRect(0, 0, rect.width, rect.height);
  const size = Math.min(rect.width, rect.height) * 0.78;
  ctx.drawImage(pendingCrop, (rect.width - size) / 2, (rect.height - size) / 2, size, size);
  // Aperçu de la tête finale, en petit
  const tex = F.makeTexture(pendingCrop);
  const mini = size * 0.32;
  ctx.drawImage(tex, rect.width - mini - 12, 12, mini, mini);
  capPreview.classList.add("on");
}

$("#import-zoom").addEventListener("input", (e) => {
  importView.zoom = Number(e.target.value) / 100;
  drawImportPreview();
});

let importDrag = null;
capPreview.addEventListener("pointerdown", (e) => {
  if (!importImage) return;
  importDrag = { x: e.clientX, y: e.clientY };
  capPreview.setPointerCapture(e.pointerId);
});
capPreview.addEventListener("pointermove", (e) => {
  if (!importDrag || !importImage) return;
  const rect = capStage.getBoundingClientRect();
  const k = 1 / (Math.min(rect.width, rect.height) * importView.zoom);
  importView.px = clamp(importView.px - (e.clientX - importDrag.x) * k, -0.5, 0.5);
  importView.py = clamp(importView.py - (e.clientY - importDrag.y) * k, -0.5, 0.5);
  importDrag = { x: e.clientX, y: e.clientY };
  drawImportPreview();
});
capPreview.addEventListener("pointerup", () => { importDrag = null; });
capPreview.addEventListener("pointercancel", () => { importDrag = null; });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/*  Réglages                                                           */
/* ------------------------------------------------------------------ */

function bindSettings() {
  const sens = $("#set-sens"), inv = $("#set-inverty"), touchAim = $("#set-touchaim");
  const cam = $("#set-camera"), snd = $("#set-sound"), vib = $("#set-vibrate"), diff = $("#set-difficulty");

  sens.value = settings.sensitivity;
  inv.checked = settings.invertY;
  touchAim.checked = settings.touchAim;
  cam.checked = settings.camera;
  snd.checked = settings.sound;
  vib.checked = settings.vibrate;
  diff.value = settings.difficulty;

  sens.addEventListener("input", () => {
    store.setSetting("sensitivity", Number(sens.value));
    orientation.sensitivity = Number(sens.value) / 100;
  });
  inv.addEventListener("change", () => {
    store.setSetting("invertY", inv.checked);
    orientation.invertY = inv.checked;
  });
  touchAim.addEventListener("change", () => store.setSetting("touchAim", touchAim.checked));
  cam.addEventListener("change", () => store.setSetting("camera", cam.checked));
  snd.addEventListener("change", () => {
    store.setSetting("sound", snd.checked);
    audio.setEnabled(snd.checked);
    if (snd.checked) { audio.unlock(); sfx.ui(); }
  });
  vib.addEventListener("change", () => {
    store.setSetting("vibrate", vib.checked);
    audio.setVibrate(vib.checked);
    if (vib.checked) audio.vibrate(40);
  });
  diff.addEventListener("change", () => store.setSetting("difficulty", diff.value));
}

$("#btn-reset").addEventListener("click", () => {
  if (!confirm("Effacer la progression, les réglages et les visages ?")) return;
  store.reset();
  location.reload();
});

/* ------------------------------------------------------------------ */
/*  Diagnostic du gyroscope                                            */
/* ------------------------------------------------------------------ */

// Des repères fixes dans la pièce : s'ils bougent alors que le téléphone ne
// bouge pas, le capteur dérive ; s'ils tiennent, ce sont les têtes qui volent.
const diag = { actif: false, last: 0, capDepart: null, jitter: 0, capPrec: 0, fenetre: 0, pics: [] };

async function ouvrirTestGyro() {
  audio.unlock();
  showScreen("screen-gyro");
  const accorde = await orientation.requestPermission();
  if (accorde) orientation.acquire("diagnostic");
  if (settings.camera && !FICHIER_LOCAL) {
    const ok = await feed.start("environment");
    video.classList.toggle("on", ok);
  }
  diag.actif = true;
  diag.last = performance.now();
  diag.capDepart = null;
  diag.pics.length = 0;
  requestAnimationFrame(boucleDiag);
}

function fermerTestGyro() {
  diag.actif = false;
  feed.stop();
  video.classList.remove("on");
  orientation.release("diagnostic");
  game.ctx.clearRect(0, 0, game.W, game.H);
  showScreen("screen-settings");
}

function boucleDiag(now) {
  if (!diag.actif) return;
  const dt = Math.min(0.05, Math.max(0, (now - diag.last) / 1000));
  diag.last = now;

  orientation.update(dt);
  const cam = game.cam;
  cam.yaw = orientation.yaw;
  cam.pitch = orientation.pitch;
  if (orientation.hasGyro) cam.setBasis(orientation.right, orientation.up, orientation.fwd);
  else cam.update();

  // Tremblement : plus grand écart de cap observé sur la dernière seconde.
  const capDeg = (orientation.yaw * 180) / Math.PI;
  let d = Math.abs(capDeg - diag.capPrec);
  if (d > 180) d = 360 - d;
  diag.capPrec = capDeg;
  diag.pics.push(d);
  if (diag.pics.length > 60) diag.pics.shift();
  diag.jitter = Math.max(...diag.pics);
  if (diag.capDepart === null && orientation.hasGyro) diag.capDepart = capDeg;

  dessineReperes();

  diag.fenetre += dt;
  if (diag.fenetre > 0.2) {
    diag.fenetre = 0;
    const src = orientation.source
      ? `${orientation.source}${orientation.autresSources.size ? " (autre ignorée)" : ""}`
      : "aucune — visée au doigt";
    $("#gyro-source").textContent = src;
    $("#gyro-rate").textContent = orientation.hasGyro ? orientation.frequence.toFixed(0) + " Hz" : "—";
    $("#gyro-angles").textContent = `${capDeg.toFixed(0)}°  /  ${((orientation.pitch * 180) / Math.PI).toFixed(0)}°  /  ${((orientation.roll * 180) / Math.PI).toFixed(0)}°`;
    $("#gyro-jitter").textContent = orientation.hasGyro ? diag.jitter.toFixed(2) + "°" : "—";
    if (diag.capDepart === null) $("#gyro-drift").textContent = "—";
    else {
      let dd = capDeg - diag.capDepart;
      if (dd > 180) dd -= 360; else if (dd < -180) dd += 360;
      $("#gyro-drift").textContent = dd.toFixed(1) + "°";
    }
  }
  requestAnimationFrame(boucleDiag);
}

function dessineReperes() {
  const ctx = game.ctx, W = game.W, H = game.H, cam = game.cam;
  ctx.clearRect(0, 0, W, H);
  // Sans caméra, le décor de repli sert de référence spatiale.
  if (!feed.ready) game.drawRoom();
  const out = {};
  const points = [];
  const cardinaux = { 0: "DEVANT", 90: "DROITE", 180: "DERRIÈRE", 270: "GAUCHE" };

  // Huit piquets sur l'horizon, tous les 45°
  for (let d = 0; d < 360; d += 45) {
    const a = (d * Math.PI) / 180;
    for (const h of [-1.4, 0, 1.4]) {
      const p = cam.project({ x: Math.sin(a) * 8, y: h, z: -Math.cos(a) * 8 }, out);
      if (p) points.push({ p: { x: p.x, y: p.y, scale: p.scale }, cardinal: h === 0 ? cardinaux[d] : null, gros: d % 90 === 0 });
    }
  }

  // Ligne d'horizon
  ctx.strokeStyle = "rgba(230,59,46,0.85)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  let amorce = false;
  for (let d = 0; d <= 72; d++) {
    const a = ((d * 5) * Math.PI) / 180;
    const p = cam.project({ x: Math.sin(a) * 8, y: 0, z: -Math.cos(a) * 8 }, out);
    if (!p) { amorce = false; continue; }
    if (!amorce) { ctx.moveTo(p.x, p.y); amorce = true; } else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  for (const { p, cardinal, gros } of points) {
    const r = Math.max(3, (gros ? 0.16 : 0.1) * p.scale);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = gros ? "#ffc93c" : "#ffffff";
    ctx.strokeStyle = "#25222b";
    ctx.lineWidth = Math.max(2, r * 0.4);
    ctx.fill();
    ctx.stroke();
    if (cardinal) {
      const s = Math.max(12, Math.min(30, 0.1 * p.scale));
      ctx.font = `700 ${s}px ui-rounded, "SF Pro Rounded", "Trebuchet MS", sans-serif`;
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(3, s * 0.3);
      ctx.strokeStyle = "#25222b";
      ctx.strokeText(cardinal, p.x, p.y - r - 8);
      ctx.fillStyle = "#ffc93c";
      ctx.fillText(cardinal, p.x, p.y - r - 8);
    }
  }
}

$("#btn-gyro-test").addEventListener("click", () => { sfx.ui(); ouvrirTestGyro(); });
$("#gyro-back").addEventListener("click", () => { sfx.ui(); fermerTestGyro(); });
$("#gyro-recenter").addEventListener("click", () => {
  orientation.recenter();
  diag.capDepart = null;
  sfx.ui();
});

/* ------------------------------------------------------------------ */
/*  Démarrage                                                          */
/* ------------------------------------------------------------------ */

async function boot() {
  bindSettings();
  orientation.sensitivity = settings.sensitivity / 100;
  orientation.invertY = settings.invertY;
  await refreshFaces();
  renderLevels(levelMode, store.progress(), openReady);
  showScreen("screen-title");

  if (FICHIER_LOCAL) {
    const note = document.createElement("p");
    note.className = "footnote";
    note.innerHTML = "Version hors ligne : le navigateur interdit la caméra sur un fichier local.<br>" +
      "Tu joues avec le décor de secours et la visée au doigt. Pour la réalité augmentée complète, " +
      "lance le serveur HTTPS local (voir le README).";
    $("#screen-title").appendChild(note);
  }

  // Le gyroscope n'est lu qu'en jeu, mais on détecte sa présence pour l'aide.
  // La sonde ne doit couper les capteurs que si personne ne s'en sert : une
  // partie ou le diagnostic ouverts entre-temps gardent la main.
  if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission !== "function") {
    orientation.acquire("sonde");
    setTimeout(() => orientation.release("sonde"), 2500);
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

// Point d'accès pour le débogage et les tests automatisés.
window.GDT = { game, orientation, store, levels: LEVELS, faces: () => faces, startLevel, scan };

document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("dblclick", (e) => e.preventDefault());

boot();
