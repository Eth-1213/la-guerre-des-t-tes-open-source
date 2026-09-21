// Capteurs du téléphone : gyroscope (orientation de la vue) et caméra (décor AR).

import { clamp, wrapAngle, rad, v3, vDot, vCross, vNorm, toSpherical,
  quat, quatMul, quatSlerp, quatRotate, quatFromAxisAngle, cameraQuaternion } from "./util.js";

/* ------------------------------------------------------------------ */
/*  Orientation : gyroscope + repli au doigt                          */
/* ------------------------------------------------------------------ */

export class Orientation {
  constructor() {
    // Orientation complète de l'appareil, quaternion plutôt qu'angles d'Euler :
    // pas de blocage de cardan quand on vise le ciel ou ses pieds, et le
    // roulis est pris en compte, donc la scène reste collée au décor filmé.
    this.q = quat();
    this.qCible = quat();
    this.right = v3(1, 0, 0);
    this.up = v3(0, 1, 0);
    this.fwd = v3(0, 0, -1);

    this.yaw = 0;            // cap et élévation, pour le radar et les apparitions
    this.pitch = 0;
    this.roll = 0;
    this.offsetYaw = 0;      // « recentrer la vue »

    this.hasGyro = false;
    this.active = false;
    this.source = null;      // "absolue" | "relative" — une seule, verrouillée
    this.autresSources = new Set();
    this.evenements = 0;
    this.frequence = 0;
    this._fenetre = 0;
    this._compte = 0;

    this.sensitivity = 1.2;
    this.invertY = false;
    this.touchYaw = 0;
    this.touchPitch = 0;

    this._proprietaires = new Set();
    this._recentrerDesQuePret = false;
    this._onDevice = this._onDevice.bind(this);
    this._drag = null;
  }

