import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BLOB_BASE = '/data/scene_2/textured_mesh/blob/';
const MESH_BASE = '/data/scene_2/textured_mesh/';

// Six swimming animals. Native frame counts (10 fps STEP):
//   tapir 250, dhole 83, panda 64, wolf 61, hippo 154, otter 62.
// Shortest = wolf, 6.0 s — we play every clip from t=0 to TRUNC_DUR and stop
// (truncation, not loop), so each cycle ends the moment the shortest clip
// would loop back. The longer clips simply don't get to finish.
const ANIMALS = [
  'The_female_bairds_tapir_swims_and_the_a2aa43eb31be.glb',
  'The_female_dhole_swims_and_then_stand_cc13c147b2da.glb',
  'The_juvenile_giant_panda_treads_water_a6e7e7b03aaf.glb',
  'The_juvenile_gray_wolf_swims_and_then_treads_water.glb',
  'The_juvenile_hippopotamus_swims_low_i_f6625608990a.glb',
  'The_male_asian_small_clawed_otter_swi_27a9b42ca295.glb',
];

const TRUNC_DUR = 6.0;        // seconds — matches the shortest clip
const COLS = 3;
const ROWS = 2;                // 3 × 2 grid (top row + bottom row)
const SPACING_X = 0.95;
const SPACING_Y = 0.7;
const ANIMAL_SCALE = 0.85;

// Per-animal foot blob indices in traversal order. All 6 scene_2 blobs share
// the same 120-mesh layout, so the indices match across animals.
//   LF=76, RF=77, LR=4, RR=55.
// Left feet read as the near side and use a brighter blue; right feet sit on
// the far side and use a slightly darker blue so the viewer can read which
// foot is which (depth cue rather than just four identical glowing blobs).
const LEFT_FOOT_INDICES = [76, 4];     // LF, LR
const RIGHT_FOOT_INDICES = [77, 55];   // RF, RR

// Blob meshes that jitter / pop-snap during the animation badly enough to
// distract — permanently hidden across all cycles for every animal.
const HIDDEN_INDICES = [87];

// Per-file Z rotation (degrees). Applied to the per-animal pivot Group so both
// the blob and the mesh rotate together around the visual centre and the
// visibility-swap doesn't shift anything. Negative = clockwise as seen by the
// camera (which looks down -Z). Used to tilt the rightmost column.
const ROTATE_Z_DEG = {
  'The_juvenile_giant_panda_treads_water_a6e7e7b03aaf.glb': -30,
  'The_male_asian_small_clawed_otter_swi_27a9b42ca295.glb': -30,
};

// Cycle 0 shows only the four feet (everything else hidden) so the viewer
// reads "I drive inpainting from a stripped-down 4-foot blob to synchronise
// the swim cadence." Cycle 1 brings the rest of the blob in as a single flat
// gray body so the feet still stand out as the message; cycle 2 reveals the
// textured mesh.
const footMaterialLeft = new THREE.MeshStandardMaterial({
  color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 1.0,
  roughness: 0.5, metalness: 0.0,
});
const footMaterialRight = new THREE.MeshStandardMaterial({
  color: 0x2563eb, emissive: 0x2563eb, emissiveIntensity: 0.9,
  roughness: 0.5, metalness: 0.0,
});
const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0x9a9a9a, emissive: 0x9a9a9a, emissiveIntensity: 0.35,
  roughness: 0.65, metalness: 0.0,
});

// `?record=1` → one-click MediaRecorder capture (same flow as scene_1).
const RECORD_MODE = new URLSearchParams(location.search).get('record') === '1';
const CYCLES_PER_REP = 3;       // gray-feet → full blob → mesh
const REPETITIONS = 1;          // single pass through the 3-cycle sequence
const STOP_AFTER_CYCLES = CYCLES_PER_REP * REPETITIONS;   // 3 cycles × 6 s = 18 s
let activeRecorder = null;

