import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BLOB_BASE = '/data/scene_1/blob/';
// Same animal filenames; each mesh GLB has one POSITION morph target pre-baked
// at slider=+100 (LBS from blob → mesh). See data/scripts/bake_scene1_mesh_morph.py.
const MESH_BASE = '/data/scene_1/mesh/';

// Three quadrupeds with clear leg structure (scene_1's self-contained copy).
const ANIMALS = [
  'African_Elephant_Female__african_elep_cc89c098eb78.glb',
  'Bengal_Tiger_Female__bengal_tiger_fem_85a98badff8b.glb',
  'Grizzly_Bear_Female__grizzly_bear_fem_11bc3ce97aa2.glb',
];

// Per-file Y rotation (degrees). Applied before bbox/centering.
const ROTATE_Y_DEG = {
  'Bengal_Tiger_Female__bengal_tiger_fem_85a98badff8b.glb': 180,
  'Grizzly_Bear_Female__grizzly_bear_fem_11bc3ce97aa2.glb': 90,
};

// Per-file horizontal nudge (world X, metres) on top of the trio grid layout.
// Used for fine-tuning when bbox centering leaves an animal feeling off-axis.
const NUDGE_X = {
  'Bengal_Tiger_Female__bengal_tiger_fem_85a98badff8b.glb': 0.08,
};

// Blob mesh indices that make up the left leg. Order doesn't matter — the
// shift falloff is computed from each mesh's Y at load time (linear interp:
// lowest Y → full shift, highest Y → 0).
const LEG_INDICES = [44, 45, 46, 47, 48, 49, 50, 51, 26, 110, 111, 13];

// Body keeps each blob's GLB-authored color; we just add a mild self-glow.
// The leg meshes are repainted to stand out from whatever palette the body uses.
const BODY_EMISSIVE_INTENSITY = 0.5;
const LEG_COLOR  = 0xff4466;     // warm red-pink left leg
const LEG_EMISSIVE_INTENSITY = 1.0;

const ANIMAL_SCALE = 1.0;        // big enough to fill the frame
const ANIMAL_SPACING = 0.9;       // metres between adjacent animals (x axis)
const ANIMAL_LIFT = 0.25;         // raise the trio so they sit vertically centered
const MAX_LEG_SHIFT_LOCAL = 0.05; // subtle leg sweep — must match MAX_LEG_SHIFT in the bake script
// Shift along the diagonal z = -x in WORLD axes. Per animal we rotate this
// into the model's local frame (inverse of model.rotation) so the world-space
// direction is the same for all three regardless of their per-file rotation.
const SHIFT_DIR_WORLD = new THREE.Vector3(1, 0, -1).normalize();

// Auto-loop the slider with a sine wave so the demo plays itself.
const SLIDER_PERIOD = 4.0; // seconds for one full -100 → +100 → -100 cycle

// ---- renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
// No floor → nothing to receive shadows; keep the renderer simple.
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.05, 100);
// Horizontal view — eye-level with the middle of the animals
camera.position.set(0, 0.5, 2.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();

// ---- lighting ----
const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);

