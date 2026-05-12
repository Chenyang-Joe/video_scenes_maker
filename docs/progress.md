# SIGGRAPH Asia Teaser — Progress

## Project context

- **Submission**: SIGGRAPH Asia video.
- **Research project**: animal motion generation — take a **static animal mesh + text prompt**
  and produce a **dynamic animation** of that animal.
- **Teaser concept**: *Night at the Museum*. Animal models sit on a
  natural-history-museum exhibit pedestal in the dark hall; at some moment they
  "come alive" (this is where the motion-generation result enters).
- **Pipeline**: develop each shot as a three.js scene, preview in the browser,
  later render each scene to video, assemble shots in PowerPoint.

## Status

`scene_teaser` is **complete**. End-to-end shot = **9 s intro + 30 s main loop**
(loops forever). 4K@60 MP4 recording works via `?record=1`. Title is **not**
in the scene — it'll be composited in post.

## Tech stack

- **three.js** `^0.169.0`
- **Vite** `^5.4.10` dev server / bundler
- **canvas-record** `^5.5` for offline frame-locked MP4 capture (WebCodecs H.264)
- **No TypeScript**, no framework — plain ES modules.
- Addons used: `OrbitControls`, `GLTFLoader`, `AnimationMixer`, `THREE.Points`,
  `MeshBasicMaterial`.
- **Python 3.13** for offline GLB preprocessing (`pygltflib`, `Pillow`, `numpy`).

## Repo layout

```
video_scenes_maker/
├── package.json
├── vite.config.js               # auto-discovers scene_* subdirs as entry points
├── index.html                   # top-level index, lists all scene_* pages
├── docs/
│   └── progress.md
├── data/                        # large assets (NOT in git, .gitignore)
│   ├── images/museum.webp       # current backplate
│   ├── scripts/
│   │   └── lift_dark_textures.py
│   └── all_animo_val/
│       ├── process1/transforms/*.npz       # reference only (per-frame root T)
│       ├── process1_textured_post1/
│       │   ├── mesh/*.glb                  # 90 textured animated animals (~1 GB)
│       │   ├── blob/*.glb                  # 90 particle-cloud versions of the same animals
│       │   └── scaling.json
│       └── process1_textured_post2/
│           ├── mesh/*.glb                  # post1/mesh + dark-texture lift (LOADED BY SCENE)
│           └── mesh/manifest.json
└── scene_teaser/
    ├── index.html
    └── main.js                              # ~900 lines
```

## Running on Windows

```powershell
npm install
npm run dev
```

Open <http://127.0.0.1:5173/scene_teaser/>.

### Recording mode

```
http://127.0.0.1:5173/scene_teaser/?record=1
```

Optional: `&res=4k|1440p|1080p|720p` (default `4k`), `&fps=30|60` (default `60`).
Defaults produce a **3840×2160 @ 60 fps** MP4 covering the full 9 s intro +
30 s first cycle (= 39 s, 2340 frames). Auto-downloads to the browser's
download folder when done. Wall-clock encode time ≈ 0.7× video length on
modest hardware.

Notes:
- The page enters a synchronous, frame-locked tick loop — animations advance
  by exactly `1/fps` per frame, independent of real wall-clock. Output is
  deterministic.
- WebGL `preserveDrawingBuffer` is enabled only in record mode.
- The window's resize listener is skipped in record mode (otherwise opening
  DevTools collapses the 4K backbuffer to the viewport size).
- `controls.update()` is also skipped in record mode; we manually
  `camera.lookAt(controls.target)` instead — without that the camera's
  orientation matrix never refreshes and the recording shows a static
  view direction.

### Asset pipelines

#### Manifest regeneration

```powershell
python -c "import os, json; d=r'data\all_animo_val\process1_textured_post2\mesh'; json.dump(sorted([f for f in os.listdir(d) if f.endswith('.glb')]), open(os.path.join(d,'manifest.json'),'w'))"
```

#### Dark-texture lift (post1 → post2)

`data/scripts/lift_dark_textures.py` walks `post1/mesh/*.glb`, decodes each
embedded texture, and lifts the ones with mean luminance < `DARK_THRESHOLD`
(0.18 currently). Lifted images get autocontrast + gamma 0.6. Currently
~9/90 GLBs are touched (wild water buffalo, siamang, etc.). Output:
`post2/mesh/*.glb`. Run again whenever the post1 source is refreshed.

## What scene_teaser does today

All in `scene_teaser/main.js` (~900 lines).

### Timeline

