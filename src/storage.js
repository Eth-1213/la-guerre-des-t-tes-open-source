// Sauvegarde locale : réglages, progression, collection de visages.

const KEY = "gdt2:save:v1";

const DEFAULTS = {
  settings: {
    sensitivity: 120,     // % appliqué au balayage tactile (le gyroscope reste 1:1)
    invertY: false,
    touchAim: false,      // tirer là où le doigt touche plutôt qu'au réticule
    camera: true,
    sound: true,
    vibrate: true,
    difficulty: "normal",
  },
  progress: {
    unlocked: { expert: 1, ami: 1 },  // nombre de niveaux ouverts par mode
    best: {},                          // id de niveau -> meilleur score
    cleared: {},                       // id de niveau -> true
  },
  faces: [],   // { id, name, data (dataURL), saved, created }
};

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function merge(base, over) {
  const out = deepClone(base);
  if (!over || typeof over !== "object") return out;
  for (const k of Object.keys(base)) {
    const b = base[k], o = over[k];
    if (o === undefined) continue;
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? merge(b, o) : o;
  }
  return out;
}

let state = deepClone(DEFAULTS);

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = merge(DEFAULTS, JSON.parse(raw));
  } catch (err) {
    console.warn("Sauvegarde illisible, remise à zéro.", err);
    state = deepClone(DEFAULTS);
  }
  return state;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    // Quota dépassé : on sacrifie les plus vieux visages plutôt que de tout perdre.
    console.warn("Sauvegarde impossible, purge des visages les plus anciens.", err);
    while (state.faces.length > 1) {
      state.faces.shift();
      try { localStorage.setItem(KEY, JSON.stringify(state)); return; } catch (e) { /* on continue */ }
    }
  }
}

export const get = () => state;
export const settings = () => state.settings;
export const progress = () => state.progress;
export const faces = () => state.faces;

export function setSetting(key, value) {
  state.settings[key] = value;
  save();
}

export function addFace(dataURL, name) {
  const face = {
    id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name || "Visage " + (state.faces.length + 1),
    data: dataURL,
    saved: false,
    created: Date.now(),
  };
  state.faces.push(face);
  if (state.faces.length > 12) state.faces.shift(); // limite raisonnable pour localStorage
  save();
  return face;
}

export function removeFace(id) {
  state.faces = state.faces.filter((f) => f.id !== id);
  save();
}

export function markFaceSaved(id) {
  const f = state.faces.find((x) => x.id === id);
  if (f && !f.saved) { f.saved = true; save(); return true; }
  return false;
}

export function recordResult(levelId, score, cleared) {
  const p = state.progress;
  if (!p.best[levelId] || score > p.best[levelId]) p.best[levelId] = Math.round(score);
  if (cleared) p.cleared[levelId] = true;
  save();
}

export function unlock(mode, count) {
  const p = state.progress;
  if (count > (p.unlocked[mode] || 0)) { p.unlocked[mode] = count; save(); return true; }
  return false;
}

export function reset() {
  state = deepClone(DEFAULTS);
  try { localStorage.removeItem(KEY); } catch (e) { /* rien à faire */ }
}
