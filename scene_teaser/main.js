import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BG_IMAGE_URL = '/data/images/museum.webp';
const MESH_BASE = '/data/all_animo_val/process1_textured_post2/mesh/';
const BLOB_BASE = '/data/all_animo_val/process1_textured_post1/blob/';
const ROWS = 6;
const COLS = 15;          // 6 × 15 = 90 — matches manifest size
const ANIMAL_SCALE = 0.4;  // uniform multiplier applied to every model (post1 already volume-normalizes)
const ANIMAL_LIFT = 0.002; // tiny upward offset (avoids z-fighting; gap not visible)
const PAD = 0.4;          // pedestal edge padding (m) — keeps animals off the rim
const LOAD_CONCURRENCY = 8;

// === Scene timeline (seconds, modulo CYCLE_DURATION) ===
const CYCLE_DURATION = 40.0; // whole-scene loop length
const PHASE = {
  freezeUntil: 5.0,     // animals frozen at frame 0 until then
  flashStart: 5.0,      // one-shot particle burst at this moment
  blobStart: 25.0,      // textured → blob swap
  blobEnd: 35.0,        // blob → textured swap (then 5 s back to animation, then loop)
};

// One-shot particle burst that flashes past the camera at PHASE.flashStart.
// All particles spawn at a single point in front of the camera and radiate
// outward, so most of them are guaranteed to cross the (narrow) FOV cone.
const PARTICLE_COUNT = 500;
const PARTICLE_COLOR = 0x39ff14;       // neon / fluorescent green
const PARTICLE_SIZE = 0.35;            // world units (sizeAttenuation = true)
const PARTICLE_ORIGIN = new THREE.Vector3(0, 4.0, 5.0); // on the camera→target ray
const PARTICLE_LIFE_MIN = 1.8;         // seconds
const PARTICLE_LIFE_MAX = 3.4;
const PARTICLE_SPEED_MIN = 2.0;        // m/s
const PARTICLE_SPEED_MAX = 6.0;

// Ambient light intensities for the static vs. animated halves of the cycle.
// Smoothly transitions over AMBIENT_TRANSITION seconds at PHASE.freezeUntil.
const AMBIENT_DIM = 0.55;
const AMBIENT_BRIGHT = 0.55;
const AMBIENT_TRANSITION = 1.0;

// Overhead spotlight (the "circular top light"). Off during the static phase,
// fades in after PHASE.freezeUntil so the pedestal lights up dramatically once
// the magic flash has triggered the animals.
const SPOT_INTENSITY_ON = 9.0;
const SPOT_COLOR = 0xfff1d8;       // warm museum-spotlight white
const SPOT_HEIGHT = 8.0;            // y position of the lamp source
const SPOT_ANGLE = 0.20;           // cone half-angle (~11.5°) — disk a bit bigger than the view, boundary lands inside frame edges
const SPOT_PENUMBRA = 0.4;         // soft edge; inner ~60% is full-bright, outer 40% fades to 0
const SPOT_DISTANCE = 16.0;
const SPOT_TRANSITION = 1.2;

// Blob styling: keep each GLB's own per-mesh colors, punch up saturation, and
// self-illuminate so the cloud reads clearly against the dark museum back.
const BLOB_SAT_GAIN = 1.7;       // multiplies HSL saturation
const BLOB_SAT_FLOOR = 0.25;     // also lifts low-saturation hues
const BLOB_LIGHTNESS_MIN = 0.45; // prevents very dark colors from disappearing
const BLOB_EMISSIVE_INTENSITY = 0.3; // glow each blob with its own (saturation-boosted) color

// Seed for the manifest shuffle (deterministic across reloads, but not alphabetical).
const SHUFFLE_SEED = 0x9E3779B1;

// Hand-picked post-shuffle swaps — [indexA, indexB] pairs, applied in order.
const MANUAL_SWAPS = [
  [17, 81], // animal at r2c3 ↔ king penguin (r6c7)
];

