// /src/Systems/Inventory.logic.js
// Lightweight inventory: slots + stacks + weight. No UI here.

export class Inventory {
  constructor({ maxSlots, baseCarryWeight }) {
    this.maxSlots = maxSlots;
    this.baseCarryWeight = baseCarryWeight;
    /** @type {Map<string, {id:string, qty:number}>} */
    this.stacks = new Map();
  }

  slotsUsed() { return this.stacks.size; }

  canAdd(itemDef, qty=1) {
    const existing = this.stacks.get(itemDef.id);
    if (existing) return (existing.qty + qty) <= (itemDef.stackMax ?? 1);
    return this.slotsUsed() < this.maxSlots;
  }

  add(itemDef, qty=1) {
    if (!this.canAdd(itemDef, qty)) return false;
    const existing = this.stacks.get(itemDef.id);
    if (existing) existing.qty += qty;
    else this.stacks.set(itemDef.id, { id: itemDef.id, qty });
    return true;
  }

  remove(itemId, qty=1) {
    const existing = this.stacks.get(itemId);
    if (!existing) return false;
    if (existing.qty < qty) return false;
    existing.qty -= qty;
    if (existing.qty <= 0) this.stacks.delete(itemId);
    return true;
  }

  count(itemId) {
    const st = this.stacks.get(itemId);
    return st ? st.qty : 0;
  }

  totalWeight(itemRegistry) {
    let w = 0;
    for (const {id, qty} of this.stacks.values()) {
      const def = itemRegistry.get(id);
      if (!def) continue;
      w += (def.weight ?? 0) * qty;
    }
    return w;
  }

  encumbrancePercent(itemRegistry) {
    const current = this.totalWeight(itemRegistry);
    return (current / this.baseCarryWeight) * 100;
  }

  toJSON() {
    return {
      maxSlots: this.maxSlots,
      baseCarryWeight: this.baseCarryWeight,
      stacks: Array.from(this.stacks.values())
    };
  }

  static fromJSON(obj) {
    const inv = new Inventory({ maxSlots: obj.maxSlots, baseCarryWeight: obj.baseCarryWeight });
    for (const st of (obj.stacks ?? [])) inv.stacks.set(st.id, { id: st.id, qty: st.qty });
    return inv;
  }
}
