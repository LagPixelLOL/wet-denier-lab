# Developing Wet Denier Lab

What the app is and how to use it is in [README.md](README.md). This file is for working on it: the stack, the
scripts, where things are, how the engine works and why, the conventions for text and styles, and the tests.

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

**Lost WebGL context.** A browser can take the WebGL context away and give it back (the GPU process restarted, the
driver was reset, a phone reclaimed memory; a headless Chromium that has only just started does it once while the
production build boots). three.js rebuilds its programs, buffers and textures by itself, but whatever was drawn once
into a texture is gone. While the context is lost the frame loop steps nothing, and when it is back `restoreContext`
(`app/loop.ts`) draws those things again: the wet map's baked position and flow maps (without them no water marks
the legs), the stage's shadows, the thumbnails. The water the legs had soaked up is lost; drops stay.

**Rendering.** `createStage()` builds the scene: a depth prepass plus an equal-depth color pass for the legs,
a mirrored floor reflection, baked floor and contact shadows, leg-on-leg shadow maps, a ray-traced backdrop per
scene and a final composite. Legs are skinned in the vertex shader (`LEG_SKINNING_GLSL`); the same skinning runs
on the CPU (`rig/skinning.ts`) for picking, floor contact and droplets.

**Seen through.** A leg's top fades out (from `fade0` to `fade1` of `LegLook`, along the slanted height of
`FADE_HEIGHT_GLSL`), and the leg is open there: the eye looks through the fading top, and from above into the leg.
The stocking's mesh is the whole leg (above the cuff its passes draw the skin), and `addSeenThrough` in
`stage/createStage.ts` splits its surface by what the eye sees it through:

- _Solid_ is the leg's outside below where the fade begins. Only this lays down depth while the legs are drawn,
  so whatever lies behind the rest of a leg (the backdrop, the floor, the other leg) is drawn and shows through.
- _The fading top_ (its outside) comes after both legs, as color alone, the leg behind first (`setOrder`).
- _The inside_ of a leg is all but invisible (8% from the ankle up, gone by where the top begins to fade). It also
  comes after both legs, in one pass that lays down its depth as it goes, from the top of the leg down: looking
  into a leg, the nearer of two walls behind each other is the higher one, so the farther one finds its depth there
  and is left out. One wall shows, not their sum.
- _A leg's own solid outside seen through that same leg_ shows as much as what it is seen through has faded out:
  all of it through the top where nothing of that is left, nothing through the leg's inside or where the fade
  begins, and in between by the fade (through several, by the least). So the solid leg under a top that flares goes
  over into the fade without a step. That is from the ankle up. The foot is always drawn, and across a band above
  the ankle (`ANKLE`, `ANKLE_BAND`) the one goes over into the other. The other leg seen through a leg is drawn.

Two tests tell what is seen through the leg's own top. The lid (`LID_GLSL` in `stage/shaders/leg.ts`) closes the
top with the plane where the fade begins, as far out as the leg's outline there (`legLid` in `stage/lid.ts`, in 32
directions around its middle), and asks whether the line of sight to a point passes through it, in the leg's own
space at rest (`uRestFromWorld`). What does is seen through the leg's inside and is not drawn. That needs no depth,
so what it leaves out hides nothing. Right under the lid it stops 3% short of the outline (`LID_REACH`,
`LID_NEAR`), where a line of sight to the leg's own wall passes the rim by next to nothing.

The curtain covers what the lid cannot tell (what is seen through the top's side, under its rim where it flares,
and right along the rim). It is everything of the leg's top that is not solid: the fading top, and the inside up
there (`CURTAIN`). The stage's target has a stencil buffer (`createSceneTarget` in `stage/target.ts`; it is not
resolved out of the samples, which costs milliseconds), and each leg has three bits of it (the third is for the
line around its top, below). While a leg is drawn, the curtain sets the first where it lies in front of the solid
leg's depth, and the solid leg's color is not drawn there. Where such a pixel's depth is the solid leg's own, the
second bit is set (`gone`) and the depth is taken out (`erase`, drawn at the far end of the depth range), so that
whatever lies behind is drawn. After everything else of the legs, what is gone comes back by how much of it shows:
its depth again, where the second bit is set, with the target's alpha set to one; then the curtain in front of that
depth, which takes the alpha down to how far each part of it has faded out (`VEIL`, the least of them stays); then
its color at that depth, weighed by the alpha. The leg from the ankle down is drawn in a pass of its own, before
the curtain.

