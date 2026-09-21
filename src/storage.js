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

/**
 * Fusionne la sauvegarde sur les valeurs par défaut.
 * L'union des clés est nécessaire : `best` et `cleared` sont des
 * dictionnaires vides par défaut, dont tout le contenu est dynamique.
 */
function merge(base, over) {
  if (base === null || typeof base !== "object" || Array.isArray(base)) {
    return over === undefined ? deepClone(base) : over;
  }
  const out = {};
  const surcharge = over && typeof over === "object" ? over : {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(surcharge)])) {
    const b = base[k], o = surcharge[k];
    if (o === undefined) out[k] = deepClone(b);
    else if (b && typeof b === "object" && !Array.isArray(b)) out[k] = merge(b, o);
    else out[k] = o;
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