// Per-species scale multipliers (substring match on lowercase filename).
// 1.0 = no override; entries multiply on top of ANIMAL_SCALE.
const SCALE_OVERRIDES = {};

function getScaleOverride(filename) {
  const lc = filename.toLowerCase();
  for (const key in SCALE_OVERRIDES) {
    if (lc.includes(key)) return SCALE_OVERRIDES[key];
  }
  return 1.0;
}

// Fisher–Yates shuffle with a seeded LCG so the placement is deterministic
// across reloads but isn't alphabetical.
function seededShuffle(arr, seed) {
  const out = arr.slice();
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Per-file Y-rotation tweaks (degrees, CCW from above). Applied AFTER ROTATE_180.
const ROTATE_Y_EXTRA_DEG = {
  'Sand_Cat_Female__sand_cat_male__anima_4c1488c9539c.glb': 100, // row3/col15 sand cat
};

// GLBs in this set are loaded facing away from the camera; rotate them 180° around Y.
// (Indexed by full manifest filename — keyed off positions in the current 6×15 layout.)
const ROTATE_180 = new Set([
  'Aardvark_Male__aardvark_male__animati_47a916fa2fdf.glb',
  'African_Buffalo_Male__african_buffalo_34df70925683.glb',
  'African_Wild_Dog_Juvenile__african_wi_2e6e211c1608.glb',
  'African_Wild_Dog_Juvenile__african_wi_87362698b587.glb',
  'Alpaca_Male__alpaca_male__animationmo_2dc5567efd53.glb',
  'American_Flamingo_Juvenile__american__c69cf237e5fd.glb',
  'Amur_Leopard_Juvenile__amur_leopard_j_e889236c8794.glb',
  'Babirusa_Male__babirusa_male__animati_85552738af43.glb',
  'Bactrian_Camel_Female__bactrian_camel_db6831436c54.glb',
  'Bengal_Tiger_Female__bengal_tiger_fem_85a98badff8b.glb',
  'Bengal_Tiger_Female__bengal_tiger_fem_cd9862f33806.glb',
  'Bongo_Juvenile__bongo_juvenile__anima_ce85a722f255.glb',
  'California_Sea_Lion_Juvenile__califor_79cc1a50fdb3.glb',
  'Caracal_Male__caracal_male__animation_acd067fc4282.glb',
  'Cassowary_Female__cassowary_female__a_98583a3aeea4.glb',
  'Common_Wombat_Juvenile__common_wombat_d75c42453139.glb',
  'Dingo_Female__dingo_female__animation_549f3eb6a213.glb',
  'Fennec_Fox_Female__fennec_fox_female__4558f40ab8dc.glb',
  'Giant_Anteater_Juvenile__giant_anteat_e4d63702ae71.glb',
  'Grizzly_Bear_Female__grizzly_bear_fem_11bc3ce97aa2.glb',
  'Hamadryas_Baboon_Juvenile__hamadryas__18275e2a905e.glb',
  'Hamadryas_Baboon_Male__hamadryas_babo_1da9a2c8861f.glb',
  'Honey_Badger_Female__honey_badger_mal_9b84ff3fdd83.glb',
  'Honey_Badger_Juvenile__honey_badger_j_df49ab261a6b.glb',
  'Indian_Elephant_Female__indian_elepha_64be1af510c4.glb',
  'Japanese_Macaque_Female__japanese_mac_86b28b03fc31.glb',
  'King_Penguin_Male__king_penguin_male__51afc65ae2d9.glb',
  'Nile_Lechwe_Juvenile__nile_lechwe_juv_89117a082858.glb',
  'Nine_Banded_Armadillo_Male__nine_band_8e9a3d7e9bac.glb',
  'Ocelot_Male__ocelot_male__animationmo_cc846c58bcc2.glb',
  'Pallas_Cat_Female__pallas_cat_male__a_8a71fd1a0817.glb',
  'Pallas_Cat_Male__pallas_cat_male__ani_d6e9a20566ca.glb',
  'Platypus_Male__platypus_male__animati_abc6c6f4afb4.glb',
  'Rednecked_Wallaby_Male__rednecked_wal_36a87e28b6c0.glb',
  'Sand_Cat_Female__sand_cat_male__anima_4c1488c9539c.glb',
  'Spotted_Hyena_Female__spotted_hyena_f_160db685a46d.glb',
  'White_Faced_Saki_Male__white_faced_sa_bd590e98df02.glb',
  'Wolverine_Female__wolverine_male__ani_89da20e38a0d.glb',
]);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap; // separable Gaussian blur → much softer shadow edges than PCF
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  5.0, // tight telephoto — frames ~3 rows × ~5-6 cols
  window.innerWidth / window.innerHeight,
  0.05,
  200,
);
// pulled back & raised → flattens depth, more top-down look
camera.position.set(0, 8.0, 11.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

// ---- Display group (pedestal + animals; walks a rectangle to tour the grid) ----
const displayGroup = new THREE.Group();
scene.add(displayGroup);

// ---- Pedestal ----
const PEDESTAL = { w: 10.0, h: 0.85, d: 5.1 };
const pedestalGeom = new THREE.BoxGeometry(PEDESTAL.w, PEDESTAL.h, PEDESTAL.d);
const pedestalMat = new THREE.MeshStandardMaterial({
  color: 0xeae5dc,
  roughness: 0.55,
  metalness: 0.02,
});
const pedestal = new THREE.Mesh(pedestalGeom, pedestalMat);
pedestal.position.y = PEDESTAL.h / 2;
pedestal.castShadow = true;
pedestal.receiveShadow = true;
displayGroup.add(pedestal);

const displayAnchor = new THREE.Object3D();
displayAnchor.position.set(0, PEDESTAL.h, 0);
displayGroup.add(displayAnchor);

// ---- Invisible ground for contact shadow ----
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.ShadowMaterial({ opacity: 0.6 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---- Lighting: just ambient + a single overhead spotlight ----
const ambient = new THREE.AmbientLight(0xffffff, AMBIENT_DIM);
scene.add(ambient);

// Spotlight points straight down at the world origin. The illuminated circle
// stays fixed at the center of the camera view, and the pedestal pans through
// it as the tour runs — so whatever animal is "on stage" right now is the one
// that's lit.
// Position shifted slightly back in z so the lit circle sits a touch higher
// on screen (camera looks down/forward, so "up on screen" = -z).
const SPOT_Z_OFFSET = -0.2;
const topSpot = new THREE.SpotLight(SPOT_COLOR, 0, SPOT_DISTANCE, SPOT_ANGLE, SPOT_PENUMBRA, 1.0);
topSpot.position.set(0, SPOT_HEIGHT, SPOT_Z_OFFSET);
topSpot.target.position.set(0, 0, SPOT_Z_OFFSET);
topSpot.castShadow = true;
// 4096² + a tight near/far frustum gives much more depth precision over the
// shallow pedestal+animal volume → kills the speckled "light spots inside
// shadow" PCF artifacts caused by depth-comparison aliasing.
topSpot.shadow.mapSize.set(4096, 4096);
topSpot.shadow.camera.near = 5.0;
topSpot.shadow.camera.far = 8.5;
topSpot.shadow.bias = -0.0006;
topSpot.shadow.normalBias = 0.02;
topSpot.shadow.radius = 10;      // VSM: Gaussian blur radius (in shadow-map texels)
topSpot.shadow.blurSamples = 24;  // VSM: Gaussian sample count — higher = smoother
scene.add(topSpot);
scene.add(topSpot.target);

// Static phase: fill + rim lights are strong and the fill light is the primary
// shadow source. Animated phase: both fade down so the top spotlight takes over
// (and fillLight stops casting shadow, so only the spot's shadow remains).
const FILL_STATIC = 0.6;
const FILL_ANIM = 0.3;
const RIM_STATIC = 0.45;
const RIM_ANIM = 0.3;

// All three lights share the same warm tint as the spotlight, so the overall
// color temperature stays consistent across the flash transition.
const fillLight = new THREE.DirectionalLight(SPOT_COLOR, FILL_STATIC);
fillLight.position.set(-3.5, 3.0, -1.5);
fillLight.castShadow = true;
fillLight.shadow.mapSize.set(2048, 2048);
fillLight.shadow.camera.near = 0.5;
fillLight.shadow.camera.far = 15;
fillLight.shadow.camera.left = -10;
fillLight.shadow.camera.right = 10;
fillLight.shadow.camera.top = 8;
fillLight.shadow.camera.bottom = -8;
fillLight.shadow.bias = -0.0005;
fillLight.shadow.normalBias = 0.03;
fillLight.shadow.radius = 5;
fillLight.shadow.blurSamples = 16;
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(SPOT_COLOR, RIM_STATIC);
rimLight.position.set(0, 2.5, -4);
scene.add(rimLight);

// ---- Background image (screen-space backplate) ----
const loadingEl = document.getElementById('loading');

const bgTexture = new THREE.TextureLoader().load(
  BG_IMAGE_URL,
  () => updateBackgroundAspect(),
  undefined,
  (err) => {
    console.error('Failed to load background:', err);
    loadingEl.textContent = 'FAILED TO LOAD BACKGROUND';
  },
);
bgTexture.colorSpace = THREE.SRGBColorSpace;
scene.background = bgTexture;

// Maintain "cover" behavior: fill the viewport, crop excess, no stretching.
function updateBackgroundAspect() {
  if (!bgTexture.image) return;
  const screenAspect = window.innerWidth / window.innerHeight;
  const imgAspect = bgTexture.image.width / bgTexture.image.height;
  if (screenAspect > imgAspect) {
    // screen is wider — fit width, crop vertically
    bgTexture.repeat.set(1, imgAspect / screenAspect);
    bgTexture.offset.set(0, (1 - imgAspect / screenAspect) / 2);
  } else {
    // screen is taller — fit height, crop horizontally
    bgTexture.repeat.set(screenAspect / imgAspect, 1);
    bgTexture.offset.set((1 - screenAspect / imgAspect) / 2, 0);
  }
}

// ---- Resize ----
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  updateBackgroundAspect();
});

// ---- Tour animation (camera fixed; displayGroup walks a rectangle around the grid) ----
// Visible window shows 3 rows × ~6 cols. The tour visits 4 corners:
//   A: rows 0–2, cols 0–5   (top-left)     → displayGroup (+xAmp, 0, +zAmp)
//   B: rows 0–2, cols 9–14  (top-right)    → (-xAmp, 0, +zAmp)
//   C: rows 3–5, cols 9–14  (bottom-right) → (-xAmp, 0, -zAmp)
//   D: rows 3–5, cols 0–5   (bottom-left)  → (+xAmp, 0, -zAmp)
// Order is A → B → C → D → A. Linear interpolation → constant speed; each
// segment takes time proportional to its distance, so the velocity stays
// uniform around the rectangle (no slowdown at corners).
const clock = new THREE.Clock();
const sceneClock = new THREE.Clock();
sceneClock.autoStart = false; // started at the end of loadAnimals()
const animationMixers = []; // one mixer per GLB that ships with animation clips
const animals = [];         // { wrapper, texturedModel, mixer, blobModel?, blobMixer? } per grid cell

// === Particle flash (camera-front burst at PHASE.flashStart) ===
const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
const particleVelocities = new Float32Array(PARTICLE_COUNT * 3);
const particleAges = new Float32Array(PARTICLE_COUNT);
const particleLives = new Float32Array(PARTICLE_COUNT);
for (let i = 0; i < PARTICLE_COUNT; i++) {
  particlePositions[i * 3 + 1] = -1000; // start dead (parked under the floor)
  particleAges[i] = Infinity;
}
const particleGeom = new THREE.BufferGeometry();
particleGeom.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
const particleMat = new THREE.PointsMaterial({
  color: PARTICLE_COLOR,
  size: PARTICLE_SIZE,
  transparent: true,
  opacity: 1.0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true,
});
const particles = new THREE.Points(particleGeom, particleMat);
// Disable frustum culling — the boundingSphere is computed from the initial
// positions (all parked far below the floor), so three.js would otherwise cull
// the Points object permanently and the burst would never render.
particles.frustumCulled = false;
scene.add(particles);

function spawnParticleBurst() {
  // Burst from a single point in front of the camera; each particle gets a
  // random unit direction × speed. Sphere-of-burst guarantees plenty of paths
  // through the narrow visible cone, so the flash always reads on screen.
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particlePositions[i * 3 + 0] = PARTICLE_ORIGIN.x;
    particlePositions[i * 3 + 1] = PARTICLE_ORIGIN.y;
    particlePositions[i * 3 + 2] = PARTICLE_ORIGIN.z;

    // Uniform direction on the unit sphere
    const u = Math.random() * 2 - 1;            // cos(phi)
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const dx = r * Math.cos(theta);
    const dy = u;
    const dz = r * Math.sin(theta);

    const speed = PARTICLE_SPEED_MIN + Math.random() * (PARTICLE_SPEED_MAX - PARTICLE_SPEED_MIN);
    particleVelocities[i * 3 + 0] = dx * speed;
    particleVelocities[i * 3 + 1] = dy * speed;
    particleVelocities[i * 3 + 2] = dz * speed;
    particleAges[i] = 0;
    particleLives[i] = PARTICLE_LIFE_MIN + Math.random() * (PARTICLE_LIFE_MAX - PARTICLE_LIFE_MIN);
  }
  particleGeom.attributes.position.needsUpdate = true;
}

