#!/usr/bin/env node
// Serveur local pour tester le jeu sur son téléphone, sans rien publier.
//
//   node outils/serveur.mjs            → HTTPS (certificat auto-signé), port 8443
//   node outils/serveur.mjs --http     → HTTP simple, port 8080
//   node outils/serveur.mjs --port 9000
//
// La caméra et les capteurs de mouvement exigent une origine sécurisée :
// sur un téléphone, seul le mode HTTPS donne accès à la réalité augmentée.
// Le certificat est auto-signé : le navigateur affichera un avertissement,
// qu'il faut accepter une fois (« Paramètres avancés » → « Continuer »).

import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CERT_DIR = join(ROOT, "outils", ".certificat");

const args = process.argv.slice(2);
const veutHttp = args.includes("--http");
const portArg = args.indexOf("--port");
const PORT = Number(portArg >= 0 ? args[portArg + 1] : veutHttp ? 8080 : 8443);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

/** Adresses IPv4 des interfaces réseau : ce que le téléphone doit viser. */
function adressesLocales() {
  const out = [];
  for (const [nom, liste] of Object.entries(networkInterfaces())) {
    for (const i of liste || []) {
      if (i.family === "IPv4" && !i.internal) out.push({ nom, adresse: i.address });
    }
  }
  return out;
}

async function existe(p) {
  try { await access(p); return true; } catch { return false; }
}

/** Certificat auto-signé, régénéré seulement s'il manque. */
async function certificat(ips) {
  const cle = join(CERT_DIR, "cle.pem");
  const cert = join(CERT_DIR, "cert.pem");
  if (await existe(cle) && await existe(cert)) {
    return { key: await readFile(cle), cert: await readFile(cert) };
  }

  await mkdir(CERT_DIR, { recursive: true });
  const san = ["DNS:localhost", "IP:127.0.0.1", ...ips.map((i) => "IP:" + i.adresse)].join(",");
  const conf = join(CERT_DIR, "openssl.cnf");
  await writeFile(conf, [
    "[req]", "distinguished_name = dn", "x509_extensions = ext", "prompt = no",
    "[dn]", "CN = guerre-des-tetes.local",
    "[ext]", "basicConstraints = critical,CA:false",
    "keyUsage = critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage = serverAuth",
    `subjectAltName = ${san}`,
  ].join("\n"));

  console.log("Génération d'un certificat auto-signé (une seule fois)…");
  await execFileP("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
    "-keyout", cle, "-out", cert, "-config", conf,
  ]);
  return { key: await readFile(cle), cert: await readFile(cert) };
}

function servir(req, res) {
  const url = new URL(req.url, "http://local");
  let chemin = decodeURIComponent(url.pathname);
  if (chemin === "/" || chemin.endsWith("/")) chemin += "index.html";

  // Empêche de sortir du dossier du jeu.
  const cible = join(ROOT, normalize(chemin).replace(/^(\.\.[/\\])+/, ""));
  if (!cible.startsWith(ROOT)) {
    res.writeHead(403).end("Accès refusé");
    return;
  }

  readFile(cible)
    .then((data) => {
      res.writeHead(200, {
        "Content-Type": TYPES[extname(cible).toLowerCase()] || "application/octet-stream",
        // Pas de cache : chaque rechargement sert la dernière version du code.
        "Cache-Control": "no-store",
      });
      res.end(data);
    })
    .catch(() => {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Introuvable : " + chemin);
    });
}

function annonce(protocole, ips) {
  const ligne = "─".repeat(52);
  console.log("\n" + ligne);
  console.log("  LA GUERRE DES TÊTES 2.0 — serveur local");
  console.log(ligne);
  console.log(`  Sur cet ordinateur : ${protocole}://localhost:${PORT}`);
  if (ips.length) {
    console.log("  Sur ton téléphone (même réseau Wi-Fi) :");
    for (const i of ips) console.log(`    ${protocole}://${i.adresse}:${PORT}   (${i.nom})`);
  } else {
    console.log("  Aucune adresse réseau détectée : vérifie le Wi-Fi.");
  }
  console.log(ligne);
  if (protocole === "https") {
    console.log("  Le certificat est auto-signé : le téléphone affichera un");
    console.log("  avertissement de sécurité. Accepte-le une fois, puis la");
    console.log("  caméra et le gyroscope fonctionneront normalement.");
  } else {
    console.log("  En HTTP, les navigateurs bloquent la caméra et les capteurs");
    console.log("  de mouvement hors de localhost : le jeu basculera sur le");
    console.log("  décor de secours et la visée au doigt.");
    console.log("  Relance sans --http pour la réalité augmentée complète.");
  }
  console.log(ligne);
  console.log("  Ctrl+C pour arrêter.\n");
}

const ips = adressesLocales();

if (veutHttp) {
  createHttp(servir).listen(PORT, "0.0.0.0", () => annonce("http", ips));
} else {
  try {
    const options = await certificat(ips);
    createHttps(options, servir).listen(PORT, "0.0.0.0", () => annonce("https", ips));
  } catch (err) {
    console.error("\nImpossible de créer le certificat HTTPS :", err.message);
    console.error("OpenSSL est-il installé ? Sinon, deux solutions :");
    console.error("  • node outils/serveur.mjs --http   (sans caméra ni gyroscope)");
    console.error("  • node outils/build-fichier-unique.mjs puis ouvrir le fichier");
    console.error("    hors-ligne/guerre-des-tetes.html sur le téléphone.\n");
    process.exit(1);
  }
}
