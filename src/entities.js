// Habitants du monde AR : têtes volantes, papillons, bombes, projectiles, boss.
// Chaque entité sait se comporter (update) et se dessiner (draw) une fois projetée.

import { TAU, clamp, lerp, rand, randInt, v3, vAdd, vScale, vLen, vNorm, sphere, toSpherical } from "./util.js";

export const HIT_DIST = 1.35;          // distance à laquelle une tête bouscule le joueur
export const SPAWN_MIN = 8;
export const SPAWN_MAX = 13;

/* ------------------------------------------------------------------ */
/*  Base                                                               */
/* ------------------------------------------------------------------ */

class Entity {
  constructor(pos) {
    this.pos = pos;
    this.vel = v3();
    this.radius = 0.75;
    this.dead = false;
    this.t = 0;
    this.flash = 0;
    this.shootable = true;
  }
  get dist() { return vLen(this.pos); }
  damage() { this.dead = true; return true; }
}

/* ------------------------------------------------------------------ */
/*  Tête volante                                                       */
/* ------------------------------------------------------------------ */

export const HEAD_TYPES = {
  basic:   { hp: 1, speed: 1.00, radius: 0.52, score: 100, color: "#ff3b6b" },
  fast:    { hp: 1, speed: 1.85, radius: 0.40, score: 160, color: "#38e8ff" },
  armor:   { hp: 2, speed: 0.80, radius: 0.60, score: 220, color: "#ffcc4d" },
  spitter: { hp: 1, speed: 0.70, radius: 0.54, score: 260, color: "#b47dff" },
};

export class Head extends Entity {
  constructor(face, type, level, forcedYaw = null) {
    const yaw = forcedYaw === null ? rand(0, TAU) : forcedYaw;
    const pitch = rand(-0.5, 0.75);
    const spec = HEAD_TYPES[type] || HEAD_TYPES.basic;
    super(sphere(yaw, pitch, rand(SPAWN_MAX, SPAWN_MAX + 3)));
    this.face = face;
    this.type = type;
    this.spec = spec;
    this.hp = spec.hp;
    this.radius = spec.radius;
    this.speed = spec.speed * (level.speed || 1);
    this.state = "enter";
    this.stateT = 0;
    this.chargeIn = rand(2.2, 6.5) / (level.aggro || 1);
    this.orbitYaw = yaw;
    this.orbitPitch = pitch;
    this.orbitR = rand(5.5, 9.5);
    this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    this.bob = rand(0, TAU);
    this.spinning = rand(-1, 1);
    this.spitIn = rand(1.5, 3.5);
    this.hitPlayer = false;   // relevé par le jeu quand la tête bouscule le joueur
    this.spawnFx = 1;         // effet de traversée de mur
  }

  update(dt, world) {
    this.t += dt;
    this.stateT += dt;
    this.spawnFx = Math.max(0, this.spawnFx - dt * 1.6);
    this.flash = Math.max(0, this.flash - dt * 5);

    const d = this.dist;

    if (this.state === "enter") {
      // Arrive de l'extérieur, comme si elle traversait le mur de la pièce.
      const dir = vNorm(vScale(this.pos, -1));
      this.pos = vAdd(this.pos, vScale(dir, this.speed * 4.5 * dt));
      if (d < this.orbitR) this.setState("orbit");
    } else if (this.state === "orbit") {
      this.orbitYaw += this.orbitDir * this.speed * 0.22 * dt;
      this.orbitPitch = clamp(this.orbitPitch + Math.sin(this.t * 0.7) * 0.25 * dt, -0.55, 0.9);
      const r = this.orbitR + Math.sin(this.t * 1.4 + this.bob) * 0.6;
      this.pos = sphere(this.orbitYaw, this.orbitPitch, r);
      this.chargeIn -= dt;
      if (this.type === "spitter") {
        this.spitIn -= dt;
        if (this.spitIn <= 0) {
          this.spitIn = rand(2.4, 4.2);
          world.spawnProjectile(this.pos, 3.4, "#b47dff");
        }
      } else if (this.chargeIn <= 0) {
        this.setState("charge");
      }
    } else if (this.state === "charge") {
      const dir = vNorm(vScale(this.pos, -1));
      this.pos = vAdd(this.pos, vScale(dir, this.speed * 4.2 * dt));
      if (d <= HIT_DIST) {
        this.hitPlayer = true;
        this.setState("flee");
      }
      if (this.stateT > 6) this.setState("flee");
    } else if (this.state === "flee") {
      const dir = vNorm(this.pos);
      this.pos = vAdd(this.pos, vScale(dir, this.speed * 3.4 * dt));
      if (d > SPAWN_MAX) {
        const s = toSpherical(this.pos);
        this.orbitYaw = s.yaw;
        this.orbitPitch = clamp(s.pitch, -0.5, 0.8);
        this.orbitR = rand(5.5, 9.5);
        this.chargeIn = rand(2.5, 5.5);
        this.setState("orbit");
      }
    }
  }