function updateParticles(dt) {
  let anyAlive = false;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    if (particleAges[i] >= particleLives[i]) {
      if (particlePositions[i * 3 + 1] !== -1000) {
        particlePositions[i * 3 + 1] = -1000;
        anyAlive = true;
      }
      continue;
    }
    particleAges[i] += dt;
    particlePositions[i * 3 + 0] += particleVelocities[i * 3 + 0] * dt;
    particlePositions[i * 3 + 1] += particleVelocities[i * 3 + 1] * dt;
    particlePositions[i * 3 + 2] += particleVelocities[i * 3 + 2] * dt;
    anyAlive = true;
  }
  if (anyAlive) particleGeom.attributes.position.needsUpdate = true;
}

let _flashSpawnedThisCycle = false;

const tour = {
  enabled: false,
  period: 40.0,     // seconds for one full A→B→C→D→A loop (synced with CYCLE_DURATION)
  t0: 0,            // clock time when the tour started
  xAmp: 3.4,        // ±3.4 in x: turn-around a bit past the outermost cols
  zAmp: 1.075,     // ±1.075 in z: centers rows 0–2 ↔ rows 3–5
};

// Signed corner offsets — multiplied by xAmp/zAmp at runtime so they stay live-tunable.
const TOUR_CORNERS = [
  [ +1, +1 ], // A
  [ -1, +1 ], // B
  [ -1, -1 ], // C
  [ +1, -1 ], // D
];

