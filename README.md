# Wet Denier Lab

An interactive WebGL toy: tap the stockings to splash water. Splashes burst, wet fabric turns see-through,
beads cling, slide and drip onto the floor. You can switch scenes (studio, bath, street, pool), poses and
outfits (length, cuff, material, denier, color, pattern, hidden decals), take photos and share a link that
restores the exact look.

The UI text is Chinese (zh-CN).

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
  current camera. Opening a link applies the look and moves the camera. This also works when pasting a link into a tab that is already open, even the same link the tab already shows.

## Project structure

```
index.html              page shell and meta tags
public/                 files copied as-is (og.png, robots.txt)
src/
  main.tsx              React entry
  App.tsx               page layout
  components/           React UI (dock, corner buttons, dialogs, sheets)
  state/                tiny observable store shared by the engine and React
  styles/               Tailwind setup, theme and base styles; the @font-face for the logo font
  assets/               leg model (glTF binary) and the logo font subset
  engine/               everything that is not React
    app/                controller: startup, camera, input, layout, frame loop, photo, share, actions
    model/              model loading (glb.ts) and leg sculpting
    geometry/           welding, smooth subdivision, adaptive index
    rig/                joints, CPU skinning, pose catalog, LegRig
    catalog/            garments, colors, presets, resolving a leg spec to shader parameters
    surface/            spatial grid for closest-point and raycast queries on the deformed legs
    stage/              scenes, procedural textures, shaders and createStage()
    water/              wet map (GPU simulation in UV space) and the droplet simulation
    audio/              synthesized sound (WebAudio)
    share/              share-link encoding
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

**Water.** `WetMap` runs a ping-pong simulation in the stocking's UV atlas (soaked water, running film, fresh-hit
highlight). `WaterSim` simulates thrown, spray, drip and rain drops, beads that cling and slide on the surface,
and a puddle grid with ripples on the floor.

**Model.** `src/assets/model/legs.glb` is a standard glTF 2.0 binary with two meshes, `stocking` and `skinTop`.
The stocking's per-vertex fit data (`wrapOffsets`) belongs to the twice-subdivided mesh, so it is stored as an
extra Int16 VEC4 accessor referenced from `meshes[0].extras.wrapOffsets` (with its unit and layout described
there). `model/glb.ts` reads exactly what the app needs; any glTF viewer opens the file, showing the unfitted
base mesh.

**Debugging.** In development builds (`import.meta.env.DEV`), `window.__app` exposes the runtime, and
`window.__advance(seconds)` steps the simulation deterministically.

## Styling

Tailwind is imported without its preflight (`tailwindcss/theme.css` and `tailwindcss/utilities.css` only), so
the page keeps its own small base layer in `src/styles/app.css`. That file also defines:

- custom variants for the `<body>` state classes, e.g. `wide:`, `roomy:`, `short:` (wide and short),
  `view-mode:`, `mat-open:`, `fine-wide:`, `dim:`, plus `hidden-attr:` for elements with the `hidden` attribute;
- theme tokens: colors (`ink`, `glass`, `chip`, `accent`, ...), `shadow-panel`, the `font-ui` and `font-logo`
  families and the loading spinner animation.

Everything else is utility classes in the components. Class names must appear literally in the source for
Tailwind to find them, so conditional styles pick between complete class strings. CSS optimization is turned
off (`optimize: false` for Tailwind, `cssMinify: false` for Vite), because the optimizer rewrites colors such as
`rgba(..., 0.55)` into 8-digit hex with a slightly different alpha.

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
- The app controller is booted in jsdom with these fakes, and driven through the React UI, keyboard and pointer
  events.

## Credits

- Leg mesh: [MakeHuman](http://www.makehumancommunity.org) (CC0)
- Stocking mesh: adapted from "French lingerie stockings" by punkduck
  ([CC BY 3.0](https://creativecommons.org/licenses/by/3.0/))
- [three.js](https://threejs.org) (MIT)
- Logo font: ZCOOL XiaoWei (subset with the two logo characters)

## License

No license has been chosen yet.
