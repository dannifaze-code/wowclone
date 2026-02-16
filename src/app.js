// /src/app.js
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { Inventory } from "./Systems/Inventory.logic.js";
import { Survival, RestState } from "./Systems/Survival.logic.js";
import { NPCManager, NPC } from "./Systems/NPC.logic.js";
import { Combat } from "./Systems/Combat.logic.js";

const canvas = document.getElementById("game");
const hudBars = document.getElementById("bars");
const hudStatus = document.getElementById("status");
const hudInv = document.getElementById("inv");
const toastEl = document.getElementById("toast");
const hudTarget = document.getElementById("target-info");
const hudXP = document.getElementById("xp-bar");
const hudDialogue = document.getElementById("dialogue-box");
const hudHealth = document.getElementById("player-health");
const hudCombatLog = document.getElementById("combat-log");

const SAVE_KEY = "ember_iron_phase2_save_v1";

const state = {
  settings: null,
  itemRegistry: new Map(),
  npcRegistry: [],
  zoneRegistry: [],
  inventory: null,
  survival: null,
  combat: null,
  npcManager: null,
  channel: null,
  keys: new Set(),
  player: { pos: new THREE.Vector3(0, 1, 0), vel: new THREE.Vector3(), yaw: 0, level: 1, xp: 0, xpToNext: 100 },
  cameraMode: "third",
  zone: "Union Border Outpost",
  pickups: [],
  env: { cold: false, heat: false },
  lastFrameMs: performance.now(),
  targetNPC: null,
  dialogueActive: false,
  damageNumbers: [],
  killCount: 0,
  respawnTimers: [],
  _attackHeld: false
};

main().catch(err => {
  console.error(err);
  hudStatus.textContent = "Error booting. Check console.";
});