function tourPos(t) {
  const f = ((t % 1) + 1) % 1;     // wrap to [0, 1)
  // segment distances (constant speed → time per segment ∝ distance)
  const segDists = [2 * tour.xAmp, 2 * tour.zAmp, 2 * tour.xAmp, 2 * tour.zAmp];
  const total = segDists[0] + segDists[1] + segDists[2] + segDists[3];
  let cum = 0;
  for (let seg = 0; seg < 4; seg++) {
    const segFrac = segDists[seg] / total;
    if (f < cum + segFrac) {
      const u = (f - cum) / segFrac; // linear within segment — no easing
      const [sx0, sz0] = TOUR_CORNERS[seg];
      const [sx1, sz1] = TOUR_CORNERS[(seg + 1) % 4];
      return [
        (sx0 + (sx1 - sx0) * u) * tour.xAmp,
        (sz0 + (sz1 - sz0) * u) * tour.zAmp,
      ];
    }
    cum += segFrac;
  }
  return [tour.xAmp, tour.zAmp]; // unreachable (f < 1)
}

// ---- Render loop ----
let _prevSceneT = 0;
function tick() {
  const dt = clock.getDelta();
  const sceneT_raw = sceneClock.running ? sceneClock.getElapsedTime() : 0;
  const sceneT = sceneT_raw % CYCLE_DURATION;

  // Cycle wrap → reset every animation to t=0 so animals freeze again at frame 0,
  // and re-arm the one-shot particle flash for the next loop.
  if (sceneT < _prevSceneT) {
    for (const a of animals) {
      if (!a) continue;
      if (a.action) { a.action.time = 0; a.mixer.update(0); }
      if (a.blobAction) { a.blobAction.time = 0; a.blobMixer.update(0); }
    }
    _flashSpawnedThisCycle = false;
  }
  _prevSceneT = sceneT;

  // Lighting state crossfade at PHASE.freezeUntil:
  //   - ambient: constant (DIM == BRIGHT now)
  //   - topSpot: 0 → SPOT_INTENSITY_ON over SPOT_TRANSITION
  //   - fill/rim: bright with fill-shadow during static → dim with no shadow during animated
  if (sceneT < PHASE.freezeUntil) {
    ambient.intensity = AMBIENT_DIM;
    topSpot.intensity = 0;
    fillLight.intensity = FILL_STATIC;
    fillLight.castShadow = true;
    rimLight.intensity = RIM_STATIC;
  } else {
    const ua = Math.min(1, (sceneT - PHASE.freezeUntil) / AMBIENT_TRANSITION);
    const ea = ua * ua * (3 - 2 * ua);
    ambient.intensity = AMBIENT_DIM + (AMBIENT_BRIGHT - AMBIENT_DIM) * ea;
    fillLight.intensity = FILL_STATIC + (FILL_ANIM - FILL_STATIC) * ea;
    rimLight.intensity = RIM_STATIC + (RIM_ANIM - RIM_STATIC) * ea;
    // Once we're past the fade, fillLight no longer needs to cast shadow —
    // the spot has fully taken over.
    fillLight.castShadow = ua < 1;

    const us = Math.min(1, (sceneT - PHASE.freezeUntil) / SPOT_TRANSITION);
    const es = us * us * (3 - 2 * us);
    topSpot.intensity = SPOT_INTENSITY_ON * es;
  }

  // Animal animations: frozen until t=freezeUntil, then play through the cycle
  if (sceneT >= PHASE.freezeUntil) {
    for (const mixer of animationMixers) mixer.update(dt);
  }

  // Textured ↔ blob swap (and tick the blob mixer only while it's visible)
  const blobActive = sceneT >= PHASE.blobStart && sceneT < PHASE.blobEnd;
  for (const a of animals) {
    if (!a) continue;
    const showBlob = blobActive && a.blobModel;
    a.texturedModel.visible = !showBlob;
    if (a.blobModel) a.blobModel.visible = showBlob;
    if (showBlob && a.blobMixer) a.blobMixer.update(dt);
  }

  // One-shot particle flash at PHASE.flashStart
  if (!_flashSpawnedThisCycle && sceneT >= PHASE.flashStart) {
    spawnParticleBurst();
    _flashSpawnedThisCycle = true;
  }
  updateParticles(dt);

  if (tour.enabled) {
    const t = (clock.getElapsedTime() - tour.t0) / tour.period;
    const [px, pz] = tourPos(t);
    displayGroup.position.x = px;
    displayGroup.position.z = pz;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// ---- Animals (GLB grid on pedestal) ----
const animalsRoot = new THREE.Group();
animalsRoot.position.y = PEDESTAL.h; // sit on top of pedestal
displayGroup.add(animalsRoot);

// Hold the start pose (rows 0–2, cols 0–5 centered) until animals finish loading.
displayGroup.position.set(tour.xAmp, 0, tour.zAmp);

const gltfLoader = new GLTFLoader();

function placeAnimal(gltf, i, cellW, cellD, filename) {
  const model = gltf.scene;

  // flip back-facing animals 180° around Y before bbox / centering math runs
  if (ROTATE_180.has(filename)) {
    model.rotation.y = Math.PI;
  }
  const extraDeg = ROTATE_Y_EXTRA_DEG[filename];
  if (extraDeg !== undefined) {
    model.rotation.y += extraDeg * Math.PI / 180;
  }

  // Build the mixer and drive the model to frame-0 first; we'll also use it to
  // sample the full clip below to find the true sequence min.y for grounding.
  let mixer = null;
  let action = null;
  if (gltf.animations && gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(model);
    action = mixer.clipAction(gltf.animations[0]);
    action.play();
    mixer.update(0);
  }

  // uniform scale only (post1 already volume-normalized; preserves relative sizes)
  const override = getScaleOverride(filename);
  model.scale.setScalar(ANIMAL_SCALE * override);

  // Centering xz uses frame-0; grounding y uses the lowest point across the whole
  // animation so a crouch / stomp frame doesn't sink the feet into the pedestal.
  // NOTE: `precise=true` is required — without it Box3.setFromObject reads the
  // mesh's static geometry.boundingBox and ignores morphTargetInfluences, so all
  // sampled frames return the same rest-pose bbox.
  let bbox = new THREE.Box3().setFromObject(model, true);
  const center = bbox.getCenter(new THREE.Vector3());
  let minY = bbox.min.y;
  if (action) {
    const duration = action.getClip().duration;
    const samples = 30;
    for (let s = 1; s <= samples; s++) {
      action.time = (s / samples) * duration;
      mixer.update(0);
      bbox = new THREE.Box3().setFromObject(model, true);
      if (bbox.min.y < minY) minY = bbox.min.y;
    }
    // restart playback from time 0
    action.time = 0;
    mixer.update(0);
  }
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= minY;
  model.position.y += ANIMAL_LIFT;

  model.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      // Self-illuminate using the base texture — lifts very-dark animals out of the shadows
      // without washing out the bright ones (since the emissive is the texture itself).
      const mat = obj.material;
      if (mat && mat.map && !mat.emissiveMap) {
        mat.emissiveMap = mat.map;
        mat.emissive = new THREE.Color(0xffffff);
        mat.emissiveIntensity = 0.15;
        mat.needsUpdate = true;
      }
    }
  });

  const wrapper = new THREE.Group();
  wrapper.add(model);
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  // grid is inset by PAD on each pedestal edge
  wrapper.position.x = -PEDESTAL.w / 2 + PAD + (col + 0.5) * cellW;
  wrapper.position.z = -PEDESTAL.d / 2 + PAD + (row + 0.5) * cellD;
  animalsRoot.add(wrapper);

  if (mixer) animationMixers.push(mixer);

  animals[i] = {
    wrapper,
    texturedModel: model,
    mixer,
    action,             // kept so we can reset to t=0 each scene loop
    blobModel: null,
    blobMixer: null,
    blobAction: null,
  };
}

