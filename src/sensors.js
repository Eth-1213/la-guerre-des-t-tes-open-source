// Capteurs du téléphone : gyroscope (orientation de la vue) et caméra (décor AR).

import { clamp, wrapAngle, lerpAngle, rad } from "./util.js";

/* ------------------------------------------------------------------ */
/*  Orientation : gyroscope + repli au doigt                          */
/* ------------------------------------------------------------------ */

export class Orientation {
  constructor() {
    this.yaw = 0;            // lissé, consommé par la caméra de jeu
    this.pitch = 0;
    this.rawYaw = 0;         // brut, issu du capteur ou du doigt
    this.rawPitch = 0;
    this.offsetYaw = 0;      // « recentrer la vue »
    this.hasGyro = false;
    this.active = false;
    this.sensitivity = 1.2;
    this.invertY = false;
    this._onDevice = this._onDevice.bind(this);
    this._drag = null;
  }

  /** iOS : la permission doit être demandée depuis un geste utilisateur. */
  async requestPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        const res = await DOE.requestPermission();
        return res === "granted";
      } catch (err) {
        return false;
      }
    }
    return true; // Android / navigateurs sans garde-fou
  }

  start() {
    if (this.active) return;
    this.active = true;
    window.addEventListener("deviceorientation", this._onDevice, true);
    window.addEventListener("deviceorientationabsolute", this._onDevice, true);
  }

  stop() {
    this.active = false;
    window.removeEventListener("deviceorientation", this._onDevice, true);
    window.removeEventListener("deviceorientationabsolute", this._onDevice, true);
  }

  _onDevice(e) {
    if (e.alpha == null && e.beta == null && e.gamma == null) return;
    const a = rad(e.alpha || 0), b = rad(e.beta || 0), g = rad(e.gamma || 0);
    const cA = Math.cos(a), sA = Math.sin(a);
    const cB = Math.cos(b), sB = Math.sin(b);
    const cG = Math.cos(g), sG = Math.sin(g);

    // Direction visée par la caméra arrière = R(alpha,beta,gamma) appliqué à (0,0,-1),
    // exprimée dans le repère terrestre (x est, y nord, z haut).
    const ex = -(cA * sG + cG * sA * sB);
    const ny = -(sA * sG - cA * cG * sB);
    const uz = -(cB * cG);

    this.hasGyro = true;
    this.rawYaw = Math.atan2(ex, ny);
    this.rawPitch = Math.asin(clamp(uz, -1, 1));
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
      this.rawYaw = wrapAngle(this.rawYaw - dx * k);
      this.rawPitch = clamp(this.rawPitch + dy * k * (this.invertY ? -1 : 1), -rad(85), rad(85));
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

  recenter() {
    this.offsetYaw = this.rawYaw;
    this.yaw = 0;
  }

  /** Lissage : évite les tremblements du capteur sans ajouter de latence perceptible. */
  update(dt) {
    const target = wrapAngle(this.rawYaw - this.offsetYaw);
    const tp = clamp(this.invertY && this.hasGyro ? -this.rawPitch : this.rawPitch, -rad(88), rad(88));
    const k = 1 - Math.pow(0.0001, dt); // ~ suivi immédiat, filtré à haute fréquence
    this.yaw = lerpAngle(this.yaw, target, k);
    this.pitch = this.pitch + (tp - this.pitch) * k;
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