#### Intro (9 s, one-shot — runs once, then never again)

| Time | Phase | What happens |
|---|---|---|
| 0–2 s | `INTRO_T1` | Static at `CAM_HORIZON` — pedestal parked below the frame, only background visible |
| 2–5 s | `INTRO_T2` | Lerp `CAM_HORIZON → CAM_FULL` — pedestal rises into view and grows to fill the screen |
| 5–7 s | `INTRO_T3` | Hold on the full-pedestal "display" shot |
| 7–9 s | `INTRO_DURATION` | Zoom in `CAM_FULL → CAM_ROWS` + slide `displayGroup` to the tour's corner A so the main cycle starts seamlessly |

#### Main cycle (30 s, loops forever)

| Time (cycle-local) | Phase | What happens |
|---|---|---|
| 0–3 s | `freezeUntil` | Animals frozen at frame 0 |
| 3 s | `flashStart` | One-shot green particle burst (500 `THREE.Points`, additive blending) |
| 3–15 s | — | Textured animals animate (mesh anime) |
| 15–25 s | `blobStart..blobEnd` | Textured swapped for blob (particle-cloud) versions |
| 25–30 s | — | Swapped back to textured (still animating). Cycle wraps at 30 s and animations reset to frame 0 |

The cycle clock is `sceneClock.getElapsedTime() − INTRO_DURATION`, taken
`% CYCLE_DURATION`. On wrap, every `AnimationAction.time` is reset to 0 and
the particle flash is re-armed.

### Camera setup

Three presets, lerped during intro:

| Preset | `pos` | `target` | `fov` | Notes |
|---|---|---|---|---|
| `CAM_HORIZON` | (0, 2.0, 6) | (0, 2.0, -10) | 32° | Horizontal look, pedestal mostly below the frame |
| `CAM_FULL` | (0, 8.5, 4.8) | (0, 0.5, 0) | 32° | ~60° bird's-eye, pedestal fills ~105% of width |
| `CAM_ROWS` | (0, 8, 11.5) | (0, 0.9, 0) | 5.5° | Tight telephoto — 3 rows × ~6 cols visible at a time |

Smoothstep easing on every lerp segment. After intro the camera is fixed at
`CAM_ROWS`; the tour moves `displayGroup` instead.

### Pedestal & grid

- `PEDESTAL = { w: 10, h: 0.85, d: 5.1 }` (off-white `MeshStandardMaterial`).
- `PAD = 0.4` m → grid lives in 9.2 × 4.3 m.
- **6 rows × 15 cols = 90 cells**, cellW = 0.613, cellD = 0.717.
- Pedestal + animals are wrapped in a `displayGroup` that the tour pans.

### Tour (camera-fixed rectangular pan)

Camera is fixed; `displayGroup.position.x/z` walks a rectangle. Four corners:

```
              cols 0–5         cols 9–14
 rows 0–2     A ─── slowly → ─▶ B
              ▲                  │
              │                  │ down
        finally up               ▼
              │                  │
 rows 3–5     D ◀── then left ─── C
```