const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(3, 5, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 15;
key.shadow.camera.left = -4;
key.shadow.camera.right = 4;
key.shadow.camera.top = 4;
key.shadow.camera.bottom = -4;
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.02;
key.shadow.radius = 6;
key.shadow.blurSamples = 16;
scene.add(key);

const fill = new THREE.DirectionalLight(0xb8c8d8, 0.4);
fill.position.set(-3, 2.5, -2);
scene.add(fill);

// No floor — just a pure-white scene background.

// ---- resize ----
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ---- animal loading ----
const loadingEl = document.getElementById('loading');
const gltfLoader = new GLTFLoader();

// One entry per animal:
//   { root, legMeshes, legOriginY[] (saved local positions) }
const animals = [];

async function loadAnimal(filename, xOffset) {
  // Load both blob (live-edited) and pre-baked mesh (morph-target driven) in parallel.
  const [blobGltf, meshGltf] = await Promise.all([
    gltfLoader.loadAsync(BLOB_BASE + filename),
    gltfLoader.loadAsync(MESH_BASE + filename),
  ]);

  const rotDeg = ROTATE_Y_DEG[filename] || 0;
  const rotRad = rotDeg * Math.PI / 180;
  const localShiftDir = SHIFT_DIR_WORLD
    .clone()
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), -rotRad);
  const effectiveX = xOffset + (NUDGE_X[filename] || 0);

  // ---- Blob ----
  const blobModel = blobGltf.scene;
  // Force the first animation frame so blob nodes sit at their frame-0 pose.
  if (blobGltf.animations && blobGltf.animations.length > 0) {
    const mixer = new THREE.AnimationMixer(blobModel);
    mixer.clipAction(blobGltf.animations[0]).play();
    mixer.update(0);
  }
  if (rotDeg) blobModel.rotation.y = rotRad;

  // Collect every blob mesh in traversal order (the glTF node index the user
  // tagged the leg with, e.g. 47/48/49).
  const blobMeshes = [];
  blobModel.traverse((obj) => { if (obj.isMesh) blobMeshes.push(obj); });

  const legSet = new Set(LEG_INDICES);
  blobMeshes.forEach((mesh, idx) => {
    const isLeg = legSet.has(idx);
    mesh.material = mesh.material.clone();
    if (isLeg) {
      mesh.material.color = new THREE.Color(LEG_COLOR);
      mesh.material.emissive = new THREE.Color(LEG_COLOR);
      mesh.material.emissiveIntensity = LEG_EMISSIVE_INTENSITY;
    } else if (mesh.material.emissive) {
      mesh.material.emissive = new THREE.Color().copy(mesh.material.color);
      mesh.material.emissiveIntensity = BODY_EMISSIVE_INTENSITY;
    }
    mesh.material.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  blobModel.scale.setScalar(ANIMAL_SCALE);
  const blobBbox = new THREE.Box3().setFromObject(blobModel);
  const blobCenter = blobBbox.getCenter(new THREE.Vector3());
  blobModel.position.x -= blobCenter.x;
  blobModel.position.z -= blobCenter.z;
  blobModel.position.y -= blobBbox.min.y;
  blobModel.position.y += ANIMAL_LIFT;
  blobModel.position.x += effectiveX;
  scene.add(blobModel);

  const legMeshes = LEG_INDICES.map((i) => blobMeshes[i]).filter(Boolean);
  const legOriginX = legMeshes.map((m) => m.position.x);
  const legOriginZ = legMeshes.map((m) => m.position.z);
  const ys = legMeshes.map((m) => m.position.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yRange = (yMax - yMin) || 1;
  const legFactor = ys.map((y) => (yMax - y) / yRange);

  // ---- Mesh ----
  const meshModel = meshGltf.scene;
  if (rotDeg) meshModel.rotation.y = rotRad;
  meshModel.scale.setScalar(ANIMAL_SCALE);

  // The grizzly's albedo texture is much darker than the elephant/tiger,
  // which reads as muddy under our standard lighting. Boost its base color
  // (multiplied with the albedo map) so it sits at a similar brightness as
  // the other two for the scene_1 comparison.
  const isBear = /grizzly/i.test(filename);
  const BEAR_BRIGHTEN = 1.8;

  // Find the morphable mesh (the textured surface; has POSITION morph target).
  let morphMesh = null;
  meshModel.traverse((obj) => {
    if (obj.isMesh) {
      if (obj.morphTargetInfluences && obj.morphTargetInfluences.length > 0) {
        morphMesh = obj;
      }
      if (isBear) {
        obj.material = obj.material.clone();
        obj.material.color.multiplyScalar(BEAR_BRIGHTEN);
        obj.material.needsUpdate = true;
      }
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  // Ground + center mesh using its own bbox so it lands at the same trio
  // height as the blob (per-animal differences are millimetric — they share a
  // scale_wrapper so the bboxes track each other closely).
  const meshBbox = new THREE.Box3().setFromObject(meshModel);
  const meshCenter = meshBbox.getCenter(new THREE.Vector3());
  meshModel.position.x -= meshCenter.x;
  meshModel.position.z -= meshCenter.z;
  meshModel.position.y -= meshBbox.min.y;
  meshModel.position.y += ANIMAL_LIFT;
  meshModel.position.x += effectiveX;
  meshModel.visible = false; // initial cycle is blob
  scene.add(meshModel);

  animals.push({
    blobRoot: blobModel,
    meshRoot: meshModel,
    morphMesh,
    legMeshes, legOriginX, legOriginZ, legFactor,
    localShiftDir,
  });
}

async function loadAll() {
  const totalSpan = (ANIMALS.length - 1) * ANIMAL_SPACING;
  const startX = -totalSpan / 2;
  for (let i = 0; i < ANIMALS.length; i++) {
    loadingEl.textContent = `LOADING ${i + 1}/${ANIMALS.length}…`;
    await loadAnimal(ANIMALS[i], startX + i * ANIMAL_SPACING);
  }
  loadingEl.classList.add('hidden');
}

// `?record=1` switches the demo to a finite-length, self-recording take:
//   1. show a "Start recording" button after loading finishes
//   2. on click, request tab capture via getDisplayMedia (one Share prompt)
//   3. start MediaRecorder + start the clock together → exactly 2 loops run
//   4. on freeze, stop the recorder and auto-download a .webm
// Convert to mp4 in post with ffmpeg if needed (`ffmpeg -i in.webm out.mp4`).
const RECORD_MODE = new URLSearchParams(location.search).get('record') === '1';
const STOP_AFTER_LOOPS = 2;
let activeRecorder = null;

// ---- slider → leg translation + mesh morph ----
const slider = document.getElementById('leg-slider');

function applyLegShift(rawValue) {
  const t = rawValue / 100;   // -1..+1
  for (const a of animals) {
    const sx = a.localShiftDir.x;
    const sz = a.localShiftDir.z;
    for (let i = 0; i < a.legMeshes.length; i++) {
      const d = t * MAX_LEG_SHIFT_LOCAL * a.legFactor[i];
      a.legMeshes[i].position.x = a.legOriginX[i] + d * sx;
      a.legMeshes[i].position.z = a.legOriginZ[i] + d * sz;
    }
  }
}

// LBS-baked morph target #0 was baked at slider=+100, so influence = v/100
// linearly covers the full bidirectional range (three.js allows negative
// morph weights, which mirrors the deformation for v<0).
function applyMeshMorph(rawValue) {
  const t = rawValue / 100;
  for (const a of animals) {
    if (a.morphMesh && a.morphMesh.morphTargetInfluences.length > 0) {
      a.morphMesh.morphTargetInfluences[0] = t;
    }
  }
}

// ---- render loop ----
// Two-cycle alternation: cycle 0 shows the blob (live JS leg shift);
// cycle 1 shows the textured mesh (pre-baked LBS morph driven by slider).
// The slider self-loops with a -sin wave (start 0 → left → 0 → right → 0).
// Record mode: the clock starts only after loadAll finishes, so the recording
// doesn't include the loading overlay or any partial first frames.
const clock = new THREE.Clock(false);

function tick() {
  if (!clock.running) {
    // Loading still in progress (record mode keeps the clock paused until
    // loadAll resolves). Render an idle frame so the canvas isn't blank.
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
    return;
  }

  const t = clock.getElapsedTime();

  if (RECORD_MODE && t >= STOP_AFTER_LOOPS * SLIDER_PERIOD) {
    // End-of-take freeze: rest pose, mesh visible (closes the mesh cycle
    // cleanly so the final still matches the last animation frame the viewer
    // sees right before the stop).
    slider.value = '0';
    applyLegShift(0);
    applyMeshMorph(0);
    for (const a of animals) {
      a.blobRoot.visible = false;
      a.meshRoot.visible = true;
    }
    controls.update();
    renderer.render(scene, camera);
    if (activeRecorder && activeRecorder.state === 'recording') {
      activeRecorder.stop();  // triggers onstop → file download
    }
    return; // no more rAF — demo is parked
  }

  const v = -Math.sin((t * 2 * Math.PI) / SLIDER_PERIOD) * 100;
  slider.value = String(v);
  applyLegShift(v);
  applyMeshMorph(v);

  const isBlobCycle = (Math.floor(t / SLIDER_PERIOD) % 2) === 0;
  for (const a of animals) {
    a.blobRoot.visible = isBlobCycle;
    a.meshRoot.visible = !isBlobCycle;
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

async function startTabRecording() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 60, cursor: 'never' },
    audio: false,
    preferCurrentTab: true,
  });
  const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 12_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scene_1_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };
  recorder.start();
  return recorder;
}

const loadPromise = loadAll();

if (RECORD_MODE) {
  const btn = document.createElement('button');
  btn.textContent = 'Loading…';
  btn.disabled = true;
  Object.assign(btn.style, {
    position: 'fixed', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    padding: '18px 36px',
    fontSize: '22px',
    fontWeight: '600',
    fontFamily: 'inherit',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    zIndex: 100,
    boxShadow: '0 8px 24px rgba(59, 130, 246, 0.4)',
  });
  document.body.appendChild(btn);

  loadPromise.then(() => {
    btn.disabled = false;
    btn.textContent = 'Start recording';
  });

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Requesting share…';
    try {
      activeRecorder = await startTabRecording();
      btn.remove();
      clock.start();  // run the 2-loop take from t = 0 now that the encoder is hot
    } catch (err) {
      console.warn('Recording cancelled or failed:', err);
      btn.disabled = false;
      btn.textContent = 'Start recording';
    }
  };
} else {
  loadPromise.then(() => clock.start());
}

tick();

window.__scene = { scene, camera, controls, renderer, animals, applyLegShift, applyMeshMorph };
