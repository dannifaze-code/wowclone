// /src/app.js
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { Inventory } from "./Systems/Inventory.logic.js";
import { Survival, RestState } from "./Systems/Survival.logic.js";

const canvas = document.getElementById("game");
const hudBars = document.getElementById("bars");
const hudStatus = document.getElementById("status");
const hudInv = document.getElementById("inv");
const toastEl = document.getElementById("toast");

const SAVE_KEY = "ember_iron_phase1_save_v1";

const state = {
  settings: null,
  itemRegistry: new Map(),
  inventory: null,
  survival: null,
  channel: null, // {kind, endsAtMs, itemId}
  keys: new Set(),
  player: { pos: new THREE.Vector3(0, 1, 0), vel: new THREE.Vector3(), yaw: 0 },
  cameraMode: "third",
  zone: "Union Border Outpost",
  pickups: [], // {mesh, itemId, qty}
  env: { cold:false, heat:false },
  lastFrameMs: performance.now()
};

main().catch(err => {
  console.error(err);
  hudStatus.textContent = "Error booting. Check console.";
});

async function main() {
  hudStatus.textContent = "Loading settings + item registry…";

  state.settings = await fetchJSON("./config/settings.json");
  const items = await fetchJSON("./data/Registry/Items.json");
  for (const it of items.items) state.itemRegistry.set(it.id, it);

  // Load saved state (optional)
  const saved = loadSave();
  if (saved) {
    state.inventory = Inventory.fromJSON(saved.inventory);
    state.survival = Survival.fromJSON(saved.survival, state.settings);
    showToast("Woke up where you left off. The road remembers.");
  } else {
    state.inventory = new Inventory({
      maxSlots: state.settings.survival.inventory.maxSlots,
      baseCarryWeight: state.settings.survival.inventory.baseCarryWeight
    });
    state.survival = new Survival(state.settings);

    // Starter supplies
    state.inventory.add(state.itemRegistry.get("ration_jerky"), 3);
    state.inventory.add(state.itemRegistry.get("water_waterskin"), 1);
    state.inventory.add(state.itemRegistry.get("camp_campkit"), 1);
  }

  // Listen for threshold changes (tiny flavor)
  state.survival.on("OnFatigueStateChanged", ({state:st}) => showToast(fatigueLine(st)));
  state.survival.on("OnHungerStateChanged", ({state:st}) => showToast(hungerLine(st)));
  state.survival.on("OnThirstStateChanged", ({state:st}) => showToast(thirstLine(st)));

  // Three.js boot
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0b0c);
  scene.fog = new THREE.Fog(0x0b0b0c, 12, 60);

  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 6, 10);

  const hemi = new THREE.HemisphereLight(0xffcc88, 0x445566, 0.9);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(10, 14, 6);
  scene.add(dir);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 1.0, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI/2;
  ground.position.y = 0;
  scene.add(ground);

  // Subtle “ember vs iron” props
  scene.add(makePillar(new THREE.Vector3(-6,0, -4), 0x3a3b40)); // iron pillar
  scene.add(makeCampfireProp(new THREE.Vector3(7,0, 5))); // ember glow

  // Player capsule-ish
  const player = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 0.9, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xcfc8ba, roughness: 0.8, metalness: 0.05 })
  );
  player.position.copy(state.player.pos);
  scene.add(player);

  // Pickups
  spawnPickups(scene);

  // Input
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    state.keys.add(e.key.toLowerCase());
    if (e.key === "1") tryConsume("ration_jerky", "eat");
    if (e.key === "2") tryConsume("water_waterskin", "drink");
    if (e.key.toLowerCase() === "c") tryMakeCamp();
  });
  window.addEventListener("keyup", (e) => state.keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => state.keys.clear());

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

    update(dt, scene, camera, player);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Autosave periodically
  setInterval(() => save(), 4000);
}

function update(dt, scene, camera, playerMesh) {
  // Movement
  const enc = state.inventory.encumbrancePercent(state.itemRegistry);
  const pens = state.survival.penalties(enc);

  const baseSpeed = 4.0; // m/s
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
    state.survival.setRestState(RestState.None); // moving cancels rest
  }

  // Boundaries (simple arena)
  state.player.pos.x = clamp(state.player.pos.x, -40, 40);
  state.player.pos.z = clamp(state.player.pos.z, -40, 40);

  playerMesh.position.copy(state.player.pos);

  // Camera follow (3rd person)
  const camTarget = new THREE.Vector3(state.player.pos.x, 1.2, state.player.pos.z);
  const camPos = new THREE.Vector3(state.player.pos.x + 7, 7, state.player.pos.z + 10);
  camera.position.lerp(camPos, 1 - Math.pow(0.001, dt));
  camera.lookAt(camTarget);

  // Survival tick
  const movementMode = (moveVec.lengthSq() === 0) ? "idle" : (isSprinting ? "run" : "walk");
  state.survival.tick({ movementMode, encumbrancePercent: enc, environmentFlags: state.env });

  // Channeling (eat/drink/camp setup)
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

  // Pickup collisions (player proximity)
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    const d = p.mesh.position.distanceTo(state.player.pos);
    if (d < 1.1) {
      const def = state.itemRegistry.get(p.itemId);
      const ok = state.inventory.add(def, p.qty);
      if (ok) {
        showToast(`Picked up: ${def.name} x${p.qty}`);
        scene.remove(p.mesh);
        disposeMesh(p.mesh);
        state.pickups.splice(i, 1);
      } else {
        showToast("Can't carry that: pack is full (slots/stack limit).", 1400);
      }
    }
  }

  // HUD
  renderHUD(enc, pens);
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
  if (fatState !== "Normal") statusBits.push(`Fatigue: ${fatState}`);
  if (hunState !== "Normal") statusBits.push(`Hunger: ${hunState}`);
  if (thiState !== "Normal") statusBits.push(`Thirst: ${thiState}`);
  if (encPercent > state.settings.survival.inventory.encumbranceSoftCapPercent) statusBits.push("Encumbered");

  const channelText = state.channel ? ` • ${state.channel.kind.toUpperCase()}…` : "";
  hudStatus.textContent = (statusBits.length ? statusBits.join(" • ") : "Steady.") + channelText;

  hudBars.innerHTML = "";
  hudBars.appendChild(makeBar("Fatigue", fatigue, 100, "red"));
  hudBars.appendChild(makeBar("Hunger", hunger, 100, ""));  // ember-ish
  hudBars.appendChild(makeBar("Thirst", thirst, 100, "blue"));

  const encLabel = encPercent.toFixed(0) + "%";
  const movePct = Math.round((pens.moveSpeedScalar) * 100);
  hudInv.textContent = `Inventory: ${slots}/${maxSlots} slots • Weight: ${w.toFixed(1)} / ${state.inventory.baseCarryWeight.toFixed(1)} • Enc: ${encLabel} • Move: ${movePct}%`;
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
  inner.className = "barInner" + (kind === "blue" ? " blue" : kind === "red" ? " red" : "");
  inner.style.width = `${Math.max(0, Math.min(100, (val/max)*100))}%`;
  outer.appendChild(inner);
  const right = document.createElement("div");
  right.textContent = `${Math.round(val)}`;
  right.className = "tiny";
  row.append(left, outer, right);
  return row;
}

