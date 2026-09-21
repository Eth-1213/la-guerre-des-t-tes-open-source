# La Guerre des Têtes 2.0

Une relecture pour téléphone de **Face Raiders** (« La Guerre des Têtes »), le jeu de tir en
réalité augmentée préinstallé sur les consoles Nintendo 3DS.

Tu photographies un visage, il devient la tête d'ennemis volants qui traversent les murs de
ta pièce. Tu vises en **bougeant réellement ton téléphone** (gyroscope), sur 360°, avec le flux
de la caméra arrière comme décor. Chaque niveau se termine par une **Grande Tête** coiffée d'un
kabuto dont la gemme frontale est le point faible.

Tout tient dans une page web : ni moteur de jeu, ni dépendance, ni build. HTML, CSS et
JavaScript modules, un canvas 2D avec sa propre projection 3D, et des sons synthétisés à la volée.

## Tester sans rien publier

Le jeu a besoin d'une **origine sécurisée** (HTTPS ou `localhost`) pour accéder à la caméra et
aux capteurs de mouvement : c'est une règle des navigateurs, pas du jeu. Deux façons de tester
sur ton téléphone sans mettre quoi que ce soit en ligne.

### 1. Serveur HTTPS local — réalité augmentée complète

Sur un ordinateur relié au **même Wi-Fi** que le téléphone :

```bash
npm start          # ou : node outils/serveur.mjs
```

Le serveur fabrique un certificat auto-signé (via OpenSSL, une seule fois) et affiche les
adresses à ouvrir, par exemple :

```
  Sur ton téléphone (même réseau Wi-Fi) :
    https://192.168.1.24:8443   (wlan0)
```

Tape cette adresse dans le navigateur du téléphone. Comme le certificat est auto-signé, une page
d'avertissement apparaît : accepte-la une fois (*Paramètres avancés → Continuer* sur Android,
*Afficher les détails → Visiter ce site web* sur iPhone). Ensuite la caméra, le gyroscope, les
vibrations et la sauvegarde fonctionnent normalement. Rien n'est publié : tout reste sur ton
réseau local.

Aucune dépendance à installer, le serveur n'utilise que Node (18 ou plus récent).

> Un message d'erreur de certificat concernant le *service worker* peut apparaître dans la
> console : les navigateurs refusent de l'installer derrière un certificat auto-signé. Cela n'a
> aucun effet sur le jeu.

Variante sans certificat : `npm run http` sert en HTTP simple. Pratique pour vérifier
l'interface, mais les navigateurs y bloquent la caméra et les capteurs — le jeu bascule alors
sur le décor de secours et la visée au doigt.

### 2. Fichier unique — rien à installer

```bash
npm run hors-ligne   # écrit hors-ligne/guerre-des-tetes.html
```

Le fichier `hors-ligne/guerre-des-tetes.html` (~115 Ko) contient **tout le jeu** : interface,
styles et code. Envoie-le au téléphone comme tu veux (AirDrop, message, clé USB, téléchargement
depuis ce dépôt) et ouvre-le. Il est aussi versionné ici, donc téléchargeable directement sans
rien lancer.

Limite à connaître : sur une URL `file://`, les navigateurs interdisent la caméra. Le jeu le
détecte, l'annonce sur l'écran d'accueil et passe au décor de secours avec visée au doigt (ou au
gyroscope s'il répond). Tout le reste — niveaux, boss, capture par import de photo, scores —
fonctionne. C'est l'aperçu rapide ; pour la vraie AR, prends la méthode 1.

Ce fichier est **généré** à partir de `src/` : après une modification du code, relance
`npm run hors-ligne` pour le régénérer.

## Publier (facultatif)

Le jeu est un site statique : n'importe quel hébergement HTTPS convient.

**Vercel** — `vercel.json` est fourni : pas de build, la racine du dépôt est servie telle quelle,
avec une `Permissions-Policy` qui autorise la caméra et les capteurs de mouvement. En ligne de
commande : `npx vercel --prod`. Pour retirer le déploiement ensuite, supprime le projet depuis le
tableau de bord Vercel (*Settings → Delete Project*), ou `npx vercel remove <nom-du-projet>`.

**GitHub Pages** — *Settings → Pages → Source : Deploy from a branch*, puis la branche et le
dossier `/`.

Dans les deux cas, « Ajouter à l'écran d'accueil » installe le jeu comme une application
(manifeste + service worker, jouable hors connexion).

## Commandes

| Action | Geste |
|---|---|
| Viser | Bouger le téléphone (gyroscope) — ou glisser le doigt sans capteur |
| Tirer | Toucher l'écran, ou le bouton **TIR**, ou la barre d'espace |
| Pause | Bouton **❚❚**, ou `Échap` |
| Recentrer la vue | Menu pause → *Recentrer la vue* |

## Le jeu

- **Têtes volantes** : la base. Elles orbitent autour de toi puis foncent — un cercle rouge
  clignotant annonce la charge.
- **Têtes rapides** : plus petites et nerveuses.
- **Casques de fer** : un premier tir fait sauter le casque, un second la tête.
- **Cracheurs** : ils restent à distance et envoient des projectiles, que tu peux abattre en vol.
- **🦋 Papillons** : rendent un cœur.
- **💣 Bombes** : les toucher déclenche une explosion qui nettoie tout autour.
- **Combos** : enchaîne les tirs réussis en moins de 2,6 s pour multiplier les points. Un tir
  manqué ou un coup encaissé remet le compteur à zéro.
- **Boss** : la visière du kabuto se relève par intermittence et découvre la gemme. C'est le seul
  moment où il est vulnérable. Le vaincre « sauve » le visage utilisé et débloque le niveau suivant.