// ---- renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.05, 100);
// Horizontal eye-level view, framed to fit a 3-wide × 2-tall grid.
camera.position.set(0, 0.1, 4.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();

// ---- lighting ----
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(3, 5, 4);
scene.add(key);
const fill = new THREE.DirectionalLight(0xb8c8d8, 0.4);
fill.position.set(-3, 2.5, -2);
scene.add(fill);

// ---- resize ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- cadence indicator: one sine wave above the grid + a blue node ----
// The wave shows the swim beat I'm inpainting on; the node slides along it so
// the viewer can match the animals' strides to the same phase. Frame-counted
// timing (against the native 10 fps animation clock) so the params read the
// same as the swim itself.
const ANIM_NATIVE_FPS = 10;
const NODE_START_FRAME = 5;
const NODE_FRAMES_PER_PERIOD = 55 / 2.8;  // 5.5 s covers 2.8 periods
const WAVE_WIDTH = 2.0;
const WAVE_AMP = 0.1;
const WAVE_PERIODS = 2.8;
const WAVE_Y = 0.95;
let cadenceNode = null;

(function buildCadenceWave() {
  const SEGMENTS = 200;
  const pts = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const u = i / SEGMENTS;
    const x = (u - 0.5) * WAVE_WIDTH;
    const y = WAVE_Y + Math.sin(u * 2 * Math.PI * WAVE_PERIODS) * WAVE_AMP;
    pts.push(new THREE.Vector3(x, y, 0));
  }
  const wave = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x555555 }),
  );
  scene.add(wave);
  // Same hex as the right-foot blob so the node visually belongs to the
  // "drives the swim cadence" family of glowing markers.
  cadenceNode = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 24, 24),
    new THREE.MeshStandardMaterial({
      color: 0x2563eb, emissive: 0x2563eb, emissiveIntensity: 1.5,
      roughness: 0.4, metalness: 0,
    }),
  );
  cadenceNode.position.set(-WAVE_WIDTH / 2, WAVE_Y, 0);
  scene.add(cadenceNode);
})();

function updateCadenceNode(localT) {
  const nativeFrame = localT * ANIM_NATIVE_FPS;
  const traveled = Math.max(0, nativeFrame - NODE_START_FRAME);
  const periodsAdvanced = traveled / NODE_FRAMES_PER_PERIOD;
  // u runs 0..1 along the visible wave; clamp at the right edge so the node
  // doesn't fly off into white space if the cycle is long enough to overrun.
  const u = Math.min(periodsAdvanced / WAVE_PERIODS, 1.0);
  const x = (u - 0.5) * WAVE_WIDTH;
  const y = WAVE_Y + Math.sin(u * 2 * Math.PI * WAVE_PERIODS) * WAVE_AMP;
  cadenceNode.position.set(x, y, 0);
}

// ---- helpers ----
// All scene_2 clips ship STEP interpolation at 10 fps. STEP plays as a
// 10 fps stutter on a 60 Hz display; LINEAR (which is SLERP for quaternion
// tracks in three.js) interpolates between keyframes for smooth playback.
// Morph-weight tracks also benefit — linearly blending two adjacent target
// weights gives in-between meshes for free.
function forceLinearInterp(clip) {
  for (const track of clip.tracks) {
    track.setInterpolation(THREE.InterpolateLinear);
  }
}

// ---- loading ----
const loadingEl = document.getElementById('loading');
const gltfLoader = new GLTFLoader();
const animals = [];

async function loadAnimal(filename, xOffset, yOffset) {
  const [blobGltf, meshGltf] = await Promise.all([
    gltfLoader.loadAsync(BLOB_BASE + filename),
    gltfLoader.loadAsync(MESH_BASE + filename),
  ]);

  // ---- Blob ----
  const blobModel = blobGltf.scene;
  const blobMixer = new THREE.AnimationMixer(blobModel);
  let blobAction = null;
  if (blobGltf.animations && blobGltf.animations.length > 0) {
    const clip = blobGltf.animations[0];
    forceLinearInterp(clip);
    blobAction = blobMixer.clipAction(clip);
    blobAction.play();
    blobMixer.setTime(0);
  }

  // Three shared materials cover every blob mesh: left-foot blue, right-foot
  // (darker) blue, and the uniform body gray. We no longer carry the GLB's
  // per-mesh authored colors — the message in cycle 1 is "feet vs body", not
  // a colorful palette. HIDDEN meshes stay invisible and are excluded from
  // both lists so cycle 1's reveal can't drag them back in.
  const leftFootSet = new Set(LEFT_FOOT_INDICES);
  const rightFootSet = new Set(RIGHT_FOOT_INDICES);
  const hiddenSet = new Set(HIDDEN_INDICES);
  const footMeshes = [];
  const nonFootMeshes = [];
  let meshIdx = 0;
  blobModel.traverse((obj) => {
    if (obj.isMesh) {
      if (hiddenSet.has(meshIdx)) {
        obj.visible = false;
      } else if (leftFootSet.has(meshIdx)) {
        obj.material = footMaterialLeft;
        footMeshes.push(obj);
      } else if (rightFootSet.has(meshIdx)) {
        obj.material = footMaterialRight;
        footMeshes.push(obj);
      } else {
        obj.material = bodyMaterial;
        nonFootMeshes.push(obj);
      }
      meshIdx++;
    }
  });

  // ---- Mesh ----
  const meshModel = meshGltf.scene;
  const meshMixer = new THREE.AnimationMixer(meshModel);
  let meshAction = null;
  if (meshGltf.animations && meshGltf.animations.length > 0) {
    const clip = meshGltf.animations[0];
    forceLinearInterp(clip);
    meshAction = meshMixer.clipAction(clip);
    meshAction.play();
    meshMixer.setTime(0);
  }

  // ---- Placement ----
  // Both the blob and the mesh get centred at the origin of their own local
  // frame, then parented to a pivot Group placed at (xOffset, yOffset). Any
  // per-animal Z rotation (e.g. tilting the rightmost column) is applied to
  // the pivot so the rotation axis is the visual centre — and so the cycle
  // swap blob↔mesh never displaces anything.
  for (const model of [blobModel, meshModel]) {
    model.scale.setScalar(ANIMAL_SCALE);
    const bbox = new THREE.Box3().setFromObject(model);
    model.position.x -= bbox.getCenter(new THREE.Vector3()).x;
    model.position.z -= (bbox.min.z + bbox.max.z) / 2;
    model.position.y -= (bbox.min.y + bbox.max.y) / 2;
  }
  meshModel.visible = false;  // cycle 0 = blob

  const pivot = new THREE.Group();
  pivot.position.set(xOffset, yOffset, 0);
  const rotZ = ROTATE_Z_DEG[filename] || 0;
  if (rotZ) pivot.rotation.z = rotZ * Math.PI / 180;
  pivot.add(blobModel);
  pivot.add(meshModel);
  scene.add(pivot);

  animals.push({ filename, blobRoot: blobModel, meshRoot: meshModel, pivot, footMeshes, nonFootMeshes, blobMixer, meshMixer, blobAction, meshAction });
}