async function loadAnimals() {
  let manifest;
  try {
    const res = await fetch(MESH_BASE + 'manifest.json');
    manifest = await res.json();
  } catch (err) {
    console.error('Failed to load manifest:', err);
    loadingEl.textContent = 'FAILED TO LOAD MANIFEST';
    return;
  }

  const selected = seededShuffle(manifest, SHUFFLE_SEED).slice(0, ROWS * COLS);
  for (const [a, b] of MANUAL_SWAPS) {
    if (a < selected.length && b < selected.length) {
      [selected[a], selected[b]] = [selected[b], selected[a]];
    }
  }
  const cellW = (PEDESTAL.w - 2 * PAD) / COLS;
  const cellD = (PEDESTAL.d - 2 * PAD) / ROWS;
  const total = selected.length;
  let done = 0;

  // bounded-concurrency loader
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= selected.length) return;
      const filename = selected[i];
      try {
        const gltf = await gltfLoader.loadAsync(MESH_BASE + filename);
        placeAnimal(gltf, i, cellW, cellD, filename);
      } catch (err) {
        console.warn('Failed:', filename, err);
      }
      done++;
      loadingEl.textContent = `LOADING ANIMALS ${done}/${total}`;
    }
  }

  loadingEl.textContent = `LOADING ANIMALS 0/${total}`;
  await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
  loadingEl.classList.add('hidden');
  tour.t0 = clock.getElapsedTime();
  tour.enabled = true;
  sceneClock.start(); // begin phase timeline (animals frozen until PHASE.freezeUntil)
  loadBlobs(selected); // background-load the blob versions for the t=15s swap
}