- Order `A → B → C → D → A`, **linear** interpolation, **constant speed**
  (each segment's time ∝ its distance), no easing at corners.
- `tour.period = 30 s` (synced with `CYCLE_DURATION`).
- `tour.xAmp = 3.4`, `tour.zAmp = 1.075`.

### Animals (textured)

- Source: `data/all_animo_val/process1_textured_post2/mesh/*.glb` + manifest.
- Manifest is **shuffled** with a seeded Fisher–Yates (`SHUFFLE_SEED = 0x9E3779B1`)
  before slicing to 90. Deterministic across reloads but not alphabetical.
- `MANUAL_SWAPS` list applies a few hand-picked index swaps after the shuffle
  (currently `[17, 81]` — placed the king penguin at row 2 col 3).
- `ANIMAL_SCALE = 0.4`, **no bbox-normalization** (post1 already volume-normalized).
- `ANIMAL_LIFT = 0.002` m above pedestal (avoids z-fighting, gap not visible).
- Bounded-concurrency loader: `LOAD_CONCURRENCY = 8`.

#### Per-file tweaks
- `ROTATE_180` set (~38 filenames) — flips back-facing GLBs 180° around Y.
- `ROTATE_Y_EXTRA_DEG = { 'Sand_Cat_Female_…': 100 }` — extra CCW rotation on
  top of `ROTATE_180`. Indexed by full filename so a re-shuffle doesn't break it.
- `SCALE_OVERRIDES = {}` (substring match on filename; currently empty).

#### Animation playback (the tricky part)

These GLBs encode their "animated" position via root translation + morph
targets — **frame 0 is at a different world position from frames 1+**.
Naively computing the bbox without evaluating the animation puts the
rest pose at the wrong center, and animals snap out of their cells the
instant playback starts.

Fix in `placeAnimal`:
1. Create the `AnimationMixer`, `action.play()`, then `mixer.update(0)` —
   this evaluates the frame-0 deformation **before** any bbox math.
2. For y-grounding, sample 30 evenly-spaced times across the clip and
   take `min(bbox.min.y)` over the sweep, so crouch / stomp frames don't
   sink feet into the pedestal.
3. **Both** `new THREE.Box3().setFromObject(model, true)` calls pass
   `precise=true` — otherwise three.js reads the static `geometry.boundingBox`
   and ignores morph targets, returning the same wrong bbox every sample.
4. xz centering uses frame 0 only. Horizontal drift between animation
   frames is small enough that averaging didn't help.

### Animals (blob / particle-cloud version)

- Source: `data/all_animo_val/process1_textured_post1/blob/*.glb`.
- Each blob GLB is a **120-mesh point-cloud-like representation** of the same
  animal (small spheres at varied positions, no textures).
- Loaded **in the background** after textured load finishes; the swap at
  cycle-15 is graceful (if a blob hasn't loaded yet, that cell stays
  textured for the cycle).
- Materials: each mesh's HSL saturation is pumped (×1.7 with floor 0.25,
  lightness floor 0.45), and the (already brightened) color is copied to
  `emissive` at `emissiveIntensity = 0.3` — keeps the original per-mesh
  palette but reads cleanly against the warm pedestal.
- Animation mixers are created if the blob ships with them, but ticked
  only while the blob is the visible representation (to save CPU).

### Particle flash

- 500 `THREE.Points`, `PointsMaterial` with `AdditiveBlending`,
  `size = 0.35`, color `0x39ff14` (neon green).
- One-shot burst from `(0, 4, 5)` — a point in front of the camera on the
  camera→target ray. Each particle gets a uniformly random unit-sphere
  direction × speed `3.0–9.0 m/s`, lifetime `1.8–3.4 s`.
- `_flashSpawnedThisCycle` flag is reset on cycle wrap.
- `frustumCulled = false` on the Points object — without that, three.js
  caches the boundingSphere from the initial "all parked at y=-1000"
  positions and never renders the burst.

### Lighting

| Light | Static phase (cycle 0–3 s) | Animated phase (cycle 3 s +) |
|---|---|---|
| `ambient` (warm white) | **0.55** (const) | 0.55 |
| `fillLight` (warm, casts shadow) | **0.6**, shadow on | 0.3, shadow off (after a 1 s fade) |
| `rimLight` (warm) | **0.45** | 0.3 |
| `topSpot` (warm spot, straight-down) | **0** | 0 → 9 over 1.2 s |

All three lights share the **same warm tint** (`SPOT_COLOR = 0xfff1d8`) so
overall color temperature doesn't shift at the flash. `topSpot` is the
only phase-dependent light intensity-wise; fill/rim crossfade at
`PHASE.freezeUntil`.

`topSpot` is a `SpotLight` positioned at `(0, 8, -0.2)` pointing straight
down at world origin. Cone half-angle `0.20 rad` (≈ 11.5°) → disk a bit
bigger than the visible cone on the pedestal, so the boundary lands just
inside the frame edges. Penumbra `0.4`.

### Shadows

- **`THREE.VSMShadowMap`** (variance shadow maps — separable Gaussian blur,
  much softer than PCF without acne).
- `topSpot.shadow`: mapSize 4096², frustum near 5 / far 8.5, bias -0.0006,
  normalBias 0.02, **radius 10**, blurSamples 24.
- `fillLight.shadow`: mapSize 2048², radius 5, blurSamples 16.

### Dark animal lift

Two layers stacked because GLB textures vary wildly:
1. Offline (`lift_dark_textures.py`): autocontrast + gamma 0.6 on textures
   with mean luminance < 0.18. ~9/90 GLBs.
2. Runtime (in `placeAnimal`): every textured mesh gets
   `emissiveMap = baseColorMap`, `emissive = white`, `emissiveIntensity = 0.15`.
   Adds a low, texture-driven self-glow that lifts dark fur without
   washing out bright animals.

### Render settings

- ACES Filmic tone mapping, sRGB output.
- DPR clamped to 2 in preview; **1** in record (canvas backbuffer is 4K explicitly).
- `antialias: true` (MSAA on the main framebuffer).