async function main() {
  hudStatus.textContent = "Loading settings + registries…";

  const [settings, items, npcs, zones] = await Promise.all([
    fetchJSON("./config/settings.json"),
    fetchJSON("./data/Registry/Items.json"),
    fetchJSON("./data/Registry/NPCs.json"),
    fetchJSON("./data/Registry/Zones.json")
  ]);

  state.settings = settings;
  for (const it of items.items) state.itemRegistry.set(it.id, it);
  state.npcRegistry = npcs.npcs;
  state.zoneRegistry = zones.zones;

  // Load saved state
  const saved = loadSave();
  if (saved) {
    state.inventory = Inventory.fromJSON(saved.inventory);
    state.survival = Survival.fromJSON(saved.survival, state.settings);
    state.combat = Combat.fromJSON(saved.combat, { baseHealth: 100, baseDamage: 12, attackCooldown: 1.0, attackRange: 2.5 });
    state.player.level = saved.level ?? 1;
    state.player.xp = saved.xp ?? 0;
    state.player.xpToNext = saved.xpToNext ?? 100;
    state.killCount = saved.killCount ?? 0;
    showToast("Woke up where you left off. The road remembers.");
  } else {
    state.inventory = new Inventory({
      maxSlots: state.settings.survival.inventory.maxSlots,
      baseCarryWeight: state.settings.survival.inventory.baseCarryWeight
    });
    state.survival = new Survival(state.settings);
    state.combat = new Combat({ baseHealth: 100, baseDamage: 12, attackCooldown: 1.0, attackRange: 2.5 });

    // Starter supplies
    state.inventory.add(state.itemRegistry.get("ration_jerky"), 3);
    state.inventory.add(state.itemRegistry.get("water_waterskin"), 1);
    state.inventory.add(state.itemRegistry.get("camp_campkit"), 1);
  }

  // Combat events
  state.combat.on("OnAttack", ({ target, damage, killed }) => {
    spawnDamageNumber(target.mesh.position, damage, false);
    addCombatLog(`You hit ${target.def.name} for ${damage} damage.`);
    if (killed) {
      addCombatLog(`${target.def.name} defeated!`);
      state.killCount++;
      const xpGain = 25 + Math.floor(Math.random() * 15);
      gainXP(xpGain);
      // Drop loot
      if (target.def.lootTable) {
        const lootId = target.def.lootTable[Math.floor(Math.random() * target.def.lootTable.length)];
        const lootDef = state.itemRegistry.get(lootId);
        if (lootDef) {
          const qty = Math.ceil(Math.random() * 2);
          const ok = state.inventory.add(lootDef, qty);
          if (ok) showToast(`Looted: ${lootDef.name} x${qty}`);
          else showToast("Inventory full — loot lost.", 1400);
        }
      }
      // Schedule respawn
      state.respawnTimers.push({ def: target.def, time: 15000, elapsed: 0 });
      if (state.targetNPC === target) state.targetNPC = null;
    }
  });
  state.combat.on("OnDamaged", ({ damage, health }) => {
    spawnDamageNumber(state.player.pos, damage, true);
    addCombatLog(`You take ${damage} damage. (HP: ${health}/${state.combat.maxHealth})`);
  });
  state.combat.on("OnDeath", () => {
    showToast("You have fallen. Respawning at outpost…", 3000);
    addCombatLog("You died! Respawning…");
    setTimeout(() => {
      state.combat.health = state.combat.maxHealth;
      state.player.pos.set(0, 1, 0);
      state.targetNPC = null;
    }, 2000);
  });

  // Survival events
  state.survival.on("OnFatigueStateChanged", ({ state: st }) => showToast(fatigueLine(st)));
  state.survival.on("OnHungerStateChanged", ({ state: st }) => showToast(hungerLine(st)));
  state.survival.on("OnThirstStateChanged", ({ state: st }) => showToast(thirstLine(st)));

  // Three.js boot
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 20, 70);

  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 6, 10);

  // Lighting
  const hemi = new THREE.HemisphereLight(0xffcc88, 0x445566, 0.9);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffeedd, 0.8);
  dir.position.set(10, 14, 6);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  scene.add(dir);
  const ambient = new THREE.AmbientLight(0x334455, 0.3);
  scene.add(ambient);

  // Ground with grid texture
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200, 40, 40),
    new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 1.0, metalness: 0.0, wireframe: false })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Terrain features: rocks, trees, path markers
  buildEnvironment(scene);

  // Player capsule
  const playerMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 0.9, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xcfc8ba, roughness: 0.8, metalness: 0.05 })
  );
  playerMesh.castShadow = true;
  playerMesh.position.copy(state.player.pos);
  scene.add(playerMesh);

  // NPCs
  state.npcManager = new NPCManager(scene, state.npcRegistry, "union_border_outpost");

  // Pickups
  spawnPickups(scene);

  // Input
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    state.keys.add(key);
    if (key === "1") tryConsume("ration_jerky", "eat");
    if (key === "2") tryConsume("water_waterskin", "drink");
    if (key === "c") tryMakeCamp();
    if (key === "e") tryInteract();
    if (key === " ") { e.preventDefault(); state._attackHeld = true; tryAttack(); }
    if (key === "tab") { e.preventDefault(); cycleTarget(); }
    if (key === "escape") { state.targetNPC = null; closeDialogue(); }
    if (key === "r") tryRespawnSelf();
  });
  window.addEventListener("keyup", (e) => {
    state.keys.delete(e.key.toLowerCase());
    if (e.key === " ") state._attackHeld = false;
  });
  window.addEventListener("blur", () => { state.keys.clear(); state._attackHeld = false; });

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // Main loop
  hudStatus.textContent = "Ready. The road is long. Your backpack is short.";

  function frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - state.lastFrameMs) / 1000);
    state.lastFrameMs = now;

    update(dt, scene, camera, playerMesh);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Autosave
  setInterval(() => save(), 4000);
}