**9 niveaux** : 6 pour la campagne, 3 en mode « Montrer à un ami » (parties courtes, dont deux
chronométrées). Chaque niveau se débloque en terminant le précédent.

## Visages et scan en relief

- **Scanner en relief** (recommandé) : six prises de vue guidées — face, quart de tour et profil
  de chaque côté, menton baissé. Le jeu en tire une **tête complète orientable**, qu'un aperçu
  fait tourner avant de la garder. En jeu, les têtes se tournent réellement : elles regardent où
  elles volent, jettent un œil au joueur, et se braquent sur lui juste avant de foncer.
- **Photo simple** : une seule vue, comme avant. La tête reste en relief, mais tout ce qui n'a pas
  été photographié est extrapolé.
- **Importer** : n'importe quelle photo de la galerie, avec cadrage (glisser + zoom).
- Les têtes sont stockées **uniquement sur l'appareil** (`localStorage`), sous forme d'une seule
  texture d'environ 7 Ko. Rien n'est envoyé nulle part : il n'y a pas de serveur.
- Tant qu'aucun visage n'est scanné, trois têtes dessinées par le code prennent le relais —
  peintes directement en relief, cheveux et oreilles compris.
- La « fiche de profil » affichée après une capture est une plaisanterie tirée au hasard : le jeu
  ne fait aucune analyse du visage.

### Ce que « scan 3D » veut dire ici, et ce que ça ne veut pas dire

Le web n'expose aucun capteur de profondeur : **aucune géométrie réelle n'est mesurée**. Le jeu
fait ce que faisaient les studios avant la photogrammétrie — il plaque les prises de vue sur une
tête modèle, en laissant chaque vue régner là où elle regarde la surface de face, puis replie et
adoucit la zone jamais photographiée (la nuque). Le relief vient de la texture et de l'éclairage,
pas d'une mesure. C'est largement suffisant pour des ennemis volants, et honnête à dire.

## Réglages

Sensibilité de visée, inversion de l'axe vertical, visée au toucher (pour jouer sans gyroscope),
caméra activable/désactivable (un décor de secours en fil de fer prend alors le relais), sons,
vibrations, et trois difficultés qui changent la vitesse, l'agressivité et le nombre de cœurs.

**Tester le gyroscope** ouvre un diagnostic : des repères fixes dans la pièce, plus la source
utilisée, sa fréquence, le cap, l'élévation, le roulis, le tremblement et la dérive. Si les
repères tiennent en place quand le téléphone est posé, le capteur va bien — ce sont les têtes
qui volent.

## Architecture

```
index.html          écrans, HUD, canvas
styles.css          interface plein écran, encoches, paysage/portrait
sw.js               service worker (jeu hors connexion)
src/util.js         maths 3D, caméra et projection, émetteur d'événements
src/storage.js      sauvegarde locale (réglages, progression, visages)
src/audio.js        sons synthétisés (WebAudio) et vibrations
src/sensors.js      gyroscope (+ repli au doigt) et flux caméra
src/head3d.js       reconstruction de la tête : texture panoramique et planche de sprites
src/faces.js        capture, scan guidé, têtes de secours
src/entities.js     têtes, papillons, bombes, projectiles, boss, particules
src/levels.js       les 9 niveaux et les difficultés
src/game.js         boucle de jeu, vagues, tir, score, rendu, radar
src/ui.js           navigation entre écrans, HUD, listes
src/main.js         assemblage et enchaînement des écrans
outils/serveur.mjs  serveur local HTTP/HTTPS (certificat auto-signé), sans dépendance
outils/build-fichier-unique.mjs   assemble tout le jeu en un seul .html
hors-ligne/         le fichier unique généré
```

Points techniques notables :

- L'orientation vient de `deviceorientation`, convertie en quaternion (Euler YXZ, bascule de
  −90° pour viser par l'arrière, compensation de `screen.orientation.angle`). Le repère complet
  de l'appareil — roulis compris — sert directement de base à la caméra, donc la scène reste
  collée au décor filmé même téléphone incliné ou en paysage ; pas de blocage de cardan au
  zénith. Android émet `deviceorientation` **et** `deviceorientationabsolute` avec des références
  de cap différentes : la première source qui parle est verrouillée, l'autre ignorée. iOS exige
  `DeviceOrientationEvent.requestPermission()` depuis un geste de l'utilisateur : c'est le bouton
  « Lancer la partie ».
- La scène est projetée à la main sur un canvas 2D (repère caméra orthonormé + distance focale
  déduite du champ de vision), triée par profondeur. Pas de WebGL : ça démarre instantanément et
  ça consomme peu de batterie.
- Les ennemis hors champ sont signalés par des flèches et par un radar — indispensable quand
  l'action se déroule derrière toi.
- Les têtes sont précalculées en planche de sprites (18 caps × 3 élévations) par lancer de rayon
  sur une sphère, un pixel à la fois : pas de triangles, pas de coutures, et le rendu reste une
  simple recopie d'image. Reconstruction complète en ~150 ms, 60 images/s avec huit têtes à
  l'écran. Au plus quatre visages par niveau, pour la mémoire comme pour la lisibilité.
- `verification/` contient un banc d'essai : on y reconstruit une tête témoin dont les repères
  colorés sont à des longitudes connues, puis on vérifie par la couleur des pixels que chacun
  tombe au bon endroit sous neuf angles. Il a attrapé une image miroir et un retournement
  vertical avant qu'ils n'arrivent en jeu.

## À savoir

Ce dépôt est un hommage indépendant, écrit de zéro : aucun code, image ni son de Nintendo n'y
figure. *Face Raiders* est une marque de Nintendo / HAL Laboratory.

Le jeu se joue **debout, en tournant sur soi-même**. Regarde autour de toi avant de commencer.
