# Wet Denier Lab

An interactive WebGL toy: tap the stockings to splash water. Splashes burst, wet fabric turns see-through,
beads cling, slide and drip onto the floor. You can switch scenes (studio, bath, street, pool), poses and
outfits (length, cuff, material, denier, color, pattern, hidden decals, or bare legs), take photos and share a link that
restores the exact look. The feet have real toes: bare, or seen through a stocking that stretches over them.

The UI is available in Simplified Chinese (zh-CN) and US English (en-US). It follows the browser's language, and
the globe button in the top corner switches it.

## Stack

- [Vite](https://vite.dev) 8, [React](https://react.dev) 19 and [TypeScript](https://www.typescriptlang.org) 7 (strict)
- [three.js](https://threejs.org) r187 for rendering, with hand-written GLSL shaders
- [Tailwind CSS](https://tailwindcss.com) 4 for styling
- [Vitest](https://vitest.dev) 5 with jsdom and Testing Library for tests
- [oxlint](https://oxc.rs) for linting and [Prettier](https://prettier.io) (with the Tailwind plugin) for formatting

## Getting started

Requires Node.js 26 or newer.

```sh
npm install
npm run dev        # dev server on http://localhost:12345 (also reachable from the LAN)
npm run build      # type-check, then production build into dist/
npm run preview    # serve dist/
```

The production build uses relative URLs (`base: "./"`), so `dist/` can be served from any path.

### Scripts

| Script                 | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `npm run dev`          | Vite dev server (port 12345, browser console forwarded) |
| `npm run build`        | `tsc -b` and `vite build`                               |
| `npm run preview`      | Serve the production build                              |
| `npm test`             | Run all tests once                                      |
| `npm run test:watch`   | Tests in watch mode                                     |
| `npm run coverage`     | Tests with a V8 coverage report (`coverage/`)           |
| `npm run typecheck`    | `tsc -b` for app, tests and config files                |
| `npm run lint`         | oxlint                                                  |
| `npm run format`       | Prettier (also sorts Tailwind classes)                  |
| `npm run format:check` | Prettier in check mode                                  |

In development, `vite-console-forward-plugin` forwards the browser console to the dev server terminal. The
plugin declares an older Vite as its peer dependency but works with Vite 8, so `package.json` overrides that
peer requirement.

The link preview tags in `index.html` (`og:url`, `og:image`) point at `https://example.com/` as a placeholder.
Replace it with the real address when deploying. Preview images must be absolute URLs, and `og.png` is served
from the site root.

## Controls

- Tap or click the stockings to splash; press and drag to pour.
- The dock switches between splash mode and view mode (drag to orbit, pinch or wheel to zoom, tap to zoom in).
- Keyboard: `Space` bucket of water, `1`-`7` poses, `R` rain, `S` slow motion, `D` dry off, `P` photo,
  `V` toggle mode, `C` scenes, `W` wardrobe, arrow keys orbit, `+`/`-` zoom, `0`/`Home` reset view,
  `Esc` close panels.
- The camera only moves when you move it; it does not orbit on its own when idle.
- A leg turns see-through while the camera is inside it or within 5 cm of its surface, so close-ups never
  clip into it. It shows again once the camera is more than 7 cm away.
- The copy-link button copies a link to the page the app is running on, of the form
  `#look=1~<pose>~<scene>~<backdrop>~<leg0>~<leg1>~<view>`. The view is the camera as
  `yaw,pitch,dist,targetX,targetY,targetZ`. It is optional, so older links without it still load and keep the
  current camera. Each leg is `length.cuff.garter.material.denier.pattern.color.secret.wetColor`, followed by
  `.0` when its toe is not reinforced. Opening a link applies the look and moves the camera. This also works when pasting a link into a tab that is already open, even the same link the tab already shows.

## Project structure

```
index.html              page shell and meta tags
public/                 files copied as-is (og.png, robots.txt)
src/
  main.tsx              React entry
  App.tsx               page layout
  components/           React UI (dock, corner buttons, dialogs, sheets)
  state/                tiny observable store shared by the engine and React
  i18n/                 locales, browser language detection and the message tables (messages/zh-CN.ts, en-US.ts)
  styles/               Tailwind setup, theme and base styles; the @font-face for the logo font
  assets/               leg model (glTF binary) and the logo font subset
  engine/               everything that is not React
    app/                controller: startup, camera, input, layout, frame loop, photo, share, actions
    model/              model loading (glb.ts), leg sculpting and the forefoot with its toes
    geometry/           welding, smooth subdivision, adaptive index, slicing into rings, Catmull-Clark subdivision
    rig/                joints, CPU skinning, pose catalog, LegRig
    catalog/            garments, colors, presets, resolving a leg spec to shader parameters
    surface/            spatial grid for closest-point and raycast queries on the deformed legs
    stage/              scenes, procedural textures, shaders and createStage()
    water/              wet map (GPU simulation in UV space) and the droplet simulation
    audio/              synthesized sound (WebAudio)
    share/              share-link encoding
tools/
  fit_toes.py           writes the forefoot, the toenails and the stocking's fit over the toes into the model
tests/
  engine/               unit tests for engine modules (node environment)
  ui/                   React component tests and app integration tests (jsdom)
  helpers/              fakes (renderer, 2D canvas, AudioContext), GLSL tooling, fixtures
```

## Architecture

**Engine and UI.** The engine renders into the `<canvas id="view">` and owns all simulation state. React renders
the controls. The two meet in two places:

- `src/state/ui.ts` is a small store (`createStore` + `useStore`, built on `useSyncExternalStore`). The engine
  writes view state into it (touch mode, hint, open panels, toggles, photo, wardrobe and scene selection) and
  components render from it.
- `src/engine/app/actions.ts` is what components call. Actions are no-ops until the engine has booted and bound
  the UI.

`Viewport` calls `startApp()` once after the first commit. `startApp` creates the renderer and the runtime object
(`src/engine/app/runtime.ts`), then `boot()` loads the model and builds the stage, rig, wet map and water
simulation, binds input and starts the frame loop. Layout state is kept as classes on `<body>`
(`ready`, `wide`, `roomy`, `short`, `fine`, `view-mode`, `mat-open`, `scene-open`, `about-open`, `photo-open`,
`dim`, ...), because the engine measures the layout right after changing it.

**Rendering.** `createStage()` builds the scene: a depth prepass plus an equal-depth color pass for the legs,
a mirrored floor reflection, baked floor and contact shadows, leg-on-leg shadow maps, a ray-traced backdrop per
scene and a final composite. Legs are skinned in the vertex shader (`LEG_SKINNING_GLSL`); the same skinning runs
on the CPU (`rig/skinning.ts`) for picking, floor contact and droplets.

**Cuff.** A stocking's cuff presses into the leg: `pressCuff` (`CUFF_PRESS_GLSL` in `stage/shaders/leg.ts`, scaled
by `uCuffBulge`) pushes the surface out just above the cuff's edge and draws it in below. The leg's vertex shader
and the outline's both use it, so the line follows the pressed shape. Every length with a cuff gets this. Tights
have no cuff, so `setStocking` turns it off for them and the thigh keeps its own shape.

The press happens within a few millimeters, and the leg's triangles are up to a centimeter across there, so the
model also builds the stocking's mesh once per cuff height with rings of vertices around it
(`LegModel.stockingAtCuff`, `geometry/slice.ts`): every millimeter over the bulge and every half millimeter at the
cuff's edge (`CUFF_RING_OFFSETS`). The rings only cut the triangles that were there, so the surface itself does not
move. These meshes share one set of vertices, and `setStocking` picks the one for the leg's cuff for the stocking's
passes and its outline. Tights and bare legs draw the plain mesh, as do the floor's reflection and the shadows.

The bow of the bow cuff is tied on 16 mm below the cuff's edge, where the cuff draws the fabric in.
`computeBowMatrix` (`stage/bow.ts`) places it on the leg's own surface, seated so that its lowest parts (the loops'
edges, the tails' ends) are level with the fabric (`BOW_SEAT`), and the bow's vertex shader then moves it in and out
with the fabric by the same `cuffProfile`. So it rests on the stocking instead of hovering over it.

The cuff's band is a denser knit than the stocking below it. Across the band's lower edge the fragment shader
blends from the band's density to the stocking's, so the two join without a bright or dark line between them.

**Water.** `WetMap` runs a ping-pong simulation in the stocking's UV atlas (soaked water, running film, fresh-hit
highlight). `WaterSim` simulates thrown, spray, drip and rain drops, beads that cling and slide on the surface,
and a puddle grid with ripples on the floor.

**Model.** `src/assets/model/legs.glb` is a standard glTF 2.0 binary with three meshes, `stocking`, `skinTop` and
`forefoot`. The stocking's per-vertex fit data (`wrapOffsets`) belongs to the twice-subdivided mesh, so it is
stored as an extra Int16 VEC4 accessor referenced from `meshes[0].extras.wrapOffsets` (with its unit and layout
described there). `model/glb.ts` reads exactly what the app needs; any glTF viewer opens the file, showing the
unfitted base mesh.

**Toes.** The stocking mesh is one closed shape stretched over the toes, so the skin under it is a mesh of its
own: `forefoot` is the front of the foot with five separate toes, stored as a quad control cage that the app
subdivides (Catmull-Clark, `geometry/catmullClark.ts`, `model/forefoot.ts`). Its extras hold the toenails as frames
on the skin, which the leg shader draws as raised plates.

- On a bare leg the forefoot stands in for the front of the stocking mesh. Both are cut at the same plane in the
  shaders (`forefootClipGlsl`), and behind the cut the forefoot lies exactly on the stocking mesh, so they meet
  without a seam.
- Under a stocking the forefoot is drawn first and the fabric over it lets it show through by its sheerness, so
  the toes are seen through the fabric with real depth.
- The fabric is fitted to the skin, not the skin to the fabric, so the foot has the same shape with and without
  a stocking. `tools/fit_toes.py` first smooths the foot between the ankle and the toes, in the stocking's own
  shape and in the MakeHuman skin: it takes out lumps of up to a centimeter and fills the dents that ran along
  the top of the foot and between the balls (each slice across the foot is filled out to its convex outline),
  which read as grooves on a smoothly shaded foot. It also takes the small ridges out of the sole's edge and
  fills the dip in the inner side of the foot behind the ball of the big toe. All of that stops short of the
  clefts between the toes,
  which the tool finds on the skin, and fades out slowly on the way there, so nothing bulges behind them. The
  skin's top lies just inside the stocking at the join (the stocking was made for a slightly fuller foot) and
  leaves it gradually toward the clefts. A test measures what is left of the dents on the built model.
- Then the tool fits the stocking around the toes as a membrane pulled taut over the skin, 0.15 mm off it: the
  fabric lies on the skin where the foot is rounded out (the toes' tops, tips and pads, the balls, the top of
  the foot) and spans its hollows (the clefts between the toes, the creases under them, the dents along a toe).
  The stitches keep their lay while it draws in, so patterns are not bunched up. The fabric goes over from its
  old shape to the fitted one across the same band as the skin does at the join, so the two stay together.
- In the app the skin under a stocking only moves where the fabric would otherwise touch it, to 0.1 mm under
  the fabric's surface (`fitUnderStocking` in `model/forefoot.ts`, the `under` vertex attribute), so it never
  comes through.
- What shows through the fabric over the toes is drawn before it: the stocking behind the forefoot's join, then
  the skin, then the stocking in front of the join (`showForefoot` in `stage/createStage.ts`). So the rest of
  the leg is seen between the toes too. Only the nearest surface of that front part is drawn, so the skin is
  first drawn wearing the fabric that lies on it (which is what is seen through another part of the fabric),
  and once more bare where it is right under the nearest fabric, which then covers it.
- Nearly opaque fabric, and a leg that fades out for a close-up, go back to a single surface, so only the
  nearest surface is drawn.
- Hosiery has a reinforced toe by default: a denser knit over the toes, closed by a seam along their tips. The
  wardrobe's "Toe" row turns both off together; thick fabrics and fishnets never have them.
- The back seam pattern comes with a pointed reinforced heel: the patch wraps the heel from the sole up to a point
  on the Achilles tendon, and the seam runs down through it to its edge under the heel. Only nylon has them: on
  velvet, cotton and latex the pattern is greyed out in the wardrobe and not drawn.
- Picking and water follow the same switch: a bare leg collides with the forefoot's skin (a coarser build of it,
  `LegRig.setBare`), so beads sit on the toes and run between them, while a stocking keeps its own shape. The
  skin borrows the stocking's UVs for the wet map, with the stocking's UV seams carried over.
  When a leg changes between the two, its beads are put back on the new surface (`WaterSim.reseat`): one that
  sat on the fabric over the gap between two toes falls, and one left under the fabric soaks into it.

`tools/fit_toes.py` (Python with numpy and scipy) writes all of this into the model file from the MakeHuman base
mesh, which the leg came from: it places the MakeHuman foot on the model, stores its forefoot and the nails, and
refits the stocking over the toes.

```sh
curl -LO https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/3dobjs/base.obj
python3 tools/fit_toes.py base.obj
```

The forefoot and the nails are rewritten on every run. The stocking is refitted once (the file records that), since
the fit starts from the stocking as it is; to redo it, start from the model as it was before.

**Debugging.** In development builds (`import.meta.env.DEV`), `window.__app` exposes the runtime, and
`window.__advance(seconds)` steps the simulation deterministically.

## Languages

All UI text lives in `src/i18n/messages/`, one table per locale. `zh-CN.ts` is the reference: its keys define
`MessageKey`, and every other table must have exactly the same keys (the type checker enforces this, and a test
checks that the `{name}` placeholders match). Catalog entries (poses, lengths, colors, scenes, presets, ...) have no
labels of their own; their names are messages keyed by catalog key, such as `color.ink` or `preset.classicBlack`.

- Components translate with `const t = useT()` and re-render when the locale changes.
- Engine code never translates. It stores message keys in the UI store (the hint, the rain button label, the photo
  tip) and components translate them while rendering, so text already on screen follows a language switch.
- At startup `main.tsx` picks the first of `navigator.languages` that matches a supported language (any `zh-*` gets
  `zh-CN`, any `en-*` gets `en-US`) and falls back to `en-US`. The choice is not stored anywhere.
- `<html lang>` follows the current locale, and the `en:` variant (`:lang(en)`) gives English labels more room where
  needed.
- The page metadata in `index.html` cannot be translated, so the description has English first, then Chinese.

To add a locale, add its table under `messages/`, register it in `LOCALES` (`src/i18n/locales.ts`) and in `MESSAGES`
(`src/i18n/index.ts`).

Text uses ASCII punctuation wherever an ASCII equivalent exists: straight quotes, `-`, `...`, and `,` `:` `;` `(` `)`
instead of their full-width forms, in Chinese too. Characters without one, such as `·`, `。`, `、` and `「」`, are fine. A
test scans every text file in the repository for the rest.

## Styling

Tailwind is imported without its preflight (`tailwindcss/theme.css` and `tailwindcss/utilities.css` only), so
the page keeps its own small base layer in `src/styles/app.css`. That file also defines:

- custom variants for the `<body>` state classes, e.g. `wide:`, `roomy:`, `short:` (wide and short),
  `view-mode:`, `mat-open:`, `fine-wide:`, `dim:`, plus `hidden-attr:` for elements with the `hidden` attribute;
- theme tokens: colors (`ink`, `glass`, `chip`, `accent`, ...), `shadow-panel`, the `font-ui` and `font-logo`
  families and the loading spinner animation.

Everything else is utility classes in the components. Class names must appear literally in the source for
Tailwind to find them, so conditional styles pick between complete class strings.

Production CSS is optimized by Tailwind (nesting flattened, syntax lowered for the supported browsers) and then
minified by Vite, both with Lightning CSS. Tailwind's pass rewrites colors such as `rgba(..., 0.55)` into 8-digit
hex, which rounds the alpha to 1/255. The Vite pass therefore includes the `HexAlphaColors` feature
(`css.lightningcss` in `vite.config.ts`), which prints every color with an alpha as `rgba()` using the shortest
alpha that maps to the same byte. Alphas with up to two decimals come out exactly as written; hex sources such as
`#ffffff38` come out as the equivalent `rgba(255,255,255,.22)`.

## Testing

```sh
npm test
npm run coverage
```

Tests run in Node without a browser or GPU and take a few seconds. Vitest has two projects: `engine`
(node environment) and `ui` (jsdom). Notable techniques:

- A fake `WebGLRenderer` records render passes, so `createStage`, `WetMap` and `WaterSim` run end to end on the
  real leg model.
- Every shader program the app draws is parsed as GLSL ES 3.00 (with an equivalent of three.js's prefix), and
  its uniforms, varyings and attributes are checked against the material and geometry that use it.
- Deterministic algorithms (subdivision, sculpting, skinning, water simulation with a seeded `Math.random`) are
  pinned with golden digests, so changes in numeric output are caught.
- Fake 2D canvas and `AudioContext` implementations cover textures, the photo watermark and sound.
- A repository-wide check rejects typographic punctuation that has an ASCII equivalent (see Languages).
- The app controller is booted in jsdom with these fakes, and driven through the React UI, keyboard and pointer
  events.

### Render check

`npm run render:check` builds the app, serves `dist/` with `vite preview`, opens it in headless Chromium
(Playwright) and saves `render-check/render.png` plus a `render.json` report. The report has the WebGL renderer
string of the app's own context, Chromium's GPU feature status, the frame rate and frame times (mean, median, 95th
percentile, max), `nvidia-smi` samples (when available), pixel statistics and any console errors. The check fails if the app does not boot, the screenshot is
blank, or WebGL ran on a software renderer (SwiftShader, llvmpipe, ...).

```sh
npx playwright install --with-deps chromium   # once per machine
npm run render:check -- --size 1920x1080 --hash '#look=1~...'
```

Options: `--url` (render an existing page instead), `--no-build`, `--hash`, `--size WxH`, `--dpr`, `--locale <tag>` (the browser language, default `en-US`),
`--click <selector>` (repeatable, clicked in order once the page is ready; `wait:<ms>` in place of a selector pauses
before the next click), `--pour <x>,<y>` (holds the pointer down at that point of the viewport, which pours water
there, while settling and for the screenshot), `--release <ms>` (with `--pour`: lets go and keeps rendering that
long before the screenshot), `--settle <ms>`, `--perf`, `--dev`, `--angle vulkan|gl-egl|swiftshader` (default
`vulkan`), `--out <file.png>` and
`--allow-software`. It needs a machine with a GPU. Without one, it fails unless you pass `--allow-software`, and
software rendering is slow (about 9 s to boot and 2-3 fps).

Frame rates are capped by vsync unless you pass `--perf`. That turns the cap off and also reports `gpuMs`: how long
the GPU takes to finish each frame, measured by reading a pixel back right after the app has drawn. On a fast GPU
a frame at the app's normal resolution costs too little to compare this way, so to see what a shader change costs,
add `--dev`: it serves the development build, in which `--dpr` sets the render scale directly (past the app's pixel
budget), and reports `benchMs`, the time per frame when rendering frames back to back at that scale. Run the same
look before and after:

```sh
npm run render:check -- --dev --perf --size 2560x1440 --dpr 3 --hash '#look=1~...'
```

## Credits

- Leg and forefoot meshes: [MakeHuman](http://www.makehumancommunity.org) base mesh (CC0)
- Stocking mesh: adapted from "French lingerie stockings" by punkduck
  ([CC BY 3.0](https://creativecommons.org/licenses/by/3.0/))
- [three.js](https://threejs.org) (MIT)
- Logo font: ZCOOL XiaoWei (subset with the two logo characters)

## License

The code is released under the [MIT License](LICENSE). Third-party assets bundled with it (see Credits) keep their
own licenses.