function update(dt, scene, camera, playerMesh) {
  if (state.combat.isDead) {
    renderHUD(0, { moveSpeedScalar: 1, staminaRegenScalar: 1, combatEffectivenessScalar: 1 });
    return;
  }

  // Movement
  const enc = state.inventory.encumbrancePercent(state.itemRegistry);
  const pens = state.survival.penalties(enc);

  const baseSpeed = 4.0;
  const sprintSpeed = 6.5;
  const isSprinting = state.keys.has("shift");
  const speed = (isSprinting ? sprintSpeed : baseSpeed) * pens.moveSpeedScalar;

  const forward = (state.keys.has("w") ? 1 : 0) + (state.keys.has("s") ? -1 : 0);
  const strafe = (state.keys.has("d") ? 1 : 0) + (state.keys.has("a") ? -1 : 0);

  const moveVec = new THREE.Vector3(strafe, 0, forward);
  if (moveVec.lengthSq() > 0) {
    moveVec.normalize();
    state.player.pos.x += moveVec.x * speed * dt;
    state.player.pos.z += moveVec.z * speed * dt;
    state.survival.setRestState(RestState.None);
    if (state.dialogueActive) closeDialogue();
  }

  state.player.pos.x = clamp(state.player.pos.x, -40, 40);
  state.player.pos.z = clamp(state.player.pos.z, -40, 40);
  playerMesh.position.copy(state.player.pos);

  // Camera follow
  const camTarget = new THREE.Vector3(state.player.pos.x, 1.2, state.player.pos.z);
  const camPos = new THREE.Vector3(state.player.pos.x + 7, 7, state.player.pos.z + 10);
  camera.position.lerp(camPos, 1 - Math.pow(0.001, dt));
  camera.lookAt(camTarget);

  // Survival tick
  const movementMode = (moveVec.lengthSq() === 0) ? "idle" : (isSprinting ? "run" : "walk");
  state.survival.tick({ movementMode, encumbrancePercent: enc, environmentFlags: state.env });

  // Combat tick
  state.combat.tick(dt);

  // NPC updates
  state.npcManager.update(dt, state.player.pos);

  // Enemy attacks on player
  const hostiles = state.npcManager.getHostilesInRange(state.player.pos, 2.0);
  for (const { npc } of hostiles) {
    if (!npc._attackTimer) npc._attackTimer = 0;
    npc._attackTimer -= dt;
    if (npc._attackTimer <= 0) {
      const dmg = npc.def.stats?.damage ?? 5;
      const variance = 0.8 + Math.random() * 0.4;
      const actualDmg = Math.round(dmg * variance);
      state.combat.takeDamage(actualDmg);
      npc._attackTimer = 1.5 + Math.random() * 0.5;
    }
  }

  // Clean dead NPCs after delay
  for (const npc of state.npcManager.npcs) {
    if (npc.dead && !npc._deathCleanup) {
      npc._deathCleanup = true;
      setTimeout(() => state.npcManager.removeNPC(npc), 3000);
    }
  }

  // Respawn timers
  for (let i = state.respawnTimers.length - 1; i >= 0; i--) {
    state.respawnTimers[i].elapsed += dt * 1000;
    if (state.respawnTimers[i].elapsed >= state.respawnTimers[i].time) {
      const def = state.respawnTimers[i].def;
      // Respawn NPC
      const respawned = new NPC(def, state._scene);
      state.npcManager.npcs.push(respawned);
      state.respawnTimers.splice(i, 1);
    }
  }

  // Channeling
  if (state.channel && performance.now() >= state.channel.endsAtMs) {
    const ch = state.channel;
    state.channel = null;
    if (ch.kind === "eat" || ch.kind === "drink") {
      const def = state.itemRegistry.get(ch.itemId);
      state.survival.applyConsumeEffect(def);
      showToast(`${def.name} consumed. The Ember in your belly flickers brighter.`);
    } else if (ch.kind === "camp") {
      state.survival.setRestState(RestState.Camp);
      showToast("Camp set. A small island of safety in a hungry world.");
    }
  }

  // Pickup collisions
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    const d = p.mesh.position.distanceTo(state.player.pos);
    // Rotate pickups
    p.mesh.rotation.y += dt * 1.5;
    p.mesh.position.y = 0.25 + Math.sin(performance.now() * 0.003 + i) * 0.1;
    if (d < 1.1) {
      const def = state.itemRegistry.get(p.itemId);
      const ok = state.inventory.add(def, p.qty);
      if (ok) {
        showToast(`Picked up: ${def.name} x${p.qty}`);
        scene.remove(p.mesh);
        disposeMesh(p.mesh);
        state.pickups.splice(i, 1);
      }
    }
  }

  // Damage numbers
  updateDamageNumbers(dt, camera);

  // HUD
  renderHUD(enc, pens);
}

