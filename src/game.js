// Boucle de jeu : vagues de têtes, tir au réticule, boss, score et combos.

import { TAU, clamp, rand, pick, v3, vDot, Camera, Emitter, toSpherical } from "./util.js";
import { Head, Butterfly, Bomb, Projectile, Boss, Particles } from "./entities.js";
import { DIFFICULTY } from "./levels.js";
import { sfx, vibrate } from "./audio.js";

const COMBO_WINDOW = 2.6;   // secondes pour enchaîner
const INVUL = 1.3;          // invincibilité après un coup encaissé

export class Game extends Emitter {
  constructor(opts) {
    super();
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.radar = opts.radar;
    this.radarCtx = this.radar ? this.radar.getContext("2d") : null;
    this.orientation = opts.orientation;
    this.settings = opts.settings;
    this.cam = new Camera();
    this.particles = new Particles();

    this.running = false;
    this.paused = false;
    this.entities = [];
    this.boss = null;
    this.faces = [];
    this.level = null;
    this.useCameraFeed = false;
    this.dpr = 1;

    this._loop = this._loop.bind(this);
    this._last = 0;
    this.time = 0;
    this.shake = 0;
    this.hurtFx = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 250));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cam.resize(w, h);
    this.W = w; this.H = h;
  }

  /* ----------------------- Cycle de vie ----------------------- */

  load(level, faces, useCameraFeed) {
    const diff = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.normal;
    this.level = { ...level, speed: (level.speed || 1) * diff.speed, aggro: (level.aggro || 1) * diff.aggro };
    this.diff = diff;
    this.faces = faces.length ? faces : [];
    this.useCameraFeed = !!useCameraFeed;

    this.entities.length = 0;
    this.particles.clear();
    this.boss = null;
    this.bossFace = pick(this.faces) || null;

    this.hearts = diff.hearts;
    this.maxHearts = diff.hearts;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 1;
    this.comboT = 0;
    this.killed = 0;
    this.spawned = 0;
    this.shots = 0;
    this.hits = 0;
    this.invul = 0;
    this.spawnT = 0.6;
    this.phase = "wave";     // wave -> boss -> done
    this.time = 0;
    this.timeLeft = level.timeLimit || 0;
    this.endReason = null;

    this.emit("hearts", { hearts: this.hearts, max: this.maxHearts });
    this.emit("score", 0);
    this.emit("remaining", Math.max(0, this.level.quota - this.killed));
    this.emit("boss", null);
    this.emit("combo", 0);
  }

  start() {
    this.running = true;
    this.paused = false;
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  pause() { this.paused = true; }

  resume() {
    if (!this.running) return;
    this.paused = false;
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  stop() { this.running = false; this.paused = false; }

  /* ------------------------- Boucle -------------------------- */

  _loop(now) {
    if (!this.running || this.paused) return;
    const dt = Math.min(0.05, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    this.update(dt);
    this.render();
    requestAnimationFrame(this._loop);
  }

  update(dt) {
    this.time += dt;
    this.orientation.update(dt);
    this.cam.yaw = this.orientation.yaw;
    this.cam.pitch = this.orientation.pitch;
    // Avec le gyroscope on reprend le repère complet de l'appareil (roulis
    // compris) ; sans lui, la caméra se reconstruit depuis cap et élévation.
    if (this.orientation.hasGyro) {
      this.cam.setBasis(this.orientation.right, this.orientation.up, this.orientation.fwd);
    } else {
      this.cam.update();
    }

    this.invul = Math.max(0, this.invul - dt);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.hurtFx = Math.max(0, this.hurtFx - dt * 1.6);

    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0 && this.combo > 0) { this.combo = 0; this.emit("combo", 0); }
    }

    if (this.phase === "wave") this._updateWave(dt);

    // Verrouillage du réticule (retour visuel)
    const locked = !!this._pick(this.W / 2, this.H / 2);
    if (locked !== this._locked) { this._locked = locked; this.emit("lock", locked); }

    // Entités
    for (const e of this.entities) {
      e.update(dt, this);
      if (e.hitPlayer) { e.hitPlayer = false; this._playerHit(e); }
    }
    if (this.boss) {
      this.boss.update(dt, this);
      if (this.boss.hitPlayer) { this.boss.hitPlayer = false; this._playerHit(this.boss); }
      if (this.boss.dead) this._bossDefeated();
    }
    this.entities = this.entities.filter((e) => !e.dead);
    this.particles.update(dt);

    // Limite de temps (niveaux « Montrer à un ami »)
    if (this.level.timeLimit) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      this.emit("time", this.timeLeft);
      if (this.timeLeft <= 0 && this.phase !== "done") {
        this._finish(this.killed >= this.level.quota, "temps");
      }
    }
  }

  _updateWave(dt) {
    const lvl = this.level;
    const heads = this.entities.filter((e) => e instanceof Head).length;

    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.spawned < lvl.quota && heads < lvl.maxAlive) {
      this.spawnT = lvl.spawnEvery * rand(0.75, 1.25);
      this.spawnHead();
      if (Math.random() < (lvl.butterflies || 0)) this.entities.push(new Butterfly());
      if (Math.random() < (lvl.bombs || 0)) this.entities.push(new Bomb());
    }

    if (this.killed >= lvl.quota) {
      if (lvl.boss) this._startBoss();
      else if (heads === 0) this._finish(true, "quota");
    }
  }

  spawnHead() {
    const type = pick(this.level.types);
    const face = this.faces.length ? pick(this.faces) : null;
    // Les deux premières arrivent de face : le joueur comprend la règle, puis ça tourne à 360°.
    const front = this.spawned < 2 ? this.cam.yaw + rand(-0.7, 0.7) : null;
    const h = new Head(face, type, this.level, front);
    this.entities.push(h);
    this.spawned++;
    sfx.spawn();
    return h;
  }

  /** Appelé par les cracheurs et le boss. */
  spawnProjectile(pos, speed, color) {
    this.entities.push(new Projectile(pos, speed, color));
  }

  spawnMinion() {
    const h = new Head(this.faces.length ? pick(this.faces) : null, "fast", this.level);
    h.isMinion = true;
    this.entities.push(h);
  }

  _startBoss() {
    if (this.phase !== "wave") return;
    this.phase = "boss";
    // Les têtes restantes fuient pour laisser la place.
    for (const e of this.entities) if (e instanceof Head) e.setState("flee");
    this.boss = new Boss(this.bossFace, this.level.boss);
    sfx.bossIn();
    vibrate([40, 60, 40, 60, 120]);
    this.emit("boss", { hp: this.boss.hp, max: this.boss.maxHp });
    this.emit("toast", "La Grande Tête arrive\u00a0! Vise la gemme du casque.");
  }

  _bossDefeated() {
    this.boss = null;
    this._finish(true, "boss");
  }

  _finish(won, reason) {
    if (this.phase === "done") return;
    this.phase = "done";
    this.endReason = reason;
    this.running = false;
    if (won) sfx.win(); else sfx.lose();
    vibrate(won ? [60, 40, 60, 40, 160] : [220]);
    this.emit("end", {
      won,
      reason,
      score: Math.round(this.score),
      bestCombo: this.bestCombo,
      accuracy: this.shots ? Math.round((this.hits / this.shots) * 100) : 0,
      face: this.bossFace,
      level: this.level,
    });
  }

  /* -------------------------- Tir ---------------------------- */

  /** Tire vers un point de l'écran (par défaut le réticule central). */
  shoot(sx = this.W / 2, sy = this.H / 2) {
    if (!this.running || this.paused || this.phase === "done") return;
    this.shots++;
    sfx.shoot();
    this.emit("shot");

    const target = this._pick(sx, sy);
    if (!target) {
      this._miss();
      return;
    }

    const { entity, onGem } = target;

    if (entity instanceof Butterfly) {
      entity.dead = true;
      this.hits++;
      this._heal();
      this._award(entity.pos, 150, "🦋");
      return;
    }

    if (entity instanceof Bomb) {
      entity.dead = true;
      this.hits++;
      this._explode(entity);
      return;
    }

    if (entity instanceof Projectile) {
      entity.dead = true;
      this.hits++;
      this.particles.star(entity.pos, "#ffffff", 1.4);
      this.particles.burst(entity.pos, 10, entity.color, 2.2);
      this._award(entity.pos, 60, null, false);
      sfx.hit(1);
      return;
    }

    if (entity === this.boss) {
      const res = this.boss.damage(onGem);
      if (res === "armor") {
        sfx.armor();
        this.particles.burst(entity.pos, 6, "#8a93b8", 1.6);
        this._miss(true);
      } else {
        this.hits++;
        sfx.bossHit();
        vibrate(50);
        this.particles.star(entity.gemPos(), "#e63b2e", 3.2);
        this.particles.burst(entity.gemPos(), 22, "#ffc93c", 3.4);
        this._award(entity.gemPos(), 500, "GEMME !");
        this.emit("boss", { hp: Math.max(0, this.boss.hp), max: this.boss.maxHp });
        this.shake = 0.6;
      }
      return;
    }

    // Tête volante
    const res = entity.damage();
    this.hits++;
    if (res === "armor") {
      sfx.armor();
      this.particles.burst(entity.pos, 8, "#bec4d6", 2.4);
      this._bumpCombo(false);
    } else {
      sfx.hit(this.combo + 1);
      vibrate(25);
      this.killed++;
      this.particles.star(entity.pos, "#ffc93c", entity.radius * 3.2);
      this.particles.burst(entity.pos, 16, entity.spec.color, 3);
      this._award(entity.pos, entity.spec.score);
      this.emit("remaining", Math.max(0, this.level.quota - this.killed));
    }
  }

  /** Cible la plus proche du point de visée (petite aide à la visée incluse). */
  _pick(sx, sy) {
    const out = {};
    let best = null;
    const consider = (entity, pos, radius, onGem, assist) => {
      const p = this.cam.project(pos, out);
      if (!p) return;
      const r = radius * p.scale * assist;
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d > r) return;
      const score = d - r; // privilégie ce qui englobe franchement le réticule
      if (!best || score < best.score || (onGem && !best.onGem && d < r)) {
        best = { entity, onGem, score, proj: p };
      }
    };

    for (const e of this.entities) {
      if (!e.shootable || e.dead) continue;
      const assist = e instanceof Projectile ? 1.6 : e instanceof Bomb || e instanceof Butterfly ? 1.35 : 1.18;
      consider(e, e.pos, e.radius, false, assist);
    }
    if (this.boss && !this.boss.dead) {
      consider(this.boss, this.boss.pos, this.boss.radius, false, 1.0);
      if (this.boss.vulnerable) consider(this.boss, this.boss.gemPos(), this.boss.radius * 0.45, true, 1.5);
    }
    return best;
  }

  _miss(silent) {
    if (!silent) sfx.miss();
    if (this.combo > 0) { this.combo = 0; this.emit("combo", 0); }
  }

  _bumpCombo(count = true) {
    this.comboT = COMBO_WINDOW;
    if (count) {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.emit("combo", this.combo);
    }
  }

  _award(pos, base, label, combo = true) {
    if (combo) this._bumpCombo();
    const mult = Math.max(1, this.combo);
    const pts = base * mult;
    this.score += pts;
    this.emit("score", this.score);
    this.particles.text(pos, label || "+" + pts, mult > 1 ? "#38e8ff" : "#ffcc4d");
  }

  _heal() {
    if (this.hearts < this.maxHearts) {
      this.hearts++;
      this.emit("hearts", { hearts: this.hearts, max: this.maxHearts });
      this.emit("toast", "Vie récupérée !");
    }
    sfx.heal();
  }

  _explode(bomb) {
    sfx.bomb();
    vibrate([60, 30, 90]);
    this.shake = 0.9;
    this.particles.star(bomb.pos, "#ff8a3b", 7);
    this.particles.burst(bomb.pos, 46, "#ffc93c", 6);
    let caught = 0;
    for (const e of this.entities) {
      if (e.dead || !(e instanceof Head)) continue;
      if (this._dist(e.pos, bomb.pos) < bomb.blast) {
        e.dead = true;
        caught++;
        this.killed++;
        this.particles.burst(e.pos, 10, "#ffcc4d", 2.6);
      }
    }
    if (this.boss && this.boss.vulnerable && this._dist(this.boss.pos, bomb.pos) < bomb.blast) {
      this.boss.damage(true);
      this.emit("boss", { hp: Math.max(0, this.boss.hp), max: this.boss.maxHp });
    }
    this._award(bomb.pos, 120 + caught * 180, caught ? `💥 x${caught}` : "💥");
    this.emit("remaining", Math.max(0, this.level.quota - this.killed));
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

  _playerHit(source) {
    if (this.invul > 0 || this.phase === "done") return;
    this.invul = INVUL;
    this.hearts -= this.diff.damage;
    this.hurtFx = 1;
    this.shake = 1;
    this.combo = 0;
    this.emit("combo", 0);
    this.emit("hearts", { hearts: Math.max(0, this.hearts), max: this.maxHearts });
    sfx.hurt();
    vibrate([120, 40, 120]);
    if (this.hearts <= 0) this._finish(false, "vie");
  }

  /* ------------------------ Rendu ------------------------ */

  render() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (this.shake > 0) {
      const s = this.shake * 8;
      ctx.translate(rand(-s, s), rand(-s, s));
    }

    if (!this.useCameraFeed) this.drawRoom();

    // Tri par profondeur : le plus loin d'abord.
    const list = [];
    for (const e of this.entities) {
      const p = this.cam.project(e.pos, {});
      if (p) list.push({ e, p });
    }
    if (this.boss && !this.boss.dead) {
      const p = this.cam.project(this.boss.pos, {});
      if (p) list.push({ e: this.boss, p });
    }
    list.sort((a, b) => b.p.z - a.p.z);
    for (const item of list) item.e.draw(ctx, item.p);

    this.particles.draw(ctx, this.cam);
    ctx.restore();

    this._drawOffscreenHints(ctx);
    if (this.hurtFx > 0) this._drawHurt(ctx);
    if (this.invul > 0 && Math.floor(this.time * 12) % 2 === 0) {
      ctx.fillStyle = "rgba(230,59,46,0.05)";
      ctx.fillRect(0, 0, W, H);
    }
    this._drawRadar();
  }

  /**
   * Décor de repli : une salle en fil de fer quand la caméra n'est pas
   * disponible. Sert aussi de référence au test du gyroscope.
   */
  drawRoom() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2d3f63");
    g.addColorStop(0.52, "#1b2440");
    g.addColorStop(1, "#3a2b46");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (!this._stars) {
      this._stars = [];
      for (let i = 0; i < 140; i++) {
        const a = rand(0, TAU), b = Math.asin(rand(-0.3, 1));
        this._stars.push({ p: v3(Math.sin(a) * Math.cos(b) * 24, Math.sin(b) * 24, -Math.cos(a) * Math.cos(b) * 24), s: rand(0.6, 2) });
      }
    }

    const out = {};
    // Étoiles / poussières lumineuses
    for (const st of this._stars) {
      const p = this.cam.project(st.p, out);
      if (!p) continue;
      ctx.fillStyle = "rgba(253,243,224," + (0.3 + st.s * 0.22) + ")";
      ctx.fillRect(p.x, p.y, st.s, st.s);
    }

    // Sol quadrillé : donne immédiatement le sens de la rotation
    const FLOOR = -2.4, EXT = 22, STEP = 2.2;
    ctx.lineWidth = 1;
    const line = (fixed, axis) => {
      ctx.beginPath();
      let started = false;
      for (let t = -EXT; t <= EXT; t += STEP) {
        const p = this.cam.project(axis === "x" ? v3(fixed, FLOOR, t) : v3(t, FLOOR, fixed), out);
        if (!p) { started = false; continue; }
        if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    };
    for (let k = -EXT; k <= EXT; k += STEP) {
      const fade = 1 - Math.abs(k) / (EXT * 1.4);
      ctx.strokeStyle = "rgba(253,243,224," + (0.06 + fade * 0.2).toFixed(3) + ")";
      line(k, "x");
      line(k, "z");
    }

    // Ligne d'horizon
    ctx.strokeStyle = "rgba(230,59,46,0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (let a = 0; a <= 64; a++) {
      const ang = (a / 64) * TAU;
      const p = this.cam.project(v3(Math.sin(ang) * 26, 0, -Math.cos(ang) * 26), out);
      if (!p) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  /** Flèches vers les menaces hors champ : indispensable sur 360°. */
  _drawOffscreenHints(ctx) {
    const W = this.W, H = this.H, cx = W / 2, cy = H / 2;
    const threats = this.entities.filter((e) => e instanceof Head || e instanceof Projectile);
    if (this.boss && !this.boss.dead) threats.push(this.boss);
    const radius = Math.min(W, H) * 0.36;

    for (const e of threats) {
      const p = this.cam.project(e.pos, {});
      if (p && p.x > -30 && p.x < W + 30 && p.y > -30 && p.y < H + 30) continue;

      // Direction dans le plan de l'écran, valable même lorsque la cible est derrière.
      const sx = vDot(e.pos, this.cam.right);
      const sy = -vDot(e.pos, this.cam.up);
      const len = Math.hypot(sx, sy) || 1;
      const ux = sx / len, uy = sy / len;
      const urgent = e instanceof Projectile || (e instanceof Head && e.state === "charge");

      ctx.save();
      ctx.translate(cx + ux * radius, cy + uy * radius);
      ctx.rotate(Math.atan2(uy, ux));
      ctx.globalAlpha = urgent ? 1 : 0.65;
      ctx.beginPath();
      ctx.moveTo(15, 0); ctx.lineTo(-9, 10); ctx.lineTo(-4, 0); ctx.lineTo(-9, -10);
      ctx.closePath();
      ctx.lineJoin = "round";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#25222b";
      ctx.stroke();
      ctx.fillStyle = urgent ? "#e63b2e" : "#ffffff";
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  _drawHurt(ctx) {
    const W = this.W, H = this.H;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, "rgba(230,59,46,0)");
    g.addColorStop(1, `rgba(230,59,46,${0.6 * this.hurtFx})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  _drawRadar() {
    const c = this.radarCtx;
    if (!c) return;
    const S = this.radar.width, R = S / 2 - 8;
    c.clearRect(0, 0, S, S);
    c.save();
    c.translate(S / 2, S / 2);

    // Lunette
    c.fillStyle = "#fdf3e0";
    c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();

    // Cercles de distance
    c.strokeStyle = "rgba(37,34,43,0.22)";
    c.lineWidth = 2;
    for (const k of [0.38, 0.7]) {
      c.beginPath(); c.arc(0, 0, R * k, 0, TAU); c.stroke();
    }

    // Cône de vision
    c.fillStyle = "rgba(54,167,230,0.35)";
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, R, -Math.PI / 2 - this.cam.fov / 2, -Math.PI / 2 + this.cam.fov / 2);
    c.closePath();
    c.fill();

    // Contour d'encre
    c.strokeStyle = "#25222b";
    c.lineWidth = 5;
    c.beginPath(); c.arc(0, 0, R, 0, TAU); c.stroke();

    const pion = (e, couleur, taille) => {
      const sp = toSpherical(e.pos);
      const a = sp.yaw - this.cam.yaw - Math.PI / 2;
      const d = clamp(sp.r / 14, 0.12, 0.94) * R;
      c.fillStyle = couleur;
      c.strokeStyle = "#25222b";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(Math.cos(a) * d, Math.sin(a) * d, taille, 0, TAU);
      c.fill();
      c.stroke();
    };

    for (const e of this.entities) {
      if (e instanceof Head) pion(e, e.state === "charge" ? "#e63b2e" : "#ffffff", e.state === "charge" ? 6 : 4.5);
      else if (e instanceof Butterfly) pion(e, "#57c777", 4);
      else if (e instanceof Bomb) pion(e, "#ff8a3b", 4.5);
      else if (e instanceof Projectile) pion(e, "#b47dff", 3.5);
    }
    if (this.boss && !this.boss.dead) pion(this.boss, "#ffc93c", 8);

    // Le joueur, au centre, tourné vers le haut
    c.fillStyle = "#25222b";
    c.beginPath();
    c.moveTo(0, -7); c.lineTo(5.5, 5); c.lineTo(0, 2.5); c.lineTo(-5.5, 5);
    c.closePath();
    c.fill();
    c.restore();
  }
}

