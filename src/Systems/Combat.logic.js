// /src/Systems/Combat.logic.js
// Simple combat: player stats, attack cooldown, damage numbers, loot drops.

export class Combat {
  constructor({ baseHealth, baseDamage, attackCooldown, attackRange }) {
    this.maxHealth = baseHealth;
    this.health = baseHealth;
    this.baseDamage = baseDamage;
    this.attackCooldown = attackCooldown;  // seconds
    this.attackRange = attackRange;
    this._cooldownRemaining = 0;
    this._listeners = new Map();
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  tick(dt) {
    if (this._cooldownRemaining > 0) {
      this._cooldownRemaining = Math.max(0, this._cooldownRemaining - dt);
    }
  }

  canAttack() {
    return this._cooldownRemaining <= 0;
  }

  /** Attempt to attack a target NPC. Returns damage dealt or 0. */
  attack(targetNPC, combatEffectiveness = 1.0) {
    if (!this.canAttack()) return 0;
    if (targetNPC.dead) return 0;

    this._cooldownRemaining = this.attackCooldown;

    // Damage calculation with slight variance
    const variance = 0.85 + Math.random() * 0.3; // 0.85 - 1.15
    const dmg = Math.round(this.baseDamage * combatEffectiveness * variance);

    const killed = targetNPC.takeDamage(dmg);
    this.emit("OnAttack", { target: targetNPC, damage: dmg, killed });

    return dmg;
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    this.emit("OnDamaged", { damage: amount, health: this.health });
    if (this.health <= 0) {
      this.emit("OnDeath", {});
    }
    return this.health;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  get isDead() {
    return this.health <= 0;
  }

  get cooldownPercent() {
    return this.attackCooldown > 0 ? this._cooldownRemaining / this.attackCooldown : 0;
  }

  toJSON() {
    return { health: this.health, maxHealth: this.maxHealth };
  }

  static fromJSON(obj, opts) {
    const c = new Combat(opts);
    if (obj) {
      c.health = obj.health ?? c.health;
      c.maxHealth = obj.maxHealth ?? c.maxHealth;
    }
    return c;
  }
}