### Dev handles (DevTools)

`window.__scene` exposes
`{ scene, camera, controls, renderer, pedestal, displayAnchor, ambient,
topSpot, fillLight, rimLight, animalsRoot, displayGroup, tour, sceneClock,
PHASE, animals, CYCLE_DURATION, particles }`.

Examples:
```js
__scene.tour.period = 60        // slower pan
__scene.PHASE.blobStart = 10    // earlier swap
__scene.particles.material.color.set(0xffaa44)
```

## Known issues / sharp edges

- **Load time**: 90 GLBs × 30 precise-bbox samples ≈ several seconds on the
  loading screen (each sample walks every vertex). Acceptable for preview;
  if it gets worse, halve `samples` or drop precise on the centering bbox.
- **xz drift during animation**: we only center xz on frame 0. Most morph
  animations are small-amplitude so it's invisible, but if a future
  animation pack has larger horizontal motion, switch to sequence-average
  xz like we did for y.
- **Background is screen-locked**: fine because the tour translates the
  `displayGroup`, not the camera. If a future scene moves the camera in
  3D, the backplate will feel glued; switch to a real 3D backplate plane
  or HDRI.
- **`ROTATE_180` is keyed by filename**: survives a re-shuffle, but if the
  manifest gets reordered by re-running `process1` / `post1`, the per-file
  rotation tweaks need a regression review.
- **4K recording memory**: bumping shadow map size to 8192² in record mode
  caused WebGL context loss (VSM 8192² ≈ 512 MB on top of ~1.4 GB of
  textures). Keeping shadow maps at preview size in record mode.

## Reference: tunable constants (`scene_teaser/main.js`)

| Constant | Value | Meaning |
|---|---|---|
| `INTRO_DURATION` | 9 s | total one-shot intro |
| `INTRO_T1 / T2 / T3` | 2 / 5 / 7 s | intro sub-phase boundaries |
| `CYCLE_DURATION` | 30 s | main loop period |
| `PHASE.freezeUntil` | 3 s | animations resume at this point in the cycle |
| `PHASE.flashStart` | 3 s | particle burst fires once at cycle start + freezeUntil |
| `PHASE.blobStart / blobEnd` | 15 / 25 s | textured ↔ blob swap window |
| `ROWS × COLS` | 6 × 15 | grid (= 90, matches manifest) |
| `ANIMAL_SCALE` | 0.4 | uniform multiplier per animal |
| `ANIMAL_LIFT` | 0.002 | z-fighting offset above pedestal |
| `PAD` | 0.4 | pedestal edge inset |
| `LOAD_CONCURRENCY` | 8 | parallel `gltfLoader.loadAsync` |
| `SHUFFLE_SEED` | `0x9E3779B1` | deterministic Fisher–Yates seed |
| `tour.period / xAmp / zAmp` | 30 / 3.4 / 1.075 | rectangle pan |
| `PARTICLE_COUNT / SIZE / COLOR` | 500 / 0.35 / `0x39ff14` | flash burst |
| `SPOT_INTENSITY_ON` | 9 | top spotlight peak |
| `SPOT_ANGLE / PENUMBRA` | 0.20 / 0.4 | spotlight cone (radians) |
| `FILL_STATIC / FILL_ANIM` | 0.6 / 0.3 | fill light intensity |
| `RIM_STATIC / RIM_ANIM` | 0.45 / 0.3 | rim light intensity |

## Reference: offline scripts (`data/scripts/`)

- `lift_dark_textures.py` — post1 → post2 dark-albedo lift (described above).
- `process_glb_scale.py`, `apply_scale_to_others.py`, `stack_glbs.py`,
  `probe_glb*.py`, `verify_*.py` — earlier pipeline that built post1
  (volume-normalize each animal vs reference Aardvark). Reference only;
  the scene doesn't depend on them at runtime.

## Open decisions (next scenes)

- **The "coming alive" moment**: where the actual motion-generation result
  enters the teaser. Options: a single animal stepping forward off the
  pedestal while others stay frozen; a wave across the grid; whole-grid
  trigger from the flash; or a closeup shot of one specific result.
- **Asset cleanup**: `data/result.tar.gz` (~1.3 GB) is still on disk,
  redundant with the extracted `all_animo_val/`. Safe to delete.
- **Camera motion within shots**: scene_teaser keeps the camera fixed and
  pans the displayGroup. If a future scene needs the camera to move in 3D,
  the screen-locked backplate has to be replaced.