async function tryConsume(itemId, kind) {
  if (state.channel) return showToast("Busy. Finish what you're doing first.", 1100);
  if (state.survival.restState === RestState.Camp) state.survival.setRestState(RestState.None); // moving actions break rest

  const def = state.itemRegistry.get(itemId);
  if (!def) return;
  if (state.inventory.count(itemId) <= 0) return showToast(`No ${def.name} left.`, 1200);

  // Start channel
  const { channelSeconds } = await state.survival.consume(def, kind);
  state.channel = { kind, itemId, endsAtMs: performance.now() + channelSeconds * 1000 };
  state.inventory.remove(itemId, 1);
  showToast(`${kind === "eat" ? "Eating" : "Drinking"} ${def.name}…`, 900);
}

async function tryMakeCamp() {
  if (state.channel) return showToast("Busy. Finish what you're doing first.", 1100);
  if (state.survival.restState === RestState.Camp) {
    state.survival.setRestState(RestState.None);
    return showToast("Camp packed. Back to the road.");
  }

  const kitId = "camp_campkit";
  const def = state.itemRegistry.get(kitId);
  if (state.inventory.count(kitId) <= 0) return showToast("No Camp Kit. The wild doesn't offer refunds.", 1400);

  // Channel setup
  const seconds = def.consumeTimeSeconds ?? 3.0;
  state.channel = { kind: "camp", itemId: kitId, endsAtMs: performance.now() + seconds * 1000 };
  // Don't consume the camp kit in this prototype (feels nicer); later we can add durability.
  showToast("Setting camp…", 900);
}

function spawnPickups(scene) {
  // A few glowing cubes as loot
  const loot = [
    { id: "ration_jerky", qty: 2 },
    { id: "ration_hardtack", qty: 2 },
    { id: "water_waterskin", qty: 1 },
    { id: "material_scrap_iron", qty: 3 },
    { id: "ammo_pellets_basic", qty: 60 }
  ];

  const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  for (let i=0;i<loot.length;i++) {
    const it = loot[i];
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffa200,
      emissive: 0xff4a00,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.2
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(rand(-12,12), 0.25, rand(-12,12));
    scene.add(m);
    state.pickups.push({ mesh:m, itemId: it.id, qty: it.qty });
  }
}

function makePillar(pos, color) {
  const g = new THREE.CylinderGeometry(0.55, 0.65, 3.8, 16);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.55 });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(pos.x, 1.9, pos.z);
  return mesh;
}

function makeCampfireProp(pos) {
  const group = new THREE.Group();
  const stones = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.14, 12, 22),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 1.0, metalness: 0.0 })
  );
  stones.rotation.x = Math.PI/2;
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

  // tiny flicker
  let t = 0;
  const tick = () => {
    t += 0.016;
    ember.intensity = 0.85 + Math.sin(t*7) * 0.12;
    flame.scale.y = 0.9 + Math.sin(t*9) * 0.08;
    requestAnimationFrame(tick);
  };
  tick();

  return group;
}

function showToast(msg, ms=1200) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function fatigueLine(state) {
  if (state === "Tired") return "Your legs feel like iron bars. Maybe… walk, not sprint.";
  if (state === "Exhausted") return "Your lungs burn. The Long Road demands a camp.";
  return "Breath steadies. The road loosens its grip.";
}
function hungerLine(state) {
  if (state === "Hungry") return "Stomach growls. Ember needs fuel.";
  if (state === "Starving") return "Hands shake. Hunger is starting to talk back.";
  return "Warmth returns. Food was a good idea.";
}
function thirstLine(state) {
  if (state === "Thirsty") return "Mouth is dust. Water isn't optional.";
  if (state === "Dehydrated") return "Head swims. Drink—now.";
  return "Cool relief. Thirst retreats.";
}

function save() {
  const payload = {
    inventory: state.inventory.toJSON(),
    survival: state.survival.toJSON()
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
  return await res.json();
}

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function rand(a,b){ return a + Math.random()*(b-a); }
function disposeMesh(mesh){
  mesh.geometry?.dispose?.();
  if (Array.isArray(mesh.material)) mesh.material.forEach(m=>m.dispose?.());
  else mesh.material?.dispose?.();
}