async function loadAll() {
  let i = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (i >= ANIMALS.length) break;
      const xOffset = (col - (COLS - 1) / 2) * SPACING_X;
      const yOffset = ((ROWS - 1) / 2 - row) * SPACING_Y;  // row 0 on top
      loadingEl.textContent = `LOADING ${i + 1}/${ANIMALS.length}…`;
      await loadAnimal(ANIMALS[i], xOffset, yOffset);
      i++;
    }
  }
  loadingEl.classList.add('hidden');
}

// ---- render loop ----
// Two-cycle take: cycle 0 plays the blob clips truncated to TRUNC_DUR,
// cycle 1 plays the mesh clips. After cycle 1 we either loop (default) or
// freeze for record mode.
const clock = new THREE.Clock(false);

// cycle 0: only the 4 foot blobs visible per animal (glowing blue)
// cycle 1: full colored blob, feet still glowing blue
// cycle 2: textured mesh
function setCycleState(cycleIdx, localT) {
  const cycle = ((cycleIdx % CYCLES_PER_REP) + CYCLES_PER_REP) % CYCLES_PER_REP;
  const showBlob = (cycle === 0 || cycle === 1);
  const showNonFoot = (cycle === 1);
  for (const a of animals) {
    a.blobRoot.visible = showBlob;
    a.meshRoot.visible = !showBlob;
    if (showBlob) {
      a.blobMixer.setTime(localT);
      // feet are always visible in any blob cycle; non-foot meshes are
      // only revealed once we hit cycle 1.
      for (const m of a.footMeshes) m.visible = true;
      for (const m of a.nonFootMeshes) m.visible = showNonFoot;
    } else {
      a.meshMixer.setTime(localT);
    }
  }
  updateCadenceNode(localT);
}

function tick() {
  if (!clock.running) {
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
    return;
  }

  const t = clock.getElapsedTime();

  if (RECORD_MODE && t >= STOP_AFTER_CYCLES * TRUNC_DUR) {
    // Freeze on the last frame of the final (mesh) cycle.
    setCycleState(STOP_AFTER_CYCLES - 1, TRUNC_DUR);
    controls.update();
    renderer.render(scene, camera);
    if (activeRecorder && activeRecorder.state === 'recording') {
      activeRecorder.stop();
    }
    return;
  }

  // In non-record mode we just loop the (gray-feet → blob → mesh) sequence
  // forever (period = CYCLES_PER_REP × TRUNC_DUR = 18 s).
  const phase = RECORD_MODE ? t : (t % (CYCLES_PER_REP * TRUNC_DUR));
  const cycleIdx = Math.floor(phase / TRUNC_DUR);
  const localT = phase - cycleIdx * TRUNC_DUR;
  setCycleState(cycleIdx, localT);

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// ---- record-mode wiring (same one-click flow as scene_1) ----
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
    a.download = `scene_2_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
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
      clock.start();
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

window.__scene = { scene, camera, controls, renderer, animals };