Most of the time none of this is needed, and it is left out (`lookInto` in `stage/createStage.ts`, before every
render of the scene). Nothing of a leg is seen through its top, nor is its inside seen, unless the eye looks down
into the leg, from above the plane where the fade begins and steeply enough (`INTO_FROM`): until then only the
solid leg (depth, then color in one pass), the fading top and the line are drawn, and past that angle the inside
comes in gradually (`uInto`). And while the eye does look into a leg, the curtain mostly finds nothing: the pass
that sets the second bit is watched with an occlusion query (`stage/drawn.ts`), and as long as it sets none, the
passes that deal with what is gone are left out too, and the question is asked only every 30 ms (`ASK_EVERY`). The
GPU answers a frame or two late: that is how long a part that comes to be seen through the leg's top is drawn as it
is before it fades.

The line around a stocking (`addOutline`) belongs to what it goes around, so it shows through a fading top like the
rest of the leg behind it, its own leg's or the other's. Around the solid leg (`SOLID_LINE`) it is drawn right
after both solid legs and before anything that is seen through: it lays down its depth, and the tops' color goes
over it. Around the leg's top (`TOP_LINE`, from 5 cm below where the fade begins, which is as far down as the lid
leaves anything to tell) the top itself has to hide what of the line lies behind it. For the leg in front that is
the top's depth, laid down after everything else (the water in the air is drawn against it too), a little nearer
(`SEEN_THROUGH_PULL`), and the line after it. The top of the leg behind marks where it lies in a third bit of the
stencil buffer instead, and its line is drawn where that is not set, before the color of the top in front: no top's
depth may be there yet for what is still to be seen through it. Either way there is no line on the far side of a
leg seen from above. The line's place in the world is pushed out with its place on the screen, so the lid tells
what it is seen through for the pixel it is drawn at.

The floor's reflection draws the whole leg and its fading top without any of this (the eye is not where the camera
is). The shadow a leg casts on the other fades out with its top too: the shadow map holds how solid the leg is in
the light's way next to its depth (`CASTER_COVER_FRAGMENT_SHADER`, the most solid of the leg's walls the light
passes through), and the other leg's shader takes the two together (`castShadowAt`). A top that is not there casts
none.

**Cuff.** A stocking's cuff presses into the leg: `pressCuff` (`CUFF_PRESS_GLSL` in `stage/shaders/leg.ts`, scaled
by `uCuffBulge`) pushes the surface out just above the cuff's edge and draws it in below. How much goes by how soft
the leg is where the cuff sits (`legSoftness` in `model/cuffPress.ts`, which `resolveLegLook` turns into the look's
`cuffPress`): all of it at the thigh, half on the calf (crew socks), three quarters of that under the knee
(knee-highs), and a tenth, next to nothing, at the ankle and on the knee (knee-length socks), where the leg is bone
and sinew. The leg's vertex shader, the outline's and the bow's all read that one uniform, so the line and the bow
follow the pressed shape, and the drops are told the same share (`setLegWater`). Tights have no cuff, so there is
no press for them and the thigh keeps its own shape.

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

