import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BG_IMAGE_URL = '/data/images/museum.webp';
const MESH_BASE = '/data/all_animo_val/process1_textured/mesh/';
const ROWS = 5;
const COLS = 18;          // 5 × 18 = 90 — matches manifest size
const ANIMAL_FIT = 0.55;  // max bounding-box dim after scaling (m)
const LOAD_CONCURRENCY = 8;

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
  22, // tighter / longer lens — more compression, pedestal dominates
  window.innerWidth / window.innerHeight,
  0.05,
  200,
);
// pulled back & raised → flattens depth, more top-down look
camera.position.set(0, 11.5, 11.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.85, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

// ---- Pedestal (lower / flatter platform) ----
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
scene.add(pedestal);

const displayAnchor = new THREE.Object3D();
displayAnchor.position.set(0, PEDESTAL.h, 0);
scene.add(displayAnchor);

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

// ---- Render loop ----
function tick() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// ---- Animals (GLB grid on pedestal) ----
const animalsRoot = new THREE.Group();
animalsRoot.position.y = PEDESTAL.h; // sit on top of pedestal
scene.add(animalsRoot);

const gltfLoader = new GLTFLoader();

function placeAnimal(gltf, i, cellW, cellD) {
  const model = gltf.scene;

  // normalize: scale so max bbox dim = ANIMAL_FIT
  let bbox = new THREE.Box3().setFromObject(model);
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  model.scale.setScalar(ANIMAL_FIT / maxDim);

  // ground feet at y=0, center horizontally
  bbox = new THREE.Box3().setFromObject(model);
  const center = bbox.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= bbox.min.y;

  model.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  const wrapper = new THREE.Group();
  wrapper.add(model);
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  wrapper.position.x = -PEDESTAL.w / 2 + (col + 0.5) * cellW;
  wrapper.position.z = -PEDESTAL.d / 2 + (row + 0.5) * cellD;
  animalsRoot.add(wrapper);
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
  const cellW = PEDESTAL.w / COLS;
  const cellD = PEDESTAL.d / ROWS;
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
        placeAnimal(gltf, i, cellW, cellD);
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
}

loadAnimals();

window.__scene = { scene, camera, controls, renderer, pedestal, displayAnchor, keyLight, fillLight, rimLight, ambient, animalsRoot };