function tryAttack() {
  if (state.combat.isDead) return;
  if (!state.combat.canAttack()) return;

  // Auto-target closest hostile if no target
  if (!state.targetNPC || state.targetNPC.dead || !state.targetNPC.def.hostile) {
    const hostiles = state.npcManager.getHostilesInRange(state.player.pos, 8);
    if (hostiles.length > 0) {
      hostiles.sort((a, b) => a.distance - b.distance);
      state.targetNPC = hostiles[0].npc;
    }
  }

  if (!state.targetNPC || state.targetNPC.dead) {
    showToast("No target.", 600);
    return;
  }

  const dist = state.targetNPC.mesh.position.distanceTo(state.player.pos);
  if (dist > state.combat.attackRange) {
    showToast("Too far away.", 600);
    return;
  }

  if (!state.targetNPC.def.hostile) {
    showToast("Cannot attack friendly NPCs.", 800);
    return;
  }

  const enc = state.inventory.encumbrancePercent(state.itemRegistry);
  const pens = state.survival.penalties(enc);
  state.combat.attack(state.targetNPC, pens.combatEffectivenessScalar);
}

function tryInteract() {
  const npc = state.npcManager.getInteractable(state.player.pos, 3.0);
  if (!npc) {
    showToast("Nothing to interact with.", 800);
    return;
  }

  if (npc.def.hostile && !npc.dead) {
    state.targetNPC = npc;
    showToast(`Targeted: ${npc.def.name}`, 800);
    return;
  }

  // Dialogue
  const greeting = npc.getDialogue("greeting");
  if (greeting) {
    state.dialogueActive = true;
    showDialogue(npc.def.name, greeting);
  }
}

function cycleTarget() {
  const allNear = state.npcManager.getHostilesInRange(state.player.pos, 15);
  if (allNear.length === 0) {
    state.targetNPC = null;
    showToast("No enemies nearby.", 600);
    return;
  }
  allNear.sort((a, b) => a.distance - b.distance);

  const currentIdx = allNear.findIndex(h => h.npc === state.targetNPC);
  const next = (currentIdx + 1) % allNear.length;
  state.targetNPC = allNear[next].npc;
  showToast(`Target: ${state.targetNPC.def.name}`, 700);
}

function tryRespawnSelf() {
  if (!state.combat.isDead) return;
  state.combat.health = state.combat.maxHealth;
  state.player.pos.set(0, 1, 0);
  state.targetNPC = null;
  showToast("Respawned at outpost.", 1200);
}

function gainXP(amount) {
  state.player.xp += amount;
  showToast(`+${amount} XP`, 800);
  while (state.player.xp >= state.player.xpToNext) {
    state.player.xp -= state.player.xpToNext;
    state.player.level++;
    state.player.xpToNext = Math.floor(state.player.xpToNext * 1.5);
    state.combat.maxHealth += 10;
    state.combat.health = state.combat.maxHealth;
    state.combat.baseDamage += 2;
    showToast(`LEVEL UP! You are now level ${state.player.level}!`, 2500);
    addCombatLog(`Level up! Now level ${state.player.level}. +10 HP, +2 DMG.`);
  }
}

function showDialogue(name, text) {
  if (!hudDialogue) return;
  hudDialogue.innerHTML = `<strong>${name}:</strong> "${text}"<div class="tiny" style="margin-top:4px; opacity:0.7;">Press E to close • ESC to dismiss</div>`;
  hudDialogue.classList.add("show");
}

function closeDialogue() {
  state.dialogueActive = false;
  if (hudDialogue) hudDialogue.classList.remove("show");
}

function addCombatLog(msg) {
  if (!hudCombatLog) return;
  const line = document.createElement("div");
  line.textContent = msg;
  hudCombatLog.appendChild(line);
  // Keep only last 6 lines
  while (hudCombatLog.children.length > 6) hudCombatLog.removeChild(hudCombatLog.firstChild);
  hudCombatLog.scrollTop = hudCombatLog.scrollHeight;
}

