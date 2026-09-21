// Navigation entre écrans, HUD et listes (niveaux, visages).

import { formatScore } from "./util.js";
import { byMode, indexInMode } from "./levels.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let toastTimer = null;

export function showScreen(id) {
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  const el = id ? $("#" + id) : null;
  if (el) el.scrollTop = 0;
}

export function hideScreens() {
  $$(".screen").forEach((s) => s.classList.remove("active"));
}

export function currentScreen() {
  const el = $(".screen.active");
  return el ? el.id : null;
}

export function setHud(visible) {
  const hud = $("#hud");
  hud.classList.toggle("hidden", !visible);
  hud.setAttribute("aria-hidden", visible ? "false" : "true");
}

export function toast(msg, ms = 2200) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
}

/* ----------------------------- HUD ----------------------------- */

/** Cœur dessiné : même trait épais que le reste de l'habillage. */
const COEUR = (plein) =>
  `<svg class="heart ${plein ? "on" : "off"}" viewBox="0 0 24 24" aria-hidden="true">` +
  '<path d="M12 21.2C8.2 18.4 3 14.7 3 10.1 3 7.1 5.2 5 7.9 5c1.8 0 3.2 1 4.1 2.3C12.9 6 14.3 5 16.1 5 18.8 5 21 7.1 21 10.1c0 4.6-5.2 8.3-9 11.1z"/></svg>';

export const hud = {
  hearts({ hearts, max }) {
    const el = $("#hud-hearts");
    let out = "";
    for (let i = 0; i < max; i++) out += COEUR(i < hearts);
    el.innerHTML = out;
    el.setAttribute("aria-label", `${hearts} vies sur ${max}`);
  },
  score(v) { $("#hud-score").textContent = formatScore(v); },
  remaining(n) { $("#hud-remaining").textContent = "Têtes  " + n; },
  time(t) { $("#hud-remaining").textContent = "Temps  " + Math.ceil(t) + " s"; },
  level(label) { $("#hud-level").textContent = label; },
  combo(n) {
    const el = $("#combo");
    if (n > 1) {
      $("#combo-x").textContent = "x" + n;
      el.classList.remove("hidden");
      // relance l'animation
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
    } else {
      el.classList.add("hidden");
    }
  },
  boss(info) {
    const bar = $("#boss-bar");
    if (!info) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    $("#boss-bar-fill").style.width = Math.max(0, (info.hp / info.max) * 100) + "%";
  },
  crosshair(state) {
    const el = $("#crosshair");
    el.classList.toggle("lock", state === "lock");
    if (state === "shoot") {
      el.classList.add("shoot");
      setTimeout(() => el.classList.remove("shoot"), 90);
    }
  },
};

/* --------------------------- Niveaux --------------------------- */

export function renderLevels(mode, progress, onPick) {
  const list = $("#level-list");
  list.innerHTML = "";
  const unlocked = progress.unlocked[mode] || 1;

  byMode(mode).forEach((lvl) => {
    const idx = indexInMode(lvl);
    const locked = idx >= unlocked;
    const best = progress.best[lvl.id] || 0;
    const cleared = !!progress.cleared[lvl.id];

    const card = document.createElement("button");
    card.className = "level-card" + (locked ? " locked" : "");
    card.disabled = locked;
    card.innerHTML = `
      <span class="num">${locked ? "🔒" : idx + 1}</span>
      <span class="meta">
        <b>${lvl.name}${cleared ? " ✔" : ""}</b>
        <small>${locked ? "Termine le niveau précédent pour l'ouvrir." : lvl.desc}</small>
      </span>
      <span class="best">${best ? formatScore(best) : ""}</span>`;
    if (!locked) card.addEventListener("click", () => onPick(lvl));
    list.appendChild(card);
  });
}

/* --------------------------- Visages --------------------------- */

export function renderFaces(faces, { onDelete }) {
  const grid = $("#face-grid");
  grid.innerHTML = "";
  if (!faces.length) {
    grid.innerHTML = '<p class="face-empty">Aucun visage capturé.<br>Les têtes de secours prendront le relais.</p>';
    return;
  }
  faces.forEach((f) => {
    const cell = document.createElement("div");
    cell.className = "face-cell" + (f.saved ? " saved" : "");
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    cv.getContext("2d").drawImage(f.tex, 0, 0, 128, 128);
    const label = document.createElement("span");
    label.textContent = f.saved ? f.name + " ✔" : f.name;
    cell.append(cv, label);
    if (!f.isDefault) {
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.setAttribute("aria-label", "Supprimer " + f.name);
      del.addEventListener("click", () => onDelete(f));
      cell.appendChild(del);
    }
    grid.appendChild(cell);
  });
}

export function drawFaceInto(canvas, tex) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (tex) ctx.drawImage(tex, 0, 0, canvas.width, canvas.height);
}
