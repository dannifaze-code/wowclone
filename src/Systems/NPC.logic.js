// /src/Systems/NPC.logic.js
// NPC spawning, AI patrol, and dialogue interaction.

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

export class NPCManager {
  constructor(scene, npcRegistry, zoneId) {
    this.scene = scene;
    this.npcs = [];
    this._spawnNPCs(npcRegistry, zoneId);
  }

  _spawnNPCs(registry, zoneId) {
    for (const def of registry) {
      if (def.zone !== zoneId) continue;
      const npc = new NPC(def, this.scene);
      this.npcs.push(npc);
    }
  }

  update(dt, playerPos) {
    for (const npc of this.npcs) {
      npc.update(dt, playerPos);
    }
  }

  /** Returns the closest interactable NPC within range, or null */
  getInteractable(playerPos, range = 3.0) {
    let closest = null;
    let closestDist = range;
    for (const npc of this.npcs) {
      if (npc.dead) continue;
      const d = npc.mesh.position.distanceTo(playerPos);
      if (d < closestDist) {
        closestDist = d;
        closest = npc;
      }
    }
    return closest;
  }

  /** Returns hostile NPCs in aggro range */
  getHostilesInRange(playerPos, range = 10.0) {
    const result = [];
    for (const npc of this.npcs) {
      if (npc.dead || !npc.def.hostile) continue;
      const d = npc.mesh.position.distanceTo(playerPos);
      if (d < range) result.push({ npc, distance: d });
    }
    return result;
  }

  removeNPC(npc) {
    const idx = this.npcs.indexOf(npc);
    if (idx >= 0) this.npcs.splice(idx, 1);
    npc.destroy(this.scene);
  }
}

export class NPC {
  constructor(def, scene) {
    this.def = def;
    this.dead = false;
    this.health = def.stats?.health ?? 50;
    this.maxHealth = this.health;

    // Patrol state
    this._patrolOrigin = new THREE.Vector3(def.position.x, 0, def.position.z);
    this._patrolTarget = this._randomPatrolPoint();
    this._patrolTimer = 0;
    this._patrolWait = 0;
    this._aggroed = false;

    // Build mesh
    const color = def.hostile ? 0xcc3333 : 0x55aa77;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
      emissive: def.hostile ? 0x440000 : 0x002200,
      emissiveIntensity: 0.15
    });
    this.mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 0.8, 8, 16),
      mat
    );
    this.mesh.position.set(def.position.x, 1, def.position.z);
    scene.add(this.mesh);

    // Name label (sprite)
    this.label = this._makeLabel(def.name, def.hostile);
    this.label.position.set(def.position.x, 2.4, def.position.z);
    scene.add(this.label);

    // Health bar (only for hostiles)
    this.healthBar = null;
    if (def.hostile) {
      this.healthBar = this._makeHealthBar();
      this.healthBar.position.set(def.position.x, 2.1, def.position.z);
      scene.add(this.healthBar);
    }
  }

  update(dt, playerPos) {
    if (this.dead) return;

    const distToPlayer = this.mesh.position.distanceTo(playerPos);

    if (this.def.hostile && distToPlayer < 12) {
      // Chase player
      this._aggroed = true;
      const dir = new THREE.Vector3().subVectors(playerPos, this.mesh.position).normalize();
      const speed = 2.5;
      // Stop at melee range
      if (distToPlayer > 1.8) {
        this.mesh.position.x += dir.x * speed * dt;
        this.mesh.position.z += dir.z * speed * dt;
      }
    } else {
      this._aggroed = false;
      // Idle patrol
      this._patrolWait -= dt;
      if (this._patrolWait <= 0) {
        const dir = new THREE.Vector3().subVectors(this._patrolTarget, this.mesh.position);
        if (dir.length() < 0.5) {
          this._patrolTarget = this._randomPatrolPoint();
          this._patrolWait = 2 + Math.random() * 3;
        } else {
          dir.normalize();
          const speed = 0.8;
          this.mesh.position.x += dir.x * speed * dt;
          this.mesh.position.z += dir.z * speed * dt;
        }
      }
    }

    // Update label + health bar positions
    this.label.position.set(this.mesh.position.x, 2.4, this.mesh.position.z);
    if (this.healthBar) {
      this.healthBar.position.set(this.mesh.position.x, 2.1, this.mesh.position.z);
      // Update health bar scale
      const pct = Math.max(0, this.health / this.maxHealth);
      this.healthBar.children[1].scale.x = pct;
      this.healthBar.children[1].position.x = -(1 - pct) * 0.5;
    }
  }

  takeDamage(amount) {
    if (this.dead) return false;
    this.health -= amount;
    // Flash red
    this.mesh.material.emissive.setHex(0xff0000);
    this.mesh.material.emissiveIntensity = 0.6;
    setTimeout(() => {
      if (!this.dead) {
        this.mesh.material.emissive.setHex(this.def.hostile ? 0x440000 : 0x002200);
        this.mesh.material.emissiveIntensity = 0.15;
      }
    }, 120);

    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      return true; // died
    }
    return false;
  }

  getDialogue(type = "greeting") {
    return this.def.dialogue?.[type] ?? null;
  }

  destroy(scene) {
    scene.remove(this.mesh);
    scene.remove(this.label);
    if (this.healthBar) scene.remove(this.healthBar);
    this.mesh.geometry?.dispose?.();
    this.mesh.material?.dispose?.();
  }

  _randomPatrolPoint() {
    const r = 4;
    return new THREE.Vector3(
      this._patrolOrigin.x + (Math.random() - 0.5) * r * 2,
      0,
      this._patrolOrigin.z + (Math.random() - 0.5) * r * 2
    );
  }

  _makeLabel(text, hostile) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.font = "bold 28px system-ui, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = hostile ? "#ff4444" : "#88ddaa";
    ctx.fillText(text, 128, 40);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.5, 0.6, 1);
    return sprite;
  }

  _makeHealthBar() {
    const group = new THREE.Group();

    // Background bar (dark)
    const bgGeo = new THREE.PlaneGeometry(1, 0.08);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.7, depthTest: false });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    group.add(bg);

    // Foreground bar (red)
    const fgGeo = new THREE.PlaneGeometry(1, 0.08);
    const fgMat = new THREE.MeshBasicMaterial({ color: 0xff3333, depthTest: false });
    const fg = new THREE.Mesh(fgGeo, fgMat);
    group.add(fg);

    return group;
  }
}