Drops go with the press too. They move on the leg's collision surface, which has no press in it, so each is drawn
moved out or in along the surface normal by the same profile (`cuffPressAt` in `model/cuffPress.ts`, whose numbers
the shaders' `cuffProfile` is built from; `WaterSim.shownAt`). Without that, drops on the bulge above the cuff sank
into the skin and the ones below its edge floated. The height they go by is the surface's height on the leg at rest
(`SurfaceHit.height`), not `ry`, which is the height along the slant a stocking's top fades out on.

The cuff's band is a denser knit than the stocking below it. Across the band's lower edge the fragment shader
blends from the band's density to the stocking's, so the two join without a bright or dark line between them. The
band is narrower the shorter the stocking (`band` of the length in `catalog/garments.ts`), and the lace cuff, which
is drawn for a thigh-high's band (`LACE_BAND`, 6 cm of lace), is that much smaller all over on a shorter one: its
depth, its scallops and its flowers. On an ankle sock it is 2.7 cm deep.

**Reflections.** Shiny surfaces (wet fabric, latex, water drops) mirror their surroundings as two colors, one
below and one above the horizon (`envLo` and `envHi` of the scene's light and of its water), plus the street's two
neon signs. In the studio the surroundings are the backdrop: `studioEnv` (`stage/scenes.ts`) scales those colors by
how the chosen backdrop's bottom and top compare with the lilac one's, which the studio's values are given for. So
latex in front of the dusk backdrop mirrors a dark room, and in front of a pink one a pink room; the other scenes
keep their own colors. The studio's rim light, which lights the legs' edges from behind, is what the backdrop
throws onto them, so it dims and takes color the same way (`studioRimTint`). A film of water mirrors the room in full. A shiny material itself is finely rough and mirrors
it at about half that (`SHINE_ENV` in `stage/shaders/leg.ts`), and takes dimmer highlights from the lamps
(`SHINE_KEY`).

The lamp follows the camera and lights the side of the legs that faces it. The rest of a leg is lit by the room
alone (`uRoomLight`, `roomLight` in `stage/shaders/leg.ts`, which the leg, the bow and the line around the leg all
use). In the lilac studio, the bath and the pool that is all of the light there ever was on that side, so nothing
changes there. In front of a darker backdrop it is less (`studioRoomLight` in `stage/scenes.ts`: by how light the
backdrop looks, not by the light it gives off in numbers, and never less than `ROOM_LIGHT_MIN`, a fifth, so that a
leg in a black room is dark on its far side and still to be seen), and the street at night has a dim room of its
own (`room` of the scene's light). The one goes over into the other softly, most of the way round the leg.

In such a room the shadow one leg casts on the other is dark, and its edge would show as hard as the shadow map has
it. So there it is read from the map's color instead, which holds how solid the leg is, that it is there, and how
near the light (`CASTER_COVER_FRAGMENT_SHADER`), at one of the map's smaller, blurred levels (`SOFT_SHADOW_LEVEL`),
smoothly (`castCoverSmooth`: a cubic curve through the texels, as straight pieces between them showed as steps
along the edge), for a point that lies behind the other leg (`SOFT_SHADOW_BEHIND`). In a light room the shadow is
as it was. In any room, the lamp's highlights are the lamp's own mirror image, and where the other leg stands in
the lamp's way there are none: the bright patch on latex and on a wet film, the streak and the glints along glossy
nylon and the sparkles all go out with the lamp's light, as softly as the shadow comes on. What such a surface
mirrors of the room stays.

How much a fabric shines by itself is set per material in `catalog/garments.ts` (`gloss` for the long highlight,
`sheen` and `sheenPow` for the soft glow toward its edges, `shine` for latex). Cotton and velvet are the matte ones,
velvet only a little less so than cotton. Latex has no sheen: it is smooth rubber, and what it shows is what it
mirrors.

Cotton is knit in ribs (`rib` of the material; a ribbed cuff has them on any material), and what shows them goes by
how light the yarn is. Between two ribs the knit is thin and the skin shows: through dark yarn only between its
stitches, through light yarn also through the yarn itself (`RIB_THROUGH` in `stage/shaders/leg.ts`, by how much
light the dye throws back), however little the knit is stretched. The ribs also shade the fabric between them, and
so do the stitches of a fuzzy fabric's thick yarn (`STITCH_SHADE`, by how light the yarn is to the eye: dark yarn
shows its stitches in its sheen alone). A light fabric lights its own folds again with the light it throws back, so
they shade it far less than a dark one (`foldLit`): white cotton has faint skin-colored lines between its ribs, not
grey stripes.

Water makes a mirroring film only on a smooth surface: nylon, latex, skin. A fuzzy fabric (cotton, velvet) takes it
into its pile and stays rough. Wet, it turns darker and loses its sheen, and of a film's shine it keeps only a trace
(`FUZZ_WET_SHINE`), as a soft glow where it faces the lamp: no mirror-sharp highlight, no bright streak along the leg,
no glitter, and no bright line around the wet patch (that line is the edge of the water on a smooth yarn). Both take
drops in readily, velvet nearly as readily as cotton (`water` in `catalog/garments.ts`), so few drops stay on them
and not for long; the ones that do shine as drops do. Latex mirrors as it is, and water on it adds nothing to that:
no brighter patch where the water lies and no white flash where it has just hit, only the drops. The patch and the
flash are for nylon (the glossy one too) and skin. Latex takes no water in either: what another fabric, or the bare
leg, soaked up before the latex went on stays in the wet map (for the skin above the stocking, and for when that
fabric is back) but does not show on the latex, neither as a wet patch nor as a line around one.

How a surface takes water (how fast it soaks in and spreads, how many drops stay on it and how they slide) goes by
what is there, not by the leg: the fabric's way where the stocking is, and bare skin's (`BARE_SKIN_WATER`) on the
skin above its top, whatever the stocking is made of. The wet map's position texture carries each texel's height on
the leg at rest for that, and a drop carries its own. Around the top the one way goes over into the other across a
narrow band (`SKIN_EDGE` in `water/shaders/wet.ts`) instead of at a line, so a drop running down from the skin is
taken up as it reaches the fabric and a wet patch across the top is not cut off along it.

Drying (the Dry button) raises the wet map's dry rate for a moment. That takes the soaked water and the film with it,
and the white flash of freshly hit water too, which otherwise only fades at a fixed pace and piles up under a long
pour (`AIR_DRY_RATE` is the rate when nothing is wiping).

The rim lights and the sheen belong to the leg's outline. They go by how far the surface is turned away from the eye
around the leg (`outline` in the leg's fragment shader), not by its angle to the line of sight: looking down or up
along a leg, all of its surface is seen at a glancing angle, and by that angle they would cover the whole leg instead
of its edges. Seen from the side the two measures are the same. The mirror reflection and the fabric's sheerness do
go by the true angle, since a shiny surface does reflect more, and a fabric is denser, seen along it.

A custom backdrop is built from the one color picked (`makeCustomBackdrop`): the wall's bottom, its top and the
floor are that color lifted toward white, a light color most of the way (a pastel, like the built-in pale
backdrops) and a dark one only a little (like dusk), so a dark color gives a dark backdrop and black a black one.

The main light's long highlight runs along the leg as a streak where the surface faces the light: across the leg it
falls to half strength 15 degrees to either side, and only a little of it reaches the rest of the lit side
(`uHighlightFalloff`). That keeps a leg seen right at the angle that mirrors the lamp from washing out, without
touching the scene's light or exposure.

**Water.** `WetMap` runs a ping-pong simulation in the stocking's UV atlas (soaked water, running film, fresh-hit
highlight). `WaterSim` simulates thrown, spray, drip and rain drops, beads that cling and slide on the surface,
and a puddle grid with ripples on the floor.

**Model.** `src/assets/model/legs.glb` is a standard glTF 2.0 binary with three meshes, `stocking`, `skinTop` and
`forefoot`. (The stage does not draw `skinTop`, the bare skin above a stocking as a mesh of its own: the stocking's
mesh is the whole leg.) The stocking's per-vertex fit data (`wrapOffsets`) belongs to the twice-subdivided mesh, so
it is stored as an extra Int16 VEC4 accessor referenced from `meshes[0].extras.wrapOffsets` (with its unit and
layout described there). `model/glb.ts` reads exactly what the app needs; any glTF viewer opens the file, showing
the unfitted base mesh.

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
percentile, max), `nvidia-smi` samples (when available), pixel statistics, how often the WebGL context was lost and
given back (`contextEvents`) and any console errors. The check fails if the app does not boot, the screenshot is
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