  setState(s) { this.state = s; this.stateT = 0; }

  damage() {
    this.hp--;
    this.flash = 1;
    if (this.hp <= 0) { this.dead = true; return "kill"; }
    return "armor";
  }

  draw(ctx, p) {
    const r = this.radius * p.scale;
    if (r < 2) return;
    const wob = Math.sin(this.t * 6 + this.bob) * 0.08;

    ctx.save();
    ctx.translate(p.x, p.y);

    // Onde de choc à l'apparition : la tête « traverse le mur ».
    if (this.spawnFx > 0) {
      ctx.globalAlpha = this.spawnFx * 0.6;
      ctx.strokeStyle = this.spec.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.4 + (1 - this.spawnFx) * 2.4), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Ailes
    const flap = Math.sin(this.t * 14) * 0.5 + 0.5;
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.strokeStyle = this.spec.color;
    ctx.lineWidth = Math.max(1, r * 0.05);
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * r * 0.72, -r * 0.1);
      ctx.rotate(s * (0.35 + flap * 0.55));
      ctx.beginPath();
      ctx.ellipse(s * r * 0.34, 0, r * 0.42, r * 0.17, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.rotate(wob + this.spinning * 0.1);

    // Le visage
    const img = this.face && this.face.tex;
    if (img) {
      ctx.drawImage(img, -r, -r, r * 2, r * 2);
    } else {
      ctx.fillStyle = this.spec.color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
    }

    // Casque de fer : la première touche le fait sauter.
    if (this.type === "armor" && this.hp > 1) {
      ctx.fillStyle = "rgba(190,196,214,0.92)";
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.04, Math.PI * 1.06, Math.PI * 1.94);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#6f7590";
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.stroke();
    }

