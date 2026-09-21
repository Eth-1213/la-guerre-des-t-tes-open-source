// Les neuf niveaux : six pour la campagne, trois « Montrer à un ami ».

export const LEVELS = [
  /* ---------------------- Campagne ---------------------- */
  {
    id: "e1", mode: "expert", name: "Premier contact",
    desc: "Une tête s'échappe de l'appareil photo. Tourne-toi : elle n'attaque jamais de face.",
    quota: 10, maxAlive: 3, spawnEvery: 1.6, speed: 0.9, aggro: 0.8,
    types: ["basic"], butterflies: 0.10, bombs: 0,
    boss: { hp: 3, volley: 2, minions: false },
  },
  {
    id: "e2", mode: "expert", name: "Vol en escadrille",
    desc: "Elles arrivent par grappes et changent d'altitude. Garde le réticule en mouvement.",
    quota: 14, maxAlive: 4, spawnEvery: 1.3, speed: 1.0, aggro: 1.0,
    types: ["basic", "basic", "fast"], butterflies: 0.12, bombs: 0.05,
    boss: { hp: 4, volley: 3, minions: false },
  },
  {
    id: "e3", mode: "expert", name: "Casques de fer",
    desc: "Certaines têtes portent un casque : un tir pour le faire sauter, un second pour la tête.",
    quota: 16, maxAlive: 4, spawnEvery: 1.2, speed: 1.05, aggro: 1.1,
    types: ["basic", "fast", "armor"], butterflies: 0.14, bombs: 0.10,
    boss: { hp: 5, volley: 3, minions: false },
  },
  {
    id: "e4", mode: "expert", name: "La nuée",
    desc: "Trop nombreuses pour être visées une à une : sers-toi des bombes.",
    quota: 22, maxAlive: 6, spawnEvery: 0.85, speed: 1.15, aggro: 1.2,
    types: ["basic", "fast", "fast", "armor"], butterflies: 0.16, bombs: 0.18,
    boss: { hp: 5, volley: 4, minions: true },
  },
  {
    id: "e5", mode: "expert", name: "Embuscade",
    desc: "Des cracheurs restent à distance et te bombardent. Abats leurs projectiles en vol.",
    quota: 24, maxAlive: 6, spawnEvery: 0.9, speed: 1.15, aggro: 1.15,
    types: ["basic", "fast", "armor", "spitter", "spitter"], butterflies: 0.16, bombs: 0.14,
    boss: { hp: 6, volley: 4, minions: true },
  },
  {
    id: "e6", mode: "expert", name: "La Grande Tête",
    desc: "Tout ce que tu as affronté, en même temps. Puis elle arrive.",
    quota: 28, maxAlive: 7, spawnEvery: 0.75, speed: 1.3, aggro: 1.35,
    types: ["basic", "fast", "armor", "spitter"], butterflies: 0.18, bombs: 0.16,
    boss: { hp: 8, volley: 5, minions: true },
  },

  /* ------------------ Montrer à un ami ------------------ */
  {
    id: "a1", mode: "ami", name: "Démonstration",
    desc: "Trente secondes pour comprendre : vise, tire, tourne.",
    quota: 8, maxAlive: 3, spawnEvery: 1.2, speed: 0.85, aggro: 0.7,
    types: ["basic"], butterflies: 0.2, bombs: 0.1, timeLimit: 45, boss: null,
  },
  {
    id: "a2", mode: "ami", name: "Chasse aux papillons",
    desc: "Les papillons rapportent gros… mais les têtes profitent de la distraction.",
    quota: 12, maxAlive: 4, spawnEvery: 1.4, speed: 1.0, aggro: 0.9,
    types: ["basic", "fast"], butterflies: 0.55, bombs: 0.08, timeLimit: 60, boss: null,
  },
  {
    id: "a3", mode: "ami", name: "Duel éclair",
    desc: "Pas d'échauffement : le boss, tout de suite.",
    quota: 4, maxAlive: 3, spawnEvery: 1.8, speed: 1.1, aggro: 1.2,
    types: ["fast"], butterflies: 0.25, bombs: 0.12,
    boss: { hp: 4, volley: 3, minions: false },
  },
];

export const byMode = (mode) => LEVELS.filter((l) => l.mode === mode);
export const byId = (id) => LEVELS.find((l) => l.id === id);
export const indexInMode = (level) => byMode(level.mode).findIndex((l) => l.id === level.id);
export const nextLevel = (level) => byMode(level.mode)[indexInMode(level) + 1] || null;

export const DIFFICULTY = {
  facile:  { speed: 0.82, aggro: 0.75, hearts: 5, damage: 1 },
  normal:  { speed: 1.00, aggro: 1.00, hearts: 4, damage: 1 },
  intense: { speed: 1.22, aggro: 1.35, hearts: 3, damage: 1 },
};
