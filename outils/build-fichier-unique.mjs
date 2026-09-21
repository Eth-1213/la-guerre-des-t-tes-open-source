#!/usr/bin/env node
// Assemble tout le jeu (HTML + CSS + modules) dans un seul fichier .html,
// ouvrable directement depuis le téléphone, sans serveur ni connexion.
//
//   node outils/build-fichier-unique.mjs
//
// Les modules ES sont refusés par les navigateurs derrière une URL file://.
// On les enveloppe donc chacun dans une fonction et on remplace les imports
// par des lectures dans un petit registre, le tout dans un script classique.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SORTIE = join(ROOT, "hors-ligne", "guerre-des-tetes.html");

// Ordre de dépendances : chaque module ne dépend que des précédents.
const MODULES = [
  "util.js", "storage.js", "audio.js", "sensors.js", "head3d.js", "faces.js",
  "levels.js", "entities.js", "ui.js", "game.js", "main.js",
];

/** Relève les noms exportés puis retire les mots-clés `export`. */
function transformeExports(code) {
  const noms = new Set();

  for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    noms.add(m[1]);
  }
  // `export { A, B };`
  code = code.replace(/^export\s*\{([^}]*)\}\s*;?\s*$/gm, (_, liste) => {
    for (const part of liste.split(",")) {
      const nom = part.trim().split(/\s+as\s+/).pop().trim();
      if (nom) noms.add(nom);
    }
    return "";
  });
  code = code.replace(/^export\s+/gm, "");
  return { code, noms: [...noms] };
}

/** Remplace les imports par des lectures dans le registre de modules. */
function transformeImports(code) {
  // import * as N from "./x.js";
  code = code.replace(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']\.\/([^"']+)["']\s*;?\s*$/gm,
    (_, alias, fichier) => `const ${alias} = __modules[${JSON.stringify(fichier)}];`);
  // import { a, b as c } from "./x.js";
  code = code.replace(/^import\s*\{([^}]*)\}\s*from\s+["']\.\/([^"']+)["']\s*;?\s*$/gm, (_, liste, fichier) => {
    const paires = liste.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
      const [src, alias] = p.split(/\s+as\s+/).map((x) => x.trim());
      return alias ? `${src}: ${alias}` : src;
    });
    return `const { ${paires.join(", ")} } = __modules[${JSON.stringify(fichier)}];`;
  });
  return code;
}

function construitScript() {
  const morceaux = [
    "/* La Guerre des Têtes 2.0 — version fichier unique, générée par outils/build-fichier-unique.mjs */",
    '"use strict";',
    "const __modules = {};",
  ];

  for (const fichier of MODULES) {
    const brut = readFileSync(join(ROOT, "src", fichier), "utf8");
    const { code, noms } = transformeExports(brut);
    const corps = transformeImports(code);
    morceaux.push(
      `__modules[${JSON.stringify(fichier)}] = (function () {\n${corps}\n` +
      `return { ${noms.join(", ")} };\n})();`
    );
  }
  return morceaux.join("\n\n");
}

function construitHtml() {
  let html = readFileSync(join(ROOT, "index.html"), "utf8");
  const css = readFileSync(join(ROOT, "styles.css"), "utf8");
  const icone = readFileSync(join(ROOT, "assets", "icon.svg"), "utf8");
  const script = construitScript();

  // Remplacements par fonction : sinon `$$` et `$&` seraient interprétés
  // comme des références de capture et mutileraient le code injecté.
  html = html
    .replace('<link rel="manifest" href="manifest.webmanifest">\n', () => "")
    .replace('<link rel="icon" href="assets/icon.svg" type="image/svg+xml">',
      () => `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(icone).toString("base64")}">`)
    .replace('<link rel="apple-touch-icon" href="assets/icon.svg">\n', () => "")
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${script}\n</script>`);

  return html;
}

const html = construitHtml();
mkdirSync(dirname(SORTIE), { recursive: true });
writeFileSync(SORTIE, html);
console.log(`Fichier unique écrit : ${SORTIE} (${(html.length / 1024).toFixed(0)} Ko)`);
console.log("Copie-le sur ton téléphone et ouvre-le : aucun serveur n'est nécessaire.");
