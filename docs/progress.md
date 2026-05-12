# SIGGRAPH Asia Teaser — Progress

## Project context

- **Submission**: SIGGRAPH Asia video.
- **Research project**: animal motion generation — take a **static animal mesh + text prompt**
  and produce a **dynamic animation** of that animal.
- **Teaser concept**: *Night at the Museum*. Static animal models sit on a
  natural-history-museum exhibit pedestal in the dark hall; at some moment they
  "come alive" (this is where the motion-generation result enters).
- **Pipeline**: develop each shot as a three.js scene, preview in the browser,
  later render each scene to video, assemble shots in PowerPoint.

## Tech stack

- **three.js** `^0.169.0` (installed under `scenes/node_modules/three`)
- **Vite** `^5.4.10` dev server / bundler
- **No TypeScript**, no framework — plain ES modules.
- Addons used so far: `OrbitControls`, `GLTFLoader`.

## Repo layout

```
scenes/
├── package.json              # three + vite
├── vite.config.js            # auto-discovers scene_* subdirs as entry points
├── index.html                # top-level index, lists all scene_* pages
├── docs/
│   └── progress.md           # this file
├── data/                     # large assets (NOT in git, .gitignore)
│   ├── images/
│   │   ├── museum.webp       # ← current backplate (dark museum hall, dioramas)
│   │   ├── AMNH.jpg          # alt background
│   │   ├── hq720.jpg         # alt background
│   │   └── moai-statue-…jpg  # alt background
│   ├── hdri/
│   │   └── hall_of_mammals_4k.exr   # not currently used
│   └── all_animo_val/
│       ├── process1/                 # untextured GLBs (unused so far)
│       └── process1_textured/mesh/   # 90 textured animal GLBs (~1 GB total)
│           └── manifest.json         # generated list of filenames
└── scene_teaser/
    ├── index.html
    └── main.js
```

## Running on Windows

Repo is just files — copy or sync the whole `scenes/` directory across.

1. Install Node.js 20+ (anything ≥ 18 works; macOS used v23).
2. From the `scenes/` dir:

   ```powershell
   npm install
   npm run dev
   ```

3. Open <http://127.0.0.1:5173/scene_teaser/>.

The dev server serves `/data/...` files directly from the `scenes/data/`
directory (see `vite.config.js` — `server.fs.allow` includes the data dir).

### If the GLB manifest is missing

`process1_textured/mesh/manifest.json` is generated, not source. Regenerate
it with:

```powershell
python -c "import os, json; d='data/all_animo_val/process1_textured/mesh'; json.dump(sorted([f for f in os.listdir(d) if f.endswith('.glb')]), open(d+'/manifest.json','w'))"
```

(from the `scenes/` dir).

## What scene_teaser does today

All in `scene_teaser/main.js`.

### Background
- 2D screen-space backplate using `scene.background = bgTexture` with the JPG/WebP at `BG_IMAGE_URL`.
- Custom "cover" aspect logic in `updateBackgroundAspect()` keeps the image from stretching across any window aspect.
- Currently pointing at `museum.webp` (dark hall with dioramas).
- **No IBL** — HDRI was dropped per request; lighting is fully explicit.

### Lighting
- `ambient` 0.55 white
- `keyLight` warm 0xfff1d8, intensity 1.6, position (2.5, 4.5, 2), casts shadows
- `fillLight` cool 0x99b4cc, intensity 0.55, opposite side
- `rimLight` 0.3 backlight from behind

### Pedestal
- `PEDESTAL = { w: 10.0, h: 0.85, d: 5.1 }` — long, low platform
- Centered at origin, base on ground (`y = h/2`)
- `MeshStandardMaterial`, off-white #eae5dc
- Casts + receives shadows
- `displayAnchor` (empty Object3D) sits at the top-center of the pedestal —
  use this as a hook if you need to attach things to the surface.

### Animals
- Loads `data/all_animo_val/process1_textured/mesh/manifest.json` (90 files).
- Arranges all 90 in a **5 × 18 grid** on the pedestal top.
- Each model is auto-scaled so its longest bbox dimension = `ANIMAL_FIT` (0.55m).
- Models are recentered horizontally and grounded so feet touch pedestal top.
- Bounded concurrency: `LOAD_CONCURRENCY = 8` parallel `gltfLoader.loadAsync()`.
- Animations in the GLBs are **not played** (animals are static in the teaser).
- Loading progress is shown in the `#loading` overlay (`scene_teaser/index.html`).

### Camera
- `PerspectiveCamera`, FOV **22°** (long-lens, compression look).
- Position `(0, 11.5, 11.5)`, target `(0, 0.85, 0)` — front-upper, top-down feel.
- `OrbitControls` enabled for dev preview (`minDistance 3, maxDistance 30`).
  Disable / lock for final renders.

### Render settings
- ACES Filmic tone mapping, sRGB output.
- PCF soft shadow map at 2048×2048 on `keyLight`.
- DPR clamped to 2 (`Math.min(window.devicePixelRatio, 2)`).

### Dev handle
`window.__scene` exposes `{ scene, camera, controls, renderer, pedestal,
displayAnchor, keyLight, fillLight, rimLight, ambient, animalsRoot }` — tweak
from DevTools while iterating.

## Known issues

- **Performance**: loading 90 textured GLBs (~1 GB total) is what tanked the
  Mac. Once loaded, render-time perf is probably also borderline (~90
  draw-call meshes, possibly many tris). On Windows with a decent GPU it
  should be fine; if not, reduce `COLS` to load fewer animals.
- **Animal orientation** is whatever the GLBs ship with. They might not all
  face the same direction. If they look chaotic, add a per-animal Y rotation
  in `placeAnimal()` (e.g., face -Z toward the camera, or stagger by row).
- **Uniform scale** kills relative size (elephant ≈ aardvark). If we want
  natural size diversity, scale by a soft target (e.g., scale so y-height = X
  but allow per-class overrides) instead of by max bbox dim.
- **Background is screen-locked**: if the camera moves significantly during
  the shot, the backplate stays nailed to the screen and will feel wrong.
  Fine for a mostly-static teaser. If we add camera motion, switch to a real
  3D backplate plane or back to HDRI.

## Open decisions (next time)

- Final camera framing — current is a quick guess.
- Animal grid: 5 × 18 = 90, but cells are 0.55 × 1.02 m. If we want bigger
  animals we should drop to e.g. 5 × 10 or use only some species.
- Whether to play idle animations on the static frame or keep them frozen.
- How the "coming alive" beat is staged — a single animal stepping forward
  while the others stay frozen? A wave across the rows? A whole-grid trigger?
- Render pipeline: still undecided between in-browser frame capture
  (CCapture.js or canvas-record) and external screen recording. Will affect
  whether we need to lock FPS / animate deterministically.

## Other scenes

`scene_teaser` is the only scene built so far. Additional shots will live in
sibling `scene_*` directories. Vite auto-picks them up via the entry-point
glob in `vite.config.js`. The top-level `index.html` will auto-list them.