function spawnDamageNumber(position, amount, isPlayerDamage) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 36px system-ui, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3;
  ctx.fillStyle = isPlayerDamage ? "#ff4444" : "#ffdd00";
  const text = `-${amount}`;
  ctx.strokeText(text, 64, 44);
  ctx.fillText(text, 64, 44);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.75, 1);
  sprite.position.set(
    position.x + (Math.random() - 0.5) * 0.5,
    position.y + 1.5,
    position.z + (Math.random() - 0.5) * 0.5
  );

  const sceneRef = sprite;
  // Find scene via canvas parent
  if (canvas.parentElement) return;

  state.damageNumbers.push({ sprite, age: 0, maxAge: 1.2 });
  // Add to scene — we need a reference, store on state
  if (state._scene) state._scene.add(sprite);
}

function updateDamageNumbers(dt, camera) {
  for (let i = state.damageNumbers.length - 1; i >= 0; i--) {
    const dn = state.damageNumbers[i];
    dn.age += dt;
    dn.sprite.position.y += dt * 1.5;
    dn.sprite.material.opacity = Math.max(0, 1 - dn.age / dn.maxAge);
    if (dn.age >= dn.maxAge) {
      if (state._scene) state._scene.remove(dn.sprite);
      dn.sprite.material.dispose();
      state.damageNumbers.splice(i, 1);
    }
  }
}

function renderHUD(encPercent, pens) {
  const w = state.inventory.totalWeight(state.itemRegistry);
  const slots = state.inventory.slotsUsed();
  const maxSlots = state.inventory.maxSlots;

  const fatigue = state.survival.fatigue;
  const hunger = state.survival.hunger;
  const thirst = state.survival.thirst;

  const fatState = state.survival.fatigueState();
  const hunState = state.survival.hungerState();
  const thiState = state.survival.thirstState();

  document.getElementById("zone").textContent = state.zone;

  const statusBits = [];
  if (state.combat.isDead) statusBits.push("DEAD — press R to respawn");
  else {
    if (fatState !== "Normal") statusBits.push(`Fatigue: ${fatState}`);
    if (hunState !== "Normal") statusBits.push(`Hunger: ${hunState}`);
    if (thiState !== "Normal") statusBits.push(`Thirst: ${thiState}`);
    if (encPercent > state.settings.survival.inventory.encumbranceSoftCapPercent) statusBits.push("Encumbered");
  }

  const channelText = state.channel ? ` • ${state.channel.kind.toUpperCase()}…` : "";
  hudStatus.textContent = (statusBits.length ? statusBits.join(" • ") : "Steady.") + channelText;

  hudBars.innerHTML = "";
  hudBars.appendChild(makeBar("HP", state.combat.health, state.combat.maxHealth, "green"));
  hudBars.appendChild(makeBar("Fatigue", fatigue, 100, "red"));
  hudBars.appendChild(makeBar("Hunger", hunger, 100, ""));
  hudBars.appendChild(makeBar("Thirst", thirst, 100, "blue"));

  // XP bar
  if (hudXP) {
    const xpPct = (state.player.xp / state.player.xpToNext * 100).toFixed(0);
    hudXP.innerHTML = `Lv.${state.player.level} — XP: ${state.player.xp}/${state.player.xpToNext} (${xpPct}%) • Kills: ${state.killCount}`;
  }

  // Player health quick display
  if (hudHealth) {
    hudHealth.textContent = `HP: ${state.combat.health}/${state.combat.maxHealth} • DMG: ${state.combat.baseDamage}`;
  }

  const encLabel = encPercent.toFixed(0) + "%";
  const movePct = Math.round((pens.moveSpeedScalar) * 100);
  hudInv.textContent = `Inv: ${slots}/${maxSlots} • Wt: ${w.toFixed(1)}/${state.inventory.baseCarryWeight.toFixed(1)} • Enc: ${encLabel} • Spd: ${movePct}%`;

  // Target info
  if (hudTarget) {
    if (state.targetNPC && !state.targetNPC.dead) {
      const t = state.targetNPC;
      const hpPct = Math.round(t.health / t.maxHealth * 100);
      hudTarget.innerHTML = `<span style="color:${t.def.hostile ? '#ff6666' : '#88ddaa'}">${t.def.name}</span> — HP: ${t.health}/${t.maxHealth} (${hpPct}%)`;
      hudTarget.classList.add("show");
    } else {
      hudTarget.classList.remove("show");
    }
  }
}