    // Aura du cracheur
    if (this.type === "spitter") {
      ctx.strokeStyle = "rgba(180,125,255,0.75)";
      ctx.lineWidth = Math.max(1, r * 0.07);
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.12 + Math.sin(this.t * 4) * 0.06), 0, TAU);
      ctx.stroke();
    }

    // Éclair blanc quand elle encaisse
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.8;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Signal rouge lorsqu'elle fonce sur le joueur
    if (this.state === "charge") {
      ctx.strokeStyle = "rgba(255,59,107," + (0.5 + Math.sin(this.t * 18) * 0.4) + ")";
      ctx.lineWidth = Math.max(2, r * 0.09);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.22, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/*  Papillon : rend de la vie                                          */
/* ------------------------------------------------------------------ */

export class Butterfly extends Entity {
  constructor() {
    const yaw = rand(0, TAU);
    super(sphere(yaw, rand(-0.2, 0.7), rand(6, 9)));
    this.radius = 0.5;
    this.yaw = yaw;
    this.pitch = rand(-0.2, 0.7);
    this.r = vLen(this.pos);
    this.life = 14;
    this.hue = randInt(0, 360);
  }
  update(dt) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    this.yaw += 0.28 * dt;
    this.pitch = clamp(this.pitch + Math.sin(this.t * 1.6) * 0.5 * dt, -0.4, 0.9);
    this.pos = sphere(this.yaw, this.pitch, this.r + Math.sin(this.t * 2) * 0.4);
  }
  draw(ctx, p) {
    const r = this.radius * p.scale;
    if (r < 1.5) return;
    const flap = Math.abs(Math.sin(this.t * 9));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = this.life < 3 ? 0.35 + Math.abs(Math.sin(this.t * 10)) * 0.65 : 1;
    for (const s of [-1, 1]) {
      ctx.fillStyle = `hsl(${this.hue + (s > 0 ? 25 : 0)},90%,65%)`;
      ctx.beginPath();
      ctx.ellipse(s * r * 0.55 * (0.35 + flap), 0, r * 0.62 * (0.35 + flap), r * 0.85, s * 0.2, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "#2a2233";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.12, r * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/*  Bombe : détruit tout autour d'elle quand on la touche              */
/* ------------------------------------------------------------------ */

export class Bomb extends Entity {
  constructor() {
    const yaw = rand(0, TAU);
    super(sphere(yaw, rand(-0.3, 0.6), rand(5, 8)));
    this.radius = 0.62;
    this.yaw = yaw;
    this.pitch = rand(-0.3, 0.6);
    this.r = vLen(this.pos);
    this.life = 12;
    this.blast = 5.5;
  }
  update(dt) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    this.yaw += 0.12 * dt;
    this.pos = sphere(this.yaw, this.pitch + Math.sin(this.t) * 0.06, this.r);
  }
  draw(ctx, p) {
    const r = this.radius * p.scale;
    if (r < 1.5) return;
    const pulse = 0.5 + Math.sin(this.t * (this.life < 4 ? 14 : 5)) * 0.5;
    ctx.save();
    ctx.translate(p.x, p.y);
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, "#5a5f75");
    g.addColorStop(1, "#14161f");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,120,60,${0.45 + pulse * 0.55})`;
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.15, 0, TAU);
    ctx.stroke();
    // Mèche
    ctx.strokeStyle = "#c8a06a";
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r * 0.35, -r * 1.35, r * 0.15, -r * 1.6);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,${150 + pulse * 100},60,1)`;
    ctx.beginPath();
    ctx.arc(r * 0.15, -r * 1.6, r * (0.16 + pulse * 0.12), 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/*  Projectile ennemi : à abattre ou à encaisser                       */
/* ------------------------------------------------------------------ */

export class Projectile extends Entity {
  constructor(pos, speed, color) {
    super(v3(pos.x, pos.y, pos.z));
    this.radius = 0.34;
    this.dir = vNorm(vScale(this.pos, -1));
    this.speed = speed;
    this.color = color || "#ff8a3b";
    this.hitPlayer = false;
  }
  update(dt) {
    this.t += dt;
    this.pos = vAdd(this.pos, vScale(this.dir, this.speed * dt));
    if (this.dist <= HIT_DIST * 0.8) { this.hitPlayer = true; this.dead = true; }
    if (this.t > 12) this.dead = true;
  }
  draw(ctx, p) {
    const r = Math.max(2, this.radius * p.scale);
    ctx.save();
    ctx.translate(p.x, p.y);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.8);
    g.addColorStop(0, "#fff");
    g.addColorStop(0.4, this.color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/*  Boss : tête géante casquée (kabuto), gemme au front                */
/* ------------------------------------------------------------------ */

export class Boss extends Entity {
  constructor(face, cfg) {
    super(sphere(0, 0.12, 13));
    this.face = face;
    this.cfg = cfg;
    this.maxHp = cfg.hp;
    this.hp = cfg.hp;
    this.radius = 1.85;
    this.yaw = 0;
    this.pitch = 0.12;
    this.r = 13;
    this.state = "intro";
    this.stateT = 0;
    this.openT = 0;
    this.vulnerable = false;
    this.hitPlayer = false;
    this.shootable = true;
    this.rage = 1;
  }

  /** Position de la gemme (point faible) : légèrement au-dessus du centre. */
  gemPos() {
    const up = v3(0, 1, 0);
    return vAdd(this.pos, vScale(up, this.radius * 0.62));
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
    if (s === "attack") this.fired = 0;
  }

  update(dt, world) {
    this.t += dt;
    this.stateT += dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.rage = 1 + (1 - this.hp / this.maxHp) * 1.1;

    switch (this.state) {
      case "intro":
        this.r = lerp(this.r, 9.5, 1 - Math.pow(0.2, dt));
        if (this.stateT > 2.2) this.setState("move");
        break;

      case "move":
        this.yaw += 0.55 * this.rage * dt * (Math.sin(this.t * 0.4) > 0 ? 1 : -1);
        this.pitch = 0.12 + Math.sin(this.t * 0.9) * 0.18;
        this.r = 9.5 + Math.sin(this.t * 0.7) * 1.3;
        if (this.stateT > 2.6 / this.rage) {
          this.setState(Math.random() < 0.55 ? "open" : "attack");
        }
        break;

      case "open":       // visière relevée : la gemme est exposée
        this.vulnerable = true;
        this.openT = 1 - this.stateT / (2.6 / this.rage);
        if (this.stateT > 2.6 / this.rage) { this.vulnerable = false; this.setState("attack"); }
        break;

      case "attack": {
        // Salve égrenée : chaque projectile part d'une direction différente,
        // ce qui laisse le temps de les abattre un par un.
        this.vulnerable = false;
        const n = this.cfg.volley || 3;
        const gap = 0.34;
        while (this.fired < n && this.stateT > 0.5 + this.fired * gap) {
          const off = sphere(this.yaw + rand(-0.45, 0.45), this.pitch + rand(-0.25, 0.25), this.r);
          world.spawnProjectile(off, 3.6 + this.rage * 0.6, "#ff8a3b");
          this.fired++;
        }
        if (this.stateT > 0.9 + n * gap) {
          if (this.cfg.minions && Math.random() < 0.5) world.spawnMinion();
          this.setState("move");
        }
        break;
      }

      case "charge": {
        this.r = Math.max(HIT_DIST + this.radius, this.r - 7 * dt);
        if (this.r <= HIT_DIST + this.radius + 0.1) { this.hitPlayer = true; this.setState("move"); }
        break;
      }

      case "dying":
        this.r += 2.5 * dt;
        this.pitch += 0.4 * dt;
        if (this.stateT > 2.4) this.dead = true;
        break;
    }

    this.pos = sphere(this.yaw, this.pitch, this.r);
  }

  /** Seule la gemme exposée compte ; le reste du casque renvoie les tirs. */
  damage(onGem) {
    if (this.state === "dying") return "none";
    if (!this.vulnerable || !onGem) { this.flash = 0.5; return "armor"; }
    this.hp--;
    this.flash = 1;
    this.vulnerable = false;
    if (this.hp <= 0) { this.setState("dying"); return "kill"; }
    this.setState("move");
    return "hit";
  }

  draw(ctx, p) {
    const r = this.radius * p.scale;
    if (r < 3) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (this.state === "dying") {
      ctx.globalAlpha = clamp(1 - this.stateT / 2.4, 0, 1);
      ctx.rotate(Math.sin(this.stateT * 12) * 0.25);
    }

    // Visage géant
    const img = this.face && this.face.tex;
    if (img) ctx.drawImage(img, -r, -r, r * 2, r * 2);
    else { ctx.fillStyle = "#c0392b"; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); }

    // Kabuto : bombe du casque
    ctx.fillStyle = "#2e3550";
    ctx.beginPath();
    ctx.arc(0, -r * 0.12, r * 1.06, Math.PI * 1.02, Math.PI * 1.98);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#8a93b8";
    ctx.lineWidth = Math.max(1.5, r * 0.04);
    ctx.stroke();

    // Fukigaeshi (rabats latéraux) et cornes maedate
    ctx.fillStyle = "#3c4468";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.85, -r * 0.35);
      ctx.quadraticCurveTo(s * r * 1.45, -r * 0.1, s * r * 1.15, r * 0.35);
      ctx.quadraticCurveTo(s * r * 0.95, r * 0.05, s * r * 0.8, -r * 0.1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#ffcc4d";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.18, -r * 0.95);
      ctx.quadraticCurveTo(s * r * 0.75, -r * 1.75, s * r * 1.25, -r * 1.45);
      ctx.quadraticCurveTo(s * r * 0.7, -r * 1.35, s * r * 0.42, -r * 0.88);
      ctx.closePath();
      ctx.fill();
    }

    // Visière : elle se relève pour découvrir la gemme
    const open = this.vulnerable ? clamp(this.openT * 1.6, 0, 1) : 0;
    const gemY = -r * 0.62;
    ctx.save();
    ctx.translate(0, gemY);
    ctx.rotate(-open * 0.9);
    ctx.fillStyle = "#1d2236";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.62, r * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Gemme
    if (open > 0.05) {
      const pulse = 0.65 + Math.sin(this.t * 9) * 0.35;
      ctx.save();
      ctx.translate(0, gemY);
      ctx.globalAlpha = open;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.42);
      g.addColorStop(0, "#fff");
      g.addColorStop(0.35, "#ff3b6b");
      g.addColorStop(1, "rgba(255,59,107,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.42 * (0.85 + pulse * 0.25), 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ff5c86";
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.2);
      ctx.lineTo(r * 0.16, 0);
      ctx.lineTo(0, r * 0.2);
      ctx.lineTo(-r * 0.16, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.65;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.1, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/*  Effets : particules et points flottants                            */
/* ------------------------------------------------------------------ */

export class Particles {
  constructor() { this.list = []; }

  burst(pos, count, color, spread = 3.2) {
    for (let i = 0; i < count; i++) {
      this.list.push({
        pos: v3(pos.x, pos.y, pos.z),
        vel: vScale(vNorm(v3(rand(-1, 1), rand(-1, 1), rand(-1, 1))), rand(0.4, spread)),
        life: rand(0.35, 0.9),
        max: 0.9,
        color,
        size: rand(0.05, 0.18),
      });
    }
  }

  text(pos, label, color) {
    this.list.push({ pos: v3(pos.x, pos.y, pos.z), vel: v3(0, 1.1, 0), life: 0.9, max: 0.9, color, label });
  }

  update(dt) {
    for (const p of this.list) {
      p.pos = vAdd(p.pos, vScale(p.vel, dt));
      if (!p.label) p.vel = vScale(p.vel, 1 - 1.6 * dt);
      p.life -= dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(ctx, cam) {
    const out = {};
    for (const p of this.list) {
      const pr = cam.project(p.pos, out);
      if (!pr) continue;
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      if (p.label) {
        const s = Math.max(11, Math.min(46, 0.55 * pr.scale));
        ctx.fillStyle = p.color;
        ctx.font = `bold ${s}px "Trebuchet MS", sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(p.label, pr.x, pr.y);
      } else {
        ctx.fillStyle = p.color;
        const r = Math.max(1, p.size * pr.scale);
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  clear() { this.list.length = 0; }
}

export { Entity };
