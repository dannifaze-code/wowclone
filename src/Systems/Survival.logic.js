// /src/Systems/Survival.logic.js
// The meter brain: fatigue + hunger + thirst + rest states. Emits events for UI.

export const RestState = Object.freeze({
  None: "None",
  Camp: "Camp",
  Hub: "Hub"
});

export class Survival {
  constructor(settings) {
    const s = settings.survival;
    this.enabled = !!s.enabled;

    this.fatigue = 10; // start fairly rested
    this.hunger = 90;
    this.thirst = 90;
    this.restState = RestState.None;

    this._fatigueCfg = s.fatigue;
    this._rationsCfg = s.rations;
    this._invCfg = s.inventory;

    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();

    this._lastTickMs = performance.now();
  }

  on(eventName, fn) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
    this._listeners.get(eventName).add(fn);
  }

  emit(eventName, payload) {
    const set = this._listeners.get(eventName);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  fatigueState() {
    const f = this.fatigue;
    if (f >= this._fatigueCfg.exhaustedThreshold) return "Exhausted";
    if (f >= this._fatigueCfg.tiredThreshold) return "Tired";
    return "Normal";
  }

  hungerState() {
    if (this.hunger <= 10) return "Starving";
    if (this.hunger <= 25) return "Hungry";
    return "Normal";
  }

  thirstState() {
    if (this.thirst <= 10) return "Dehydrated";
    if (this.thirst <= 25) return "Thirsty";
    return "Normal";
  }

  setRestState(newState) {
    if (this.restState === newState) return;
    this.restState = newState;
    this.emit("OnRestStateChanged", { restState: newState });
  }

  penalties(encumbrancePercent) {
    // Smooth penalties: scale factors.
    const tired = this.fatigue >= this._fatigueCfg.tiredThreshold;
    const exhausted = this.fatigue >= this._fatigueCfg.exhaustedThreshold;

    let moveSpeedScalar = 1.0;
    let staminaRegenScalar = 1.0;
    let combatEffectivenessScalar = 1.0;

    if (tired) staminaRegenScalar *= (1 - (this._fatigueCfg.staminaPenaltyAtTiredPercent / 100));
    if (exhausted) {
      staminaRegenScalar *= (1 - (this._fatigueCfg.staminaPenaltyAtExhaustedPercent / 100));
      moveSpeedScalar *= (1 - (this._fatigueCfg.moveSpeedPenaltyAtExhaustedPercent / 100));
    }

    // Hunger/thirst: mild combat penalty when low
    const lowHunger = this.hunger <= this._rationsCfg.combatPenaltyBelowHunger;
    const lowThirst = this.thirst <= this._rationsCfg.combatPenaltyBelowThirst;
    if (lowHunger || lowThirst) {
      combatEffectivenessScalar *= (1 - (this._rationsCfg.penaltyAmountPercent / 100));
    }

    // Encumbrance: soft/hard cap effects
    const soft = this._invCfg.encumbranceSoftCapPercent;
    const hard = this._invCfg.encumbranceHardCapPercent;
    if (encumbrancePercent > soft) {
      const t = Math.min(1, (encumbrancePercent - soft) / Math.max(1, hard - soft));
      moveSpeedScalar *= (1 - 0.10 * t); // up to -10%
    }
    if (encumbrancePercent > hard) {
      moveSpeedScalar *= 0.85; // extra -15% beyond hard cap
      staminaRegenScalar *= 0.85;
    }

    return { moveSpeedScalar, staminaRegenScalar, combatEffectivenessScalar };
  }

  tick({ movementMode, encumbrancePercent, environmentFlags }) {
    if (!this.enabled) return;

    const now = performance.now();
    const dt = Math.max(0, (now - this._lastTickMs) / 1000);
    this._lastTickMs = now;

    const prevFatigueState = this.fatigueState();
    const prevHungerState = this.hungerState();
    const prevThirstState = this.thirstState();

    // Hunger/Thirst drain (per minute -> per second)
    let hungerDrain = (this._rationsCfg.hungerDrainPerMinute / 60) * dt;
    let thirstDrain = (this._rationsCfg.thirstDrainPerMinute / 60) * dt;

    if (environmentFlags?.cold) {
      hungerDrain *= 1 + (this._rationsCfg.extraDrainInColdPercent / 100);
      thirstDrain *= 1 + 0.05;
    }
    if (environmentFlags?.heat) {
      thirstDrain *= 1 + (this._rationsCfg.extraDrainInHeatPercent / 100);
      hungerDrain *= 1 + 0.05;
    }

    // Fatigue drain or recovery
    let fatigueDelta = 0;

    if (this.restState === RestState.Camp) {
      fatigueDelta -= (this._fatigueCfg.regenPerMinuteInCamp / 60) * dt;
    } else if (this.restState === RestState.Hub) {
      fatigueDelta -= (this._fatigueCfg.regenPerMinuteInHub / 60) * dt;
    } else {
      if (movementMode === "run") fatigueDelta += (this._fatigueCfg.drainPerMinuteRunning / 60) * dt;
      else if (movementMode === "walk") fatigueDelta += (this._fatigueCfg.drainPerMinuteWalking / 60) * dt;
    }

    // Encumbrance amplifies fatigue when heavy
    const hard = this._invCfg.encumbranceHardCapPercent;
    if (encumbrancePercent > hard) {
      fatigueDelta += (this._fatigueCfg.drainPerMinuteOverEncumbered / 60) * dt;
      hungerDrain *= 1.15;
      thirstDrain *= 1.15;
    }

    // Apply drains
    this.hunger = clamp(this.hunger - hungerDrain, 0, this._rationsCfg.hungerMax);
    this.thirst = clamp(this.thirst - thirstDrain, 0, this._rationsCfg.thirstMax);
    this.fatigue = clamp(this.fatigue + fatigueDelta, 0, this._fatigueCfg.max);

    // Threshold events
    const newFatigueState = this.fatigueState();
    const newHungerState = this.hungerState();
    const newThirstState = this.thirstState();
    if (newFatigueState !== prevFatigueState) this.emit("OnFatigueStateChanged", { state: newFatigueState });
    if (newHungerState !== prevHungerState) this.emit("OnHungerStateChanged", { state: newHungerState });
    if (newThirstState !== prevThirstState) this.emit("OnThirstStateChanged", { state: newThirstState });
  }

  async consume(itemDef, kind) {
    // kind: 'eat' | 'drink' | 'camp'
    const cfg = this._rationsCfg.consume;
    const time = itemDef.consumeTimeSeconds ?? (kind === "drink" ? cfg.drinkingTimeSeconds : cfg.eatingTimeSeconds);
    return { channelSeconds: time };
  }

  applyConsumeEffect(itemDef) {
    const h = itemDef.hungerRestore ?? 0;
    const t = itemDef.thirstRestore ?? 0;
    this.hunger = clamp(this.hunger + h, 0, this._rationsCfg.hungerMax);
    this.thirst = clamp(this.thirst + t, 0, this._rationsCfg.thirstMax);
    // Eating/Drinking slightly reduces fatigue (you feel human again)
    this.fatigue = clamp(this.fatigue - 1.5, 0, this._fatigueCfg.max);
  }

  toJSON() {
    return {
      fatigue: this.fatigue,
      hunger: this.hunger,
      thirst: this.thirst,
      restState: this.restState
    };
  }

  static fromJSON(obj, settings) {
    const s = new Survival(settings);
    if (!obj) return s;
    s.fatigue = obj.fatigue ?? s.fatigue;
    s.hunger = obj.hunger ?? s.hunger;
    s.thirst = obj.thirst ?? s.thirst;
    s.restState = obj.restState ?? s.restState;
    return s;
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