  /** iOS : la permission doit être demandée depuis un geste utilisateur. */
  async requestPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        return (await DOE.requestPermission()) === "granted";
      } catch (err) {
        return false;
      }
    }
    return true; // Android / navigateurs sans garde-fou
  }

  /**
   * Plusieurs écrans ont besoin du capteur en même temps (partie, scan,
   * diagnostic, sonde de démarrage). Chacun le réserve sous son nom et le
   * relâche ; les écouteurs ne sont retirés que lorsque plus personne n'en
   * veut. Un simple start/stop laissait le dernier à partir couper les
   * capteurs sous les pieds des autres.
   */
  acquire(proprietaire) {
    this._proprietaires.add(proprietaire);
    if (this.active) return;
    this.active = true;
    window.addEventListener("deviceorientation", this._onDevice, true);
    window.addEventListener("deviceorientationabsolute", this._onDevice, true);
  }

  release(proprietaire) {
    this._proprietaires.delete(proprietaire);
    if (this._proprietaires.size || !this.active) return;
    this.active = false;
    window.removeEventListener("deviceorientation", this._onDevice, true);
    window.removeEventListener("deviceorientationabsolute", this._onDevice, true);
  }

  /** Angle de rotation de l'écran, en radians. */
  get angleEcran() {
    const o = window.screen && window.screen.orientation;
    const a = o && typeof o.angle === "number" ? o.angle : window.orientation || 0;
    return rad(a);
  }

  _onDevice(e) {
    if (e.alpha == null && e.beta == null && e.gamma == null) return;
    const type = e.type === "deviceorientationabsolute" || e.absolute ? "absolue" : "relative";

    // Android émet les deux événements avec des références de cap différentes.
    // Les mélanger faisait sauter la vue d'un cap à l'autre : on verrouille
    // la première source qui parle et on ignore l'autre.
    if (this.source === null) this.source = type;
    else if (this.source !== type) { this.autresSources.add(type); return; }

    this.qCible = cameraQuaternion(rad(e.alpha || 0), rad(e.beta || 0), rad(e.gamma || 0), this.angleEcran);
    if (!this.hasGyro) { this.q = this.qCible; this.hasGyro = true; }
    if (this._recentrerDesQuePret) { this._recentrerDesQuePret = false; this.recenter(); }
    this.evenements++;
    this._compte++;
  }

  /** Repli sans gyroscope : glisser le doigt (ou la souris) pour tourner. */
  attachDrag(el) {
    const down = (x, y, id) => { this._drag = { x, y, id }; };
    const move = (x, y) => {
      if (!this._drag) return;
      const dx = x - this._drag.x, dy = y - this._drag.y;
      this._drag.x = x; this._drag.y = y;
      if (this.hasGyro) return; // le capteur a pris la main
      const k = 0.0032 * this.sensitivity;
      this.touchYaw = wrapAngle(this.touchYaw - dx * k);
      this.touchPitch = clamp(this.touchPitch + dy * k * (this.invertY ? -1 : 1), -rad(85), rad(85));
    };
    const up = () => { this._drag = null; };

    el.addEventListener("touchstart", (e) => {
      const t = e.changedTouches[0];
      down(t.clientX, t.clientY, t.identifier);
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      if (!this._drag) return;
      for (const t of e.changedTouches) if (t.identifier === this._drag.id) move(t.clientX, t.clientY);
    }, { passive: true });
    el.addEventListener("touchend", up, { passive: true });
    el.addEventListener("touchcancel", up, { passive: true });

    el.addEventListener("mousedown", (e) => down(e.clientX, e.clientY, "m"));
    window.addEventListener("mousemove", (e) => { if (this._drag) move(e.clientX, e.clientY); });
    window.addEventListener("mouseup", up);
  }

  /** Cap brut, avant recentrage. */
  get capBrut() {
    return toSpherical(quatRotate(this.q, v3(0, 0, -1))).yaw;
  }

  recenter() {
    if (this.hasGyro) this.offsetYaw = this.capBrut;
    else { this.touchYaw = 0; this.touchPitch = 0; }
  }

  /**
   * Recentre dès la première mesure du capteur : au lancement d'un niveau,
   * « devant » doit être là où le joueur pointe, pas le nord magnétique.
   */
  recenterWhenReady() {
    this.recenter();
    if (!this.hasGyro) this._recentrerDesQuePret = true;
  }

  update(dt) {
    // Fréquence du capteur, utile au diagnostic.
    this._fenetre += dt;
    if (this._fenetre >= 0.5) {
      this.frequence = this._compte / this._fenetre;
      this._compte = 0;
      this._fenetre = 0;
    }

    if (this.hasGyro) {
      // Lissage sphérique à constante de temps fixe : même réponse à 60 ou 120 Hz.
      this.q = quatSlerp(this.q, this.qCible, 1 - Math.exp(-dt / 0.06));
      const vue = quatMul(quatFromAxisAngle(0, 1, 0, -this.offsetYaw), this.q);
      this.right = quatRotate(vue, v3(1, 0, 0));
      this.up = quatRotate(vue, v3(0, 1, 0));
      this.fwd = quatRotate(vue, v3(0, 0, -1));
    } else {
      // Sans capteur : cap et élévation pilotés au doigt, horizon toujours droit.
      const cy = Math.cos(this.touchYaw), sy = Math.sin(this.touchYaw);
      const cp = Math.cos(this.touchPitch), sp = Math.sin(this.touchPitch);
      this.fwd = v3(sy * cp, sp, -cy * cp);
      this.right = v3(cy, 0, sy);
      this.up = v3(-sy * sp, cp, cy * sp);
    }

    const s = toSpherical(this.fwd);
    this.yaw = s.yaw;
    this.pitch = s.pitch;

    // Roulis : écart entre le haut de l'écran et la verticale du monde.
    // Le « droite » de référence est fwd x haut-du-monde, soit (-fz, 0, fx).
    const horizontal = vNorm(v3(-this.fwd.z, 0, this.fwd.x));
    const hautDroit = vNorm(vCross(horizontal, this.fwd));
    this.roll = Math.atan2(vDot(vCross(hautDroit, this.up), this.fwd), clamp(vDot(hautDroit, this.up), -1, 1));
  }
}

/* ------------------------------------------------------------------ */
/*  Caméra                                                             */
/* ------------------------------------------------------------------ */

export class CameraFeed {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.facing = "environment";
    this.error = null;
  }

  get supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async start(facing = this.facing) {
    this.facing = facing;
    this.stop();
    if (!this.supported) {
      this.error = "no-api";
      return false;
    }
    const tries = [
      { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: facing }, audio: false },
      { video: true, audio: false },
    ];
    for (const constraints of tries) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.video.srcObject = this.stream;
        this.video.setAttribute("playsinline", "");
        await this.video.play().catch(() => {});
        this.error = null;
        return true;
      } catch (err) {
        this.error = err && err.name ? err.name : "error";
      }
    }
    return false;
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }

  get ready() {
    return !!this.stream && this.video.readyState >= 2;
  }
}