function makeBar(label, val, max, kind) {
  const row = document.createElement("div");
  row.className = "barRow";
  const left = document.createElement("div");
  left.textContent = label;
  left.className = "tiny";
  const outer = document.createElement("div");
  outer.className = "barOuter";
  const inner = document.createElement("div");
  inner.className = "barInner" + (kind === "blue" ? " blue" : kind === "red" ? " red" : kind === "green" ? " green" : "");
  inner.style.width = `${Math.max(0, Math.min(100, (val / max) * 100))}%`;
  outer.appendChild(inner);
  const right = document.createElement("div");
  right.textContent = `${Math.round(val)}`;
  right.className = "tiny";
  row.append(left, outer, right);
  return row;
}

async function tryConsume(itemId, kind) {
  if (state.combat.isDead) return;
  if (state.channel) return showToast("Busy. Finish what you're doing first.", 1100);
  if (state.survival.restState === RestState.Camp) state.survival.setRestState(RestState.None);

  const def = state.itemRegistry.get(itemId);
  if (!def) return;
  if (state.inventory.count(itemId) <= 0) return showToast(`No ${def.name} left.`, 1200);

  const { channelSeconds } = await state.survival.consume(def, kind);
  state.channel = { kind, itemId, endsAtMs: performance.now() + channelSeconds * 1000 };
  state.inventory.remove(itemId, 1);
  showToast(`${kind === "eat" ? "Eating" : "Drinking"} ${def.name}…`, 900);
}

async function tryMakeCamp() {
  if (state.combat.isDead) return;
  if (state.channel) return showToast("Busy. Finish what you're doing first.", 1100);
  if (state.survival.restState === RestState.Camp) {
    state.survival.setRestState(RestState.None);
    return showToast("Camp packed. Back to the road.");
  }

  const kitId = "camp_campkit";
  const def = state.itemRegistry.get(kitId);
  if (state.inventory.count(kitId) <= 0) return showToast("No Camp Kit. The wild doesn't offer refunds.", 1400);

  const seconds = def.consumeTimeSeconds ?? 3.0;
  state.channel = { kind: "camp", itemId: kitId, endsAtMs: performance.now() + seconds * 1000 };
  showToast("Setting camp…", 900);
}

function buildEnvironment(scene) {
  // Campfire
  scene.add(makeCampfireProp(new THREE.Vector3(7, 0, 5)));

  // Iron pillars
  scene.add(makePillar(new THREE.Vector3(-6, 0, -4), 0x3a3b40));
  scene.add(makePillar(new THREE.Vector3(15, 0, -8), 0x3a3b40));
  scene.add(makePillar(new THREE.Vector3(-18, 0, 12), 0x444448));

  // Rocks
  const rockGeo = new THREE.DodecahedronGeometry(1.0, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.95, metalness: 0.1 });
  const rockPositions = [
    [-10, 0.5, -12], [14, 0.4, 10], [-22, 0.6, -5], [20, 0.3, -15],
    [-8, 0.5, 18], [25, 0.45, 8], [-15, 0.35, -20], [5, 0.5, -18]
  ];
  for (const [x, y, z] of rockPositions) {
    const rock = new THREE.Mesh(rockGeo, rockMat.clone());
    rock.position.set(x, y, z);
    rock.scale.set(0.5 + Math.random() * 1.2, 0.4 + Math.random() * 0.8, 0.5 + Math.random() * 1.2);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = true;
    scene.add(rock);
  }

  // Simple trees (cone + cylinder)
  const treePositions = [
    [-12, 0, 8], [18, 0, -3], [-25, 0, -15], [22, 0, 20],
    [-5, 0, 25], [30, 0, -10], [-30, 0, 5], [10, 0, -25]
  ];
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 2.0, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 });
  const leafGeo = new THREE.ConeGeometry(1.2, 2.5, 8);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2a4a2a, roughness: 0.8 });

  for (const [x, , z] of treePositions) {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.0;
    trunk.castShadow = true;
    group.add(trunk);
    const leaves = new THREE.Mesh(leafGeo, leafMat.clone());
    leaves.position.y = 2.8;
    leaves.castShadow = true;
    group.add(leaves);
    group.position.set(x, 0, z);
    const s = 0.8 + Math.random() * 0.6;
    group.scale.set(s, s, s);
    scene.add(group);
  }

  // Outpost walls (simple boxes)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 0.9, metalness: 0.15 });
  const wallPositions = [
    { pos: [-3, 1.5, -8], scale: [0.3, 3, 8] },
    { pos: [3, 1.5, -8], scale: [0.3, 3, 8] },
    { pos: [0, 1.5, -12], scale: [6.3, 3, 0.3] },
  ];
  for (const w of wallPositions) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), wallMat);
    wall.position.set(...w.pos);
    wall.scale.set(...w.scale);
    wall.castShadow = true;
    scene.add(wall);
  }

  // Store scene reference for damage numbers
  state._scene = scene;
}