// ---- Blob version loading (background, after textured animals are visible) ----
async function loadBlobs(filenames) {
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= filenames.length) return;
      const filename = filenames[i];
      const a = animals[i];
      if (!a) continue;
      try {
        const gltf = await gltfLoader.loadAsync(BLOB_BASE + filename);
        const blobModel = gltf.scene;

        // Mirror the textured model's full transform so any per-file rotation
        // overrides (ROTATE_180 + ROTATE_Y_EXTRA_DEG) carry over.
        blobModel.rotation.copy(a.texturedModel.rotation);
        blobModel.position.copy(a.texturedModel.position);
        blobModel.scale.copy(a.texturedModel.scale);

        blobModel.traverse((obj) => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            if (obj.material) {
              // Clone so we don't mutate a shared material cache.
              obj.material = obj.material.clone();
              // Keep the GLB's own per-mesh hue, but punch up saturation so the
              // palette reads cleanly instead of looking muddy.
              const hsl = { h: 0, s: 0, l: 0 };
              obj.material.color.getHSL(hsl);
              obj.material.color.setHSL(
                hsl.h,
                Math.min(1, Math.max(BLOB_SAT_FLOOR, hsl.s * BLOB_SAT_GAIN)),
                Math.max(BLOB_LIGHTNESS_MIN, hsl.l),
              );
              // Self-illuminate using the (already brightened) base color so the
              // blob doesn't rely on the museum's dim key light to be visible.
              if (obj.material.emissive) {
                obj.material.emissive.copy(obj.material.color);
                obj.material.emissiveIntensity = BLOB_EMISSIVE_INTENSITY;
              }
              obj.material.needsUpdate = true;
            }
          }
        });

        blobModel.visible = false;
        a.wrapper.add(blobModel);
        a.blobModel = blobModel;

        if (gltf.animations && gltf.animations.length > 0) {
          const bMixer = new THREE.AnimationMixer(blobModel);
          const bAction = bMixer.clipAction(gltf.animations[0]);
          bAction.play();
          bMixer.update(0);
          a.blobMixer = bMixer;
          a.blobAction = bAction;
        }
      } catch (err) {
        console.warn('Blob load failed:', filename, err);
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
}

loadAnimals();

window.__scene = { scene, camera, controls, renderer, pedestal, displayAnchor, ambient, topSpot, fillLight, rimLight, animalsRoot, displayGroup, tour, sceneClock, PHASE, animals, CYCLE_DURATION, particles };
