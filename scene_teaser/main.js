import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BG_IMAGE_URL = '/data/images/museum.webp';
const MESH_BASE = '/data/all_animo_val/process1_textured_post2/mesh/';
const ROWS = 6;
const COLS = 15;          // 6 × 15 = 90 — matches manifest size
const ANIMAL_SCALE = 0.4;  // uniform multiplier applied to every model (post1 already volume-normalizes)
const ANIMAL_LIFT = 0.002; // tiny upward offset (avoids z-fighting; gap not visible)
const PAD = 0.4;          // pedestal edge padding (m) — keeps animals off the rim
const LOAD_CONCURRENCY = 8;

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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

// ---- Lighting (no IBL — fully explicit) ----
const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xfff1d8, 1.6); // warm key
keyLight.position.set(2.5, 4.5, 2.0);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 15;
keyLight.shadow.camera.left = -10;
keyLight.shadow.camera.right = 10;
keyLight.shadow.camera.top = 8;
keyLight.shadow.camera.bottom = -8;
keyLight.shadow.bias = -0.0005;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x99b4cc, 0.55); // cool fill
fillLight.position.set(-3.5, 3.0, -1.5);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.3); // subtle backlight
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
const animationMixers = []; // one mixer per GLB that ships with animation clips
const tour = {
  enabled: false,
  period: 30.0,     // seconds for one full A→B→C→D→A loop
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
function tick() {
  const dt = clock.getDelta();
  for (const mixer of animationMixers) mixer.update(dt);
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

  const selected = manifest.slice(0, ROWS * COLS);
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
}

loadAnimals();

window.__scene = { scene, camera, controls, renderer, pedestal, displayAnchor, keyLight, fillLight, rimLight, ambient, animalsRoot, displayGroup, tour };