function spawnPickups(scene) {
  const loot = [
    { id: "ration_jerky", qty: 2 },
    { id: "ration_hardtack", qty: 2 },
    { id: "water_waterskin", qty: 1 },
    { id: "material_scrap_iron", qty: 3 },
    { id: "ammo_pellets_basic", qty: 60 },
    { id: "ration_jerky", qty: 1 },
    { id: "water_waterskin", qty: 1 }
  ];

  const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  for (let i = 0; i < loot.length; i++) {
    const it = loot[i];
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffa200,
      emissive: 0xff4a00,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.2
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(rand(-18, 18), 0.25, rand(-18, 18));
    scene.add(m);
    state.pickups.push({ mesh: m, itemId: it.id, qty: it.qty });
  }
}

function makePillar(pos, color) {
  const g = new THREE.CylinderGeometry(0.55, 0.65, 3.8, 16);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.55 });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(pos.x, 1.9, pos.z);
  mesh.castShadow = true;
  return mesh;
}

function makeCampfireProp(pos) {
  const group = new THREE.Group();
  const stones = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.14, 12, 22),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 1.0, metalness: 0.0 })
  );
  stones.rotation.x = Math.PI / 2;
  stones.position.set(pos.x, 0.05, pos.z);
  group.add(stones);

  const ember = new THREE.PointLight(0xff5a1f, 1.0, 14, 2);
  ember.position.set(pos.x, 0.35, pos.z);
  group.add(ember);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.25, 0.6, 10),
    new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff2a00, emissiveIntensity: 0.7, roughness: 0.8 })
  );
  flame.position.set(pos.x, 0.35, pos.z);
  group.add(flame);

  let t = 0;
  const tick = () => {
    t += 0.016;
    ember.intensity = 0.85 + Math.sin(t * 7) * 0.12;
    flame.scale.y = 0.9 + Math.sin(t * 9) * 0.08;
    requestAnimationFrame(tick);
  };
  tick();

  return group;
}

function showToast(msg, ms = 1200) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function fatigueLine(s) {
  if (s === "Tired") return "Your legs feel like iron bars. Maybe… walk, not sprint.";
  if (s === "Exhausted") return "Your lungs burn. The Long Road demands a camp.";
  return "Breath steadies. The road loosens its grip.";
}
function hungerLine(s) {
  if (s === "Hungry") return "Stomach growls. Ember needs fuel.";
  if (s === "Starving") return "Hands shake. Hunger is starting to talk back.";
  return "Warmth returns. Food was a good idea.";
}
function thirstLine(s) {
  if (s === "Thirsty") return "Mouth is dust. Water isn't optional.";
  if (s === "Dehydrated") return "Head swims. Drink—now.";
  return "Cool relief. Thirst retreats.";
}

function save() {
  const payload = {
    inventory: state.inventory.toJSON(),
    survival: state.survival.toJSON(),
    combat: state.combat.toJSON(),
    level: state.player.level,
    xp: state.player.xp,
    xpToNext: state.player.xpToNext,
    killCount: state.killCount
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function disposeMesh(mesh) {
  mesh.geometry?.dispose?.();
  if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose?.());
  else mesh.material?.dispose?.();
}
