import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { STOCKING_LENGTH_ORDER } from "../../../src/engine/catalog/garments";
import { DEFAULT_LEG_SPEC, PRESETS } from "../../../src/engine/catalog/presets";
import type { LegSpec } from "../../../src/engine/catalog/presets";
import { resolveLegLook } from "../../../src/engine/catalog/resolveLegLook";
import type { LegLook } from "../../../src/engine/catalog/resolveLegLook";
import { LegRig } from "../../../src/engine/rig/LegRig";
import { computeBowMatrix } from "../../../src/engine/stage/bow";
import type { Stage, StageLeg } from "../../../src/engine/stage/createStage";
import {
  BACKDROPS,
  BACKDROP_ORDER,
  SCENES,
  SCENE_ORDER,
  makeCustomBackdrop,
  studioEnv,
  studioRimTint,
} from "../../../src/engine/stage/scenes";
import { BOW_VERTEX_SHADER } from "../../../src/engine/stage/shaders/bow";
import { CUFF_PRESS, cuffPressAt } from "../../../src/engine/model/cuffPress";
import { CUFF_PRESS_GLSL, LEG_VERTEX_SHADER } from "../../../src/engine/stage/shaders/leg";
import { CASTER_COVER_FRAGMENT_SHADER, CASTER_VERTEX_SHADER } from "../../../src/engine/stage/shaders/post";
import { OUTLINE_VERTEX_SHADER } from "../../../src/engine/stage/shaders/outline";
import { digestRounded } from "../../helpers/digest";
import { describeCalls } from "../../helpers/fakeRenderer";
import { legModel } from "../../helpers/model";
import { buildStage } from "../../helpers/stageFixture";

const hex = (color: THREE.Color) => "#" + color.getHexString();
const vec = (v: THREE.Vector2 | THREE.Vector3 | THREE.Vector4) => v.toArray();
const camera = () => {
  const cam = new THREE.PerspectiveCamera(30, 1, 0.02, 12);
  cam.position.set(0, 0.5, 1.6);
  cam.lookAt(0, 0.4, 0);
  cam.updateMatrixWorld();
  return cam;
};

/** Names for the stage's render targets and scenes, for readable call logs. */
function namesFor(stage: Stage): Map<object, string> {
  const names = new Map<object, string>();
  const floor = stage.uniforms.floor;
  names.set(floor.uFloorShadow.value.renderTarget!, "floorShadowRT");
  names.set(floor.uContactShadow.value.renderTarget!, "contactRT");
  names.set(floor.uMirror.value.renderTarget!, "mirrorRT");
  stage.legs.forEach((leg, i) => {
    // each leg samples the other leg's caster map
    names.set(leg.fabric.uCastShadowMap.value!.renderTarget!, `castRT${1 - i}`);
    names.set(leg.castScene, `castScene${i}`);
  });
  names.set(stage.legs[0].mirror.parent!, "mirrorScene");
  names.set(stage.shadowScene, "shadowScene");
  names.set(stage.scene, "mainScene");
  return names;
}

const backdropMaterial = (stage: Stage) =>
  (stage.scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material;

function expectLookApplied(leg: StageLeg, look: LegLook, { initial = false } = {}): void {
  const f = leg.fabric;
  expect(hex(f.uDye.value)).toBe(look.dye);
  expect(hex(f.uDye2.value)).toBe(look.dye2);
  expect(hex(f.uSheenColor.value)).toBe(look.sheen);
  expect(hex(leg.outlineUniforms.uOutlineColor.value)).toBe(look.outline);
  expect(vec(f.uShade.value)).toEqual(look.shade);
  expect(vec(f.uMatWet.value)).toEqual(look.mat);
  expect(vec(f.uMatKnit.value)).toEqual(look.mat2);
  expect({
    stripe: f.uStripe.value,
    through: f.uThrough.value,
    sheenAmt: f.uSheenAmount.value,
    denier: f.uDenier.value,
    pattern: f.uPattern.value,
    gloss: f.uGloss.value,
    cuffY: f.uCuffY.value,
    hasCuff: f.uHasCuff.value,
    cuffBulge: f.uCuffBulge.value,
    cuff: f.uCuffStyle.value,
    band: f.uBand.value,
    garter: f.uGarter.value,
    toe: f.uToe.value,
    print: f.uPrint.value,
    fade0: f.uFadeStart.value,
    fade1: f.uFadeEnd.value,
  }).toEqual({
    stripe: look.stripe,
    through: look.through,
    sheenAmt: look.sheenAmt,
    denier: look.denier,
    pattern: look.pattern,
    gloss: look.gloss,
    cuffY: look.cuffY,
    hasCuff: look.hasCuff,
    cuffBulge: look.hasCuff,
    cuff: look.cuff,
    band: look.band,
    garter: look.garter,
    toe: look.toe,
    print: look.print,
    fade0: look.fade0,
    fade1: look.fade1,
  });
  const secret = new THREE.Color(look.secretColor);
  // createStage starts with an all-zero secret; setStocking fills in the color
  expect(vec(f.uSecret.value)).toEqual(initial ? [0, 0, 0, 0] : [secret.r, secret.g, secret.b, look.secret]);
}

describe("createStage construction", () => {
  const { stage, contexts } = buildStage();

  it("assembles backdrop, floor and two legs with depth, color, outline and bow passes", () => {
    // The backdrop and the floor, then per leg its own group and the five groups drawn after both legs.
    expect(stage.scene.children.map((child) => child.type)).toEqual(["Mesh", "Mesh", ...Array(12).fill("Group")]);
    expect(stage.scene.children[0].renderOrder).toBe(-10);
    expect(stage.floor.renderOrder).toBe(-5);
    expect(stage.floor.geometry.parameters).toMatchObject({ radius: 1.6, segments: 96 });
    for (const leg of stage.legs) {
      // The stocking (behind the forefoot's join first, while the forefoot shows through it) and the passes
      // around it (between its depth and its color the leg from the ankle down and the curtain, after them the
      // two that take out the depth of what the curtain kept from being drawn), the forefoot's skin with its
      // outline, the stocking in front of the join, the passes that find the skin right under the nearest fabric
      // and draw it bare, and the bow. (The line around the stocking comes after both legs.)
      expect(leg.group.children.map((mesh) => mesh.renderOrder)).toEqual([
        -6, -5, -5.9, -5.8, -4.9, -4.8, -4, -3, 2, -1, 1, -2.5, -2, 1.5,
      ]);
      expect(leg.aroundStocking).toEqual(leg.group.children.slice(2, 6));
      // After both legs: the solid leg's depth once more, the fading top, the inside, what of the solid leg is
      // seen through its top (its depth, how much of it shows, its color), and the depth of the leg's top with
      // the line.
      expect(leg.late.map((group) => group.children.map((mesh) => mesh.renderOrder))).toEqual([
        [0],
        [0],
        [0],
        [0, 1, 2],
        [0, 1],
      ]);
      expect(leg.late.every((group) => group.matrix === leg.group.matrix && !group.matrixAutoUpdate)).toBe(true);
      expect(leg.matrix).toBe(leg.group.matrix);
      expect(leg.group.matrixAutoUpdate).toBe(false);
      expect(leg.mirror.children).toHaveLength(7);
      expect(leg.bow.visible).toBe(false);
      expect(leg.castScene.children).toEqual([leg.caster]);
    }
    expect(stage.shadowScene.children).toEqual([stage.legs[0].shadow, stage.legs[1].shadow]);
    expect(stage.legs.map((leg) => leg.group.renderOrder)).toEqual([20, 10]);
  });

  it("draws the stocking passes from the fine mesh and the mirror and shadow from the coarse one", () => {
    const model = legModel();
    const leg = stage.legs[0];
    // The default look has a cuff on the thigh, so the stocking starts on the mesh ringed there.
    expect(leg.stockingParts[0].geometry).toBe(model.stockingAtCuff.get(0.7));
    expect(leg.cuffParts.map((part) => part.geometry)).toEqual(Array(3).fill(leg.stockingParts[0].geometry));
    const lowFront = leg.stockingFrontParts[2].geometry;
    expect(lowFront.attributes.position).toBe(model.stockingLow.attributes.position);
    expect(lowFront.index!.count).toBeLessThan(model.stockingLow.index!.count / 2);
    expect(leg.stockingFrontParts[0].geometry.attributes.position).toBe(model.stocking.attributes.position);
    expect(leg.mirror.children.map((mesh) => (mesh as THREE.Mesh).geometry)).toEqual([
      model.stockingLow,
      model.stockingLow,
      model.forefoot,
      model.forefoot,
      lowFront,
      lowFront,
      model.stockingLow,
    ]);
    expect(leg.shadow.geometry).toBe(model.stockingLow);
    expect(leg.stocking.material.depthFunc).toBe(THREE.EqualDepth);
    // The stocking's mesh is the whole leg, and its passes draw the skin above the cuff: no mesh draws skin alone.
    const drawn = [leg.group, ...leg.late, leg.mirror].flatMap((group) => group.children as StageLeg["stocking"][]);
    expect(drawn.some((mesh) => mesh.geometry === model.skin)).toBe(false);
    expect(
      drawn.every((mesh) => mesh.material.uniforms.uIsSkin === undefined || mesh.material.uniforms.uIsSkin.value === 0),
    ).toBe(true);
  });

  it("gives each leg its own look, rig and wet map slot but shares light and fabric uniforms", () => {
    const [a, b] = stage.legs;
    expect(a.fabric.uMirror.value).toBe(1);
    expect(b.fabric.uMirror.value).toBe(-1);
    expect(vec(a.fabric.uWetMapSlot.value)).toEqual([0.5, 0]);
    expect(vec(b.fabric.uWetMapSlot.value)).toEqual([0.5, 0.5]);
    expect(a.rig).not.toBe(b.rig);
    expect(a.fabric.uCastShadowMatrix).toBe(b.fabric.uCastShadowMatrix);
    expect(a.fabric.uCastShadowMap.value).not.toBe(b.fabric.uCastShadowMap.value);
    expect(a.bowU.uKeyDir).toBe(stage.uniforms.light.uKeyDir);
    expect(a.outlineUniforms.uOpacity).toBe(a.fabric.uOpacity);
    expect(a.outlineUniforms.uLineWidth).toBe(stage.lineWidth);
    expect(stage.lineWidth.value).toBe(1.6);
    expect(a.stocking.material.uniforms.uWetMap).toBe(stage.uniforms.fabric.uWetMap);
    expect(a.stocking.material.uniforms.uIsSkin.value).toBe(0);
  });

  it("gives all but a little of the long highlight to where the leg faces the light", () => {
    // The rest goes to the whole lit side of the leg: with much more than this, a leg at the angle that mirrors
    // the lamp washes out.
    expect(stage.uniforms.fabric.uHighlightFalloff.value).toBe(0.94);
  });

  it("starts with the default leg look", () => {
    const look = resolveLegLook(DEFAULT_LEG_SPEC);
    for (const leg of stage.legs) {
      expectLookApplied(leg, look, { initial: true });
      expect(vec(leg.fabric.uWetDye.value)).toEqual([0, 0, 0, 0]);
      expect(leg.fabric.uCuffBulge.value).toBe(1);
    }
  });

  it("builds the procedural textures and wires the floor render targets", () => {
    expect(contexts.map((ctx) => [ctx.canvas.width, ctx.canvas.height])).toEqual([
      [64, 64],
      [512, 512],
      [1024, 128],
    ]);
    const fabric = stage.uniforms.fabric;
    expect(fabric.uKnitMean.value).toBe(fabric.uKnitTex.value.userData.mean);
    const floor = stage.uniforms.floor;
    const shadowRT = floor.uFloorShadow.value.renderTarget!;
    expect([shadowRT.width, shadowRT.height]).toEqual([640, 640]);
    expect(floor.uFloorShadow.value.type).toBe(THREE.HalfFloatType);
    expect(floor.uMirror.value.renderTarget!.width).toBe(4);
    expect(floor.uPuddleTex.value).toBe(stage.blank);
    expect(fabric.uWetMap.value).toBe(stage.blank);
    expect([...(stage.blank.image.data as Uint8Array)]).toEqual([0, 0, 0, 255]);
    expect(floor.uRipples.value).toBe(stage.ripples);
    expect(stage.ripples).toHaveLength(16);
    expect(vec(stage.ripples[0])).toEqual([0, 0, -10, 0]);
    expect(floor.uResolution.value).toBe(stage.viewport);
    expect(floor.uFloorFade).toBe(stage.uniforms.bg.uFloorFade);
  });

  it("sizes the leg shadow maps by pointer type", () => {
    const castMap = stage.legs[0].fabric.uCastShadowMap.value!;
    expect(castMap.image.width).toBe(1024);
    expect(castMap.compareFunction).toBe(THREE.LessEqualCompare);
    expect(stage.legs[0].fabric.uCastShadowTexel.value).toBe(1 / 1024);
    const coarse = buildStage({ coarsePointer: true }).stage;
    expect(coarse.legs[0].fabric.uCastShadowMap.value!.image.width).toBe(640);
    expect(coarse.legs[0].fabric.uCastShadowTexel.value).toBe(1 / 640);
  });

  it("starts in the studio with the lilac backdrop", () => {
    expect(stage.sceneNow).toBe(SCENES.studio);
    expect(stage.backdropNow).toBe(BACKDROPS.lilac);
    expect(hex(stage.uniforms.bg.uTopColor.value)).toBe(BACKDROPS.lilac.top);
    expect(backdropMaterial(stage).defines).toEqual({ SCENE: 0 });
  });
});

describe("setScene", () => {
  it("applies each scene's light, floor and shader variant", () => {
    const { stage } = buildStage();
    for (const key of SCENE_ORDER) {
      const def = SCENES[key];
      expect(stage.setScene(key)).toBe(def);
      expect(stage.sceneNow).toBe(def);
      expect(backdropMaterial(stage).defines).toEqual({ SCENE: def.id });
      expect(stage.floor.material.defines).toEqual({ SCENE: def.id });
      expect(backdropMaterial(stage).uniforms).toBe(stage.uniforms.bg);
      expect(stage.floor.material.uniforms).toBe(stage.uniforms.floor);
      const light = stage.uniforms.light;
      expect(hex(light.uKeyColor.value)).toBe(def.light.key);
      expect(hex(light.uRimColor.value)).toBe(def.light.rim);
      expect(hex(light.uRim2Color.value)).toBe(def.light.rim2);
      expect(vec(light.uFillTop.value)).toEqual(def.light.fillTop);
      expect(vec(light.uFillBottom.value)).toEqual(def.light.fillBottom);
      expect(vec(light.uEnvLo.value)).toEqual(def.light.envLo);
      expect(vec(light.uEnvHi.value)).toEqual(def.light.envHi);
      expect(vec(light.uEnvAColor.value)).toEqual(def.light.envA);
      expect(vec(light.uEnvBColor.value)).toEqual(def.light.envB);
      expect(light.uRim2Dir.value.length()).toBeCloseTo(1, 12);
      expect(light.uEnvADir.value.toArray()).toEqual(new THREE.Vector3(...def.light.envADir).normalize().toArray());
      expect(light.uEnvBDir.value.toArray()).toEqual(new THREE.Vector3(...def.light.envBDir).normalize().toArray());
      expect(light.uCaustic.value).toBe(def.light.caustic);
      const floor = stage.uniforms.floor;
      expect(hex(floor.uShadowColor.value)).toBe(key === "studio" ? BACKDROPS.lilac.shadow : def.floor.shadow);
      const mark = new THREE.Color(def.floor.mark);
      expect(vec(floor.uMarkColor.value)).toEqual([mark.r, mark.g, mark.b, def.floor.markAmt]);
      expect(floor.uMirrorStrength.value).toBe(def.floor.mirror);
      expect(floor.uPuddleLight.value).toBe(def.floor.puddleLight ?? 1);
    }
  });

  it("caches one backdrop/floor material pair per scene", () => {
    const { stage } = buildStage();
    const studio = [backdropMaterial(stage), stage.floor.material];
    stage.setScene("pool");
    const pool = [backdropMaterial(stage), stage.floor.material];
    expect(pool[0]).not.toBe(studio[0]);
    stage.setScene("studio");
    expect([backdropMaterial(stage), stage.floor.material]).toEqual(studio);
    stage.setScene("pool");
    expect(backdropMaterial(stage)).toBe(pool[0]);
    expect(stage.floor.material).toBe(pool[1]);
    expect(pool[0].depthTest).toBe(false);
  });

  it("falls back to the studio for unknown keys", () => {
    const { stage } = buildStage();
    stage.setScene("street");
    expect(stage.setScene("moon")).toBe(SCENES.studio);
    expect(stage.sceneNow).toBe(SCENES.studio);
    expect(backdropMaterial(stage).defines).toEqual({ SCENE: 0 });
  });
});

describe("setBackdrop", () => {
  it("applies every studio backdrop to the backdrop and floor colors", () => {
    const { stage } = buildStage();
    for (const key of BACKDROP_ORDER) {
      const def = BACKDROPS[key];
      stage.setBackdrop(key);
      expect(stage.backdropNow).toBe(def);
      const bg = stage.uniforms.bg;
      const floor = stage.uniforms.floor;
      expect(
        [bg.uTopColor, bg.uBottomColor, bg.uGlowColor, floor.uFloorColor, floor.uShadowColor].map((u) => hex(u.value)),
      ).toEqual([def.top, def.bottom, def.glow, def.floor, def.shadow]);
    }
  });

  it("has the legs reflect a room of the backdrop's color in the studio, and each other scene its own", () => {
    const { stage } = buildStage();
    const light = stage.uniforms.light;
    const studio = SCENES.studio.light;
    for (const key of [...BACKDROP_ORDER, "#7a1020"]) {
      stage.setBackdrop(key);
      const env = studioEnv(studio, stage.backdropNow);
      expect([key, vec(light.uEnvLo.value), vec(light.uEnvHi.value)]).toEqual([key, env.envLo, env.envHi]);
    }
    stage.setBackdrop("lilac");
    expect([vec(light.uEnvLo.value), vec(light.uEnvHi.value)]).toEqual([studio.envLo, studio.envHi]);
    // Another scene has its own surroundings whatever the studio's backdrop is, also when it is changed there.
    stage.setBackdrop("dusk");
    const dusk = studioEnv(studio, BACKDROPS.dusk);
    stage.setScene("pool");
    expect([vec(light.uEnvLo.value), vec(light.uEnvHi.value)]).toEqual([
      SCENES.pool.light.envLo,
      SCENES.pool.light.envHi,
    ]);
    stage.setBackdrop("sakura");
    expect([vec(light.uEnvLo.value), vec(light.uEnvHi.value)]).toEqual([
      SCENES.pool.light.envLo,
      SCENES.pool.light.envHi,
    ]);
    // Back in the studio the backdrop chosen meanwhile counts.
    stage.setScene("studio");
    const sakura = studioEnv(studio, BACKDROPS.sakura);
    expect([vec(light.uEnvLo.value), vec(light.uEnvHi.value)]).toEqual([sakura.envLo, sakura.envHi]);
    expect(sakura).not.toEqual(dusk);
  });

  it("dims and tints the studio's rim light with the backdrop, and leaves the other scenes theirs", () => {
    const { stage } = buildStage();
    const rim = stage.uniforms.light.uRimColor.value;
    const studioRim = new THREE.Color(SCENES.studio.light.rim);
    const expected = (key: string) => {
      const tint = studioRimTint(BACKDROPS[key] ?? makeCustomBackdrop(key));
      return [studioRim.r * tint[0], studioRim.g * tint[1], studioRim.b * tint[2]];
    };
    for (const key of [...BACKDROP_ORDER, "#7a1020"]) {
      stage.setBackdrop(key);
      expect([key, rim.toArray()]).toEqual([key, expected(key)]);
    }
    // In front of the dusk backdrop barely any is left: the legs' edges are not lit up as by a bright wall.
    stage.setBackdrop("dusk");
    expect(Math.max(...rim.toArray())).toBeLessThan(0.15);
    stage.setScene("street");
    expect(hex(rim)).toBe(SCENES.street.light.rim);
    stage.setBackdrop("lilac");
    expect(hex(rim)).toBe(SCENES.street.light.rim);
    stage.setScene("studio");
    expect(hex(rim)).toBe(SCENES.studio.light.rim);
  });

  it("builds a custom backdrop from a hex color, or takes a def as is", () => {
    const { stage } = buildStage();
    stage.setBackdrop("#3366cc");
    const custom = makeCustomBackdrop("#3366cc");
    expect(stage.backdropNow).toEqual(custom);
    expect(hex(stage.uniforms.bg.uTopColor.value)).toBe(custom.top);
    expect(hex(stage.uniforms.floor.uShadowColor.value)).toBe(custom.shadow);
    const def = { ...BACKDROPS.mint, label: "mine" };
    stage.setBackdrop(def);
    expect(stage.backdropNow).toBe(def);
    expect(hex(stage.uniforms.bg.uBottomColor.value)).toBe(def.bottom);
  });

  it("only remembers the backdrop outside the studio and applies it on return", () => {
    const { stage } = buildStage();
    stage.setScene("bath");
    const top = hex(stage.uniforms.bg.uTopColor.value);
    stage.setBackdrop("dusk");
    expect(stage.backdropNow).toBe(BACKDROPS.dusk);
    expect(hex(stage.uniforms.bg.uTopColor.value)).toBe(top);
    expect(hex(stage.uniforms.floor.uShadowColor.value)).toBe(SCENES.bath.floor.shadow);
    stage.setScene("studio");
    expect(hex(stage.uniforms.bg.uTopColor.value)).toBe(BACKDROPS.dusk.top);
    expect(hex(stage.uniforms.floor.uShadowColor.value)).toBe(BACKDROPS.dusk.shadow);
  });
});

describe("warmScene", () => {
  it("compiles a new scene's materials into the mirror target and restores the bound target", async () => {
    const { stage, renderer } = buildStage();
    const names = namesFor(stage);
    const cam = camera();
    const previous = new THREE.WebGLRenderTarget(8, 8);
    names.set(previous, "previousRT");
    renderer.setRenderTarget(previous);
    renderer.reset();
    await expect(stage.warmScene("street", cam)).resolves.toBeInstanceOf(THREE.Scene);
    expect(describeCalls(renderer.calls, names)).toEqual([
      "bind mirrorRT",
      "compile Scene -> mirrorRT",
      "bind previousRT",
    ]);
    const compiled = renderer.ops("compileAsync")[0];
    expect(compiled.camera).toBe(cam);
    const materials = compiled.scene.children.map((mesh) => (mesh as THREE.Mesh).material);
    stage.setScene("street");
    expect(materials).toEqual([backdropMaterial(stage), stage.floor.material]);
  });

  it("does nothing for unknown, current or already warmed scenes", async () => {
    const { stage, renderer } = buildStage();
    const cam = camera();
    await expect(stage.warmScene("moon", cam)).resolves.toBeUndefined();
    await expect(stage.warmScene("studio", cam)).resolves.toBeUndefined();
    await stage.warmScene("pool", cam);
    renderer.reset();
    await expect(stage.warmScene("pool", cam)).resolves.toBeUndefined();
    expect(renderer.calls).toEqual([]);
  });

  it("swallows compile failures", async () => {
    const { stage, renderer } = buildStage({ compileFails: true });
    await expect(stage.warmScene("bath", camera())).resolves.toBeUndefined();
    expect(renderer.ops("compileAsync")).toHaveLength(1);
  });

  it("skips warming when the renderer has no compileAsync", async () => {
    const { stage, renderer } = buildStage({ noCompileAsync: true });
    await expect(stage.warmScene("bath", camera())).resolves.toBeUndefined();
    expect(renderer.calls).toEqual([]);
    // nothing was cached, so a later warm-up still finds the scene cold
    stage.setScene("bath");
    expect(backdropMaterial(stage).defines).toEqual({ SCENE: 1 });
  });
});

describe("setStocking", () => {
  const presetSpecs: [string, Partial<LegSpec>][] = PRESETS.flatMap((preset) =>
    preset.legs
      ? preset.legs.map((spec, i): [string, Partial<LegSpec>] => [`${preset.id} #${i}`, spec])
      : [[preset.id, preset.both ?? {}] satisfies [string, Partial<LegSpec>]],
  );

  it("draws the forefoot's skin under the stocking, and in place of the stocking's front on a bare leg", () => {
    const { stage } = buildStage();
    const model = legModel();
    const leg = stage.legs[0];
    const forefoot = leg.group.children.filter((mesh) => (mesh as THREE.Mesh).geometry === model.forefoot);
    expect(forefoot).toEqual([
      leg.forefootParts[0],
      leg.forefootParts[1],
      leg.forefootOutline,
      leg.forefootNearParts[1],
    ]);
    expect(leg.forefootParts).toHaveLength(4);
    expect(leg.forefootParts[1].material.polygonOffset).toBe(true);
    expect(leg.forefootParts[1].material.uniforms.uClip).toBe(leg.forefootClip);
    expect(leg.forefootParts[1].material.polygonOffsetFactor).toBe(0);
    expect(leg.forefootOutline!.material.uniforms.uSilhouette.value).toBe(1);
    const state = () => ({
      clip: leg.fabric.uClip.value,
      overlay: leg.fabric.uOverlay.value,
      under: leg.forefootUnder.value,
      shown: leg.forefootParts.map((part) => part.visible),
      order: leg.forefootParts.map((part) => part.renderOrder),
      line: leg.forefootOutline!.visible,
      reach: leg.forefootClip.value,
      lineClip: leg.outlineUniforms.uClip.value,
      stocking: leg.stockingParts.map((part) => part.renderOrder),
      front: [...leg.stockingFrontParts, ...leg.forefootNearParts].map((part) => part.visible),
    });
    const all = (shown: boolean) => new Array<boolean>(6).fill(shown);
    // Under a stocking: the stocking behind the join is drawn first, then the skin (wearing the fabric that
    // lies on it, and reaching back under the stocking), then bare where it is right under the nearest fabric,
    // then the stocking in front of the join, which it is seen through.
    stage.setStocking(0, resolveLegLook(DEFAULT_LEG_SPEC));
    expect(state()).toEqual({
      clip: 1,
      overlay: 1,
      under: 1,
      shown: [true, true, true, true],
      order: [-4, -3, -4, -3],
      line: false,
      reach: -0.1,
      lineClip: 0,
      stocking: [-6, -5, -6, -5],
      front: all(true),
    });
    expect(leg.forefootParts[1].material.uniforms.uCover.value).toBe(1);
    // The reflection draws the bare skin only.
    expect(leg.forefootParts[3].material).toBe(leg.forefootNearParts[1].material);
    expect(leg.forefootNearParts).toHaveLength(2);
    expect(leg.forefootNearParts[1].material.uniforms.uCover.value).toBe(0);
    expect(leg.forefootNearParts[1].material.uniforms.uClip.value).toBe(-1);
    expect(leg.forefootNearParts[1].material.depthFunc).toBe(THREE.EqualDepth);
    expect(leg.forefootNearParts[0].material.colorWrite).toBe(false);
    expect(leg.forefootNearParts[0].material.uniforms.uTowardEye.value).toBeLessThan(0);
    expect(leg.stocking.material.uniforms.uTowardEye.value).toBe(0);
    // A fading leg goes back to a single surface.
    stage.setLegOpacity(0, 0.5);
    expect(state()).toMatchObject({
      clip: 0,
      overlay: 0,
      shown: [false, false, false, false],
      stocking: [0, 1, 0, 1],
      front: all(false),
    });
    stage.setLegOpacity(0, 0.95);
    expect(leg.fabric.uOverlay.value).toBeCloseTo(0.5, 5);
    expect(leg.forefootParts[0].visible).toBe(true);
    stage.setLegOpacity(0, 1);
    // Bare: the forefoot replaces the front of the stocking mesh and is drawn along with it, at any opacity.
    stage.setStocking(0, resolveLegLook({ length: "bare" }));
    for (const opacity of [1, 0.3]) {
      stage.setLegOpacity(0, opacity);
      expect(state()).toEqual({
        clip: 1,
        overlay: 0,
        under: 0,
        shown: [true, true, true, true],
        order: [0, 1, 0, 1],
        line: true,
        reach: -1,
        lineClip: 1,
        stocking: [0, 1, 0, 1],
        front: all(false),
      });
    }
    // The other leg keeps its own state.
    expect(stage.legs[1].fabric.uClip.value).toBe(1);
    expect(stage.legs[1].bare).toBe(false);
  });

  it("applies every preset leg spec to both legs", () => {
    const { stage } = buildStage();
    const collision = legModel().collision;
    const state: number[] = [];
    for (const [, spec] of presetSpecs) {
      const look = resolveLegLook(spec);
      const bowMatrix = computeBowMatrix(collision, look.cuffY);
      for (const index of [0, 1]) {
        stage.setStocking(index, look, bowMatrix);
        const leg = stage.legs[index];
        expectLookApplied(leg, look);
        expect(leg.bow.visible).toBe(look.bow);
        if (look.bow) {
          expect(leg.bowU.uBowMatrix.value.elements).toEqual([...bowMatrix]);
          expect(hex(leg.bowU.uBowColor.value)).toBe(look.dye2);
        }
      }
      const f = stage.legs[1].fabric;
      state.push(
        ...f.uDye.value.toArray(),
        ...f.uSecret.value.toArray(),
        ...f.uWetDye.value.toArray(),
        f.uDenier.value,
        f.uPattern.value,
        f.uCuffStyle.value,
      );
    }
    expect(presetSpecs.map(([name]) => name)).toHaveLength(13);
    expect(digestRounded(state, 6)).toMatchInlineSnapshot(`"0b9cd58b"`);
  });

  it("shows the bow only for bow cuffs with a placement matrix", () => {
    const { stage } = buildStage();
    const bowLook = resolveLegLook({ cuff: "bow" });
    stage.setStocking(0, bowLook);
    expect(stage.legs[0].bow.visible).toBe(false);
    stage.setStocking(0, bowLook, computeBowMatrix(legModel().collision, bowLook.cuffY));
    expect(stage.legs[0].bow.visible).toBe(true);
    stage.setStocking(0, resolveLegLook({ cuff: "lace" }), new Float64Array(16));
    expect(stage.legs[0].bow.visible).toBe(false);
    // tights never get a bow
    expect(resolveLegLook({ cuff: "bow", length: "tights" }).bow).toBe(false);
  });

  it("sets the wet color tint when the spec has one and clears it otherwise", () => {
    const { stage } = buildStage();
    stage.setStocking(1, resolveLegLook({ wetColor: "sakura" }));
    const wet = stage.legs[1].fabric.uWetDye.value;
    const sakura = new THREE.Color(resolveLegLook({ color: "sakura" }).dye);
    expect(vec(wet)).toEqual([sakura.r, sakura.g, sakura.b, 0.85]);
    stage.setStocking(1, resolveLegLook({}));
    expect(vec(wet)).toEqual([0, 0, 0, 0]);
  });

  it("puts the bare-leg cuff below every stocking vertex, so the shader draws skin everywhere", () => {
    const { stage } = buildStage();
    const bare = resolveLegLook({ length: "bare" });
    stage.setStocking(0, bare);
    expect(stage.legs[0].fabric.uHasCuff.value).toBe(1);
    expect(stage.legs[0].bow.visible).toBe(false);
    const positions = legModel().stocking.getAttribute("position");
    let lowest = Infinity;
    for (let i = 0; i < positions.count; i++) {
      lowest = Math.min(lowest, positions.getY(i));
    }
    // The cuff shader decorates up to 7.5 cm below the cuff line and bulges the mesh around it.
    expect(stage.legs[0].fabric.uCuffY.value).toBeLessThan(lowest - 0.1);
  });

  it("presses the cuff into the leg for every length but tights, which have no cuff", () => {
    const { stage } = buildStage();
    const [leg, other] = stage.legs;
    for (const length of STOCKING_LENGTH_ORDER) {
      stage.setStocking(0, resolveLegLook({ length }));
      expect([length, leg.fabric.uCuffBulge.value]).toEqual([length, length === "tights" ? 0 : 1]);
      // Every pass that places the stocking's vertices reads the same uniform, so they all agree on its shape.
      for (const part of [...leg.stockingParts, ...leg.stockingFrontParts, ...leg.forefootParts]) {
        expect(part.material.uniforms.uCuffBulge).toBe(leg.fabric.uCuffBulge);
      }
      expect(other.fabric.uCuffBulge.value).toBe(1);
    }
  });

  it("draws a stocking with a cuff from the mesh ringed at the cuff's height, and the others from the plain one", () => {
    const { stage } = buildStage();
    const model = legModel();
    const [leg, other] = stage.legs;
    // The stocking's depth and color passes, the passes drawn after both legs from the whole of it, and its
    // outline: they have to agree on the surface.
    const [restore, , , , last] = leg.late.map((group) => group.children as StageLeg["stocking"][]);
    expect(leg.cuffParts).toEqual([leg.stockingParts[0], restore[0], last[1]]);
    expect(leg.cuffParts.map((part) => part.material.vertexShader)).toEqual([
      LEG_VERTEX_SHADER,
      LEG_VERTEX_SHADER,
      OUTLINE_VERTEX_SHADER,
    ]);
    const own = (mesh: THREE.Object3D) =>
      [leg.cuffParts, leg.topParts, leg.lowParts, leg.highParts].some((parts) =>
        parts.includes(mesh as StageLeg["stocking"]),
      );
    const all = () => leg.group.children.concat(...leg.late.map((group) => group.children), leg.mirror.children);
    const elsewhere = all()
      .concat(leg.shadow, leg.caster)
      .filter((mesh) => !own(mesh))
      .map((mesh) => (mesh as StageLeg["stocking"]).geometry.uuid);
    for (const length of STOCKING_LENGTH_ORDER) {
      const look = resolveLegLook({ length });
      stage.setStocking(0, look);
      const ringed = length === "bare" || length === "tights" ? undefined : model.stockingAtCuff.get(look.cuffY);
      expect(length === "bare" || length === "tights" || ringed !== undefined).toBe(true);
      for (const part of leg.cuffParts) {
        expect(part.geometry).toBe(ringed ?? model.stocking);
      }
      // The fading top's passes are drawn from the upper part of that same mesh: its vertices, fewer triangles.
      for (const part of leg.topParts) {
        expect(part.geometry.attributes.position).toBe((ringed ?? model.stocking).attributes.position);
        expect(part.geometry.index!.count).toBeLessThan((ringed ?? model.stocking).index!.count / 2);
        expect(part.geometry).toBe(leg.topParts[0].geometry);
      }
      // Nothing else changes its mesh, and the other leg keeps its own.
      expect(
        all()
          .concat(leg.shadow, leg.caster)
          .filter((mesh) => !own(mesh))
          .map((mesh) => (mesh as StageLeg["stocking"]).geometry.uuid),
      ).toEqual(elsewhere);
      expect(other.stockingParts[0].geometry).toBe(model.stockingAtCuff.get(0.7));
    }
  });

  it("has one shape for the cuff's press, for the shaders and for what rests on the surface", () => {
    // The shaders' profile, evaluated as written, against the one drops are placed by.
    const body = /float cuffProfile\(float dy\) \{([^}]*)\}/.exec(CUFF_PRESS_GLSL)![1];
    const js = body
      .replace(/float /g, "const ")
      .replace(/\b(exp|pow)\(/g, "Math.$1(")
      .replace(/ \* uCuffBulge/, "");
    const smoothstep = (from: number, to: number, x: number) => {
      const t = Math.min(Math.max((x - from) / (to - from), 0), 1);
      return t * t * (3 - 2 * t);
    };
    const shaderProfile = new Function("dy", "smoothstep", js) as (dy: number, s: typeof smoothstep) => number;
    for (let dy = -0.08; dy <= 0.06; dy += 0.0005) {
      expect(shaderProfile(dy, smoothstep)).toBeCloseTo(cuffPressAt(dy), 12);
    }
    // Out by the bulge at its top above the edge, in by the dent below it, nothing away from the cuff.
    expect(cuffPressAt(CUFF_PRESS.bulgeAt)).toBeCloseTo(CUFF_PRESS.bulge, 9);
    expect(cuffPressAt(-0.01)).toBeLessThan(-CUFF_PRESS.dent * 0.9);
    expect(cuffPressAt(-0.01)).toBeGreaterThanOrEqual(-CUFF_PRESS.dent);
    expect(Math.abs(cuffPressAt(0.05))).toBeLessThan(1e-9);
    expect(cuffPressAt(-0.06)).toBeCloseTo(0, 12);
    expect(cuffPressAt(-Infinity)).toBeCloseTo(0, 12);
    expect(CUFF_PRESS.bulge).toBeGreaterThan(CUFF_PRESS.dent);
  });

  it("moves the bow in with the fabric where the cuff presses it", () => {
    const { stage } = buildStage();
    for (const leg of stage.legs) {
      expect(leg.bowU.uCuffY).toBe(leg.fabric.uCuffY);
      expect(leg.bowU.uCuffBulge).toBe(leg.fabric.uCuffBulge);
      expect(leg.bow.material.uniforms).toBe(leg.bowU);
    }
    // The bow is placed on the leg's plain shape (computeBowMatrix); its shader presses it like the fabric.
    expect(BOW_VERTEX_SHADER).toContain(CUFF_PRESS_GLSL);
    expect(BOW_VERTEX_SHADER).toMatch(/p \+= skinNormal\(jac, [^;]*\) \* cuffProfile\(local\.y - uCuffY\);/);
  });

  it("draws the outline around the surface as the cuff presses it, not around the leg's plain shape", () => {
    const { stage } = buildStage();
    for (const leg of stage.legs) {
      expect(leg.outlineUniforms.uCuffBulge).toBe(leg.fabric.uCuffBulge);
      expect(leg.outlineUniforms.uCuffY).toBe(leg.fabric.uCuffY);
      // The forefoot's line is drawn with the leg, the stocking's after both legs.
      const outlines = [...leg.group.children, ...leg.late[4].children].filter(
        (mesh): mesh is StageLeg["stocking"] =>
          (mesh as StageLeg["stocking"]).material.vertexShader === OUTLINE_VERTEX_SHADER,
      );
      expect(outlines).toHaveLength(2);
      for (const outline of outlines) {
        expect(outline.material.uniforms.uCuffBulge).toBe(leg.fabric.uCuffBulge);
        expect(outline.geometry.attributes.legTangent).toBeDefined();
      }
    }
    // Both vertex shaders move the surface with the same code.
    for (const shader of [LEG_VERTEX_SHADER, OUTLINE_VERTEX_SHADER]) {
      expect(shader).toContain(CUFF_PRESS_GLSL);
      expect(shader).toMatch(/if \(uIsSkin < 0\.5\) [^;]*pressCuff\(position\.y, /);
    }
  });
});

describe("leg pose, opacity and order", () => {
  it("receives the rig's poses on the leg, mirror, shadow and caster", () => {
    const { stage } = buildStage();
    const rig = new LegRig(legModel().collision, stage);
    const flip = new THREE.Matrix4().makeScale(1, -1, 1);
    rig.legs.forEach((rigLeg, i) => {
      const leg = stage.legs[i];
      const m = new THREE.Matrix4().fromArray(rigLeg.m);
      expect(leg.group.matrix.elements).toEqual(m.elements);
      expect(leg.mirror.matrix.elements).toEqual(m.clone().premultiply(flip).elements);
      expect(leg.shadow.matrix.elements).toEqual(m.elements);
      expect(leg.caster.matrix.elements).toEqual(m.elements);
      expect(leg.group.matrixWorldNeedsUpdate).toBe(true);
      const pose = rigLeg.p!;
      expect(leg.rig.uToeRot.value.elements).toEqual(new THREE.Matrix3().set(...pose.T).elements);
      expect(leg.rig.uAnkleRot.value.elements).toEqual(new THREE.Matrix3().set(...pose.A).elements);
      expect(leg.rig.uKneeRot.value.elements).toEqual(new THREE.Matrix3().set(...pose.K).elements);
      expect(leg.rig.uRigOn.value).toBe(pose.on);
    });
    expect(
      digestRounded([...stage.legs[0].matrix.elements, ...stage.legs[1].matrix.elements], 9),
    ).toMatchInlineSnapshot(`"46e7de9d"`);
  });

  it("hides a leg (with its mirror and shadow) once its opacity is all but zero", () => {
    const { stage } = buildStage();
    const leg = stage.legs[1];
    stage.setLegOpacity(1, 0.5);
    expect([leg.fabric.uOpacity.value, leg.group.visible, leg.mirror.visible, leg.shadow.visible]).toEqual([
      0.5,
      true,
      true,
      true,
    ]);
    expect(leg.late.every((group) => group.visible)).toBe(true);
    stage.setLegOpacity(1, 0.003);
    expect([leg.group.visible, leg.mirror.visible, leg.shadow.visible]).toEqual([false, false, false]);
    expect(leg.late.some((group) => group.visible)).toBe(false);
    expect(leg.outlineUniforms.uOpacity.value).toBe(0.003);
    expect(stage.legs[0].group.visible).toBe(true);
  });

  it("draws what is seen through after both legs: the top of the leg behind, then that of the leg in front", () => {
    const { stage } = buildStage();
    const orders = () => stage.legs.map((leg) => leg.late.map((group) => group.renderOrder));
    // The solid leg's depth once more, the fading top, the inside, what of the solid leg is seen through its
    // top, and the line: leg 0 in front.
    expect(orders()).toEqual([
      [25, 40, 45, 48, 50],
      [25, 30, 45, 46, 50],
    ]);
    // The leg drawn first lays its depth down again: the other leg took some of it out with what of it is gone.
    expect(stage.legs.map((leg) => leg.restore.visible)).toEqual([false, true]);
    expect(
      stage.legs.every(
        (leg) =>
          leg.restore === leg.late[0].children[0] && leg.fadeGroup === leg.late[1] && leg.throughGroup === leg.late[3],
      ),
    ).toBe(true);
    stage.setOrder(1);
    expect(orders()).toEqual([
      [25, 30, 45, 46, 50],
      [25, 40, 45, 48, 50],
    ]);
    expect(stage.legs.map((leg) => leg.restore.visible)).toEqual([true, false]);
    for (const leg of stage.legs) {
      const [restore, fade, inside, through, last] = leg.late.map((group) => group.children as StageLeg["stocking"][]);
      const [curtainBit, goneBit] = [1 << (2 * leg.index), 2 << (2 * leg.index)];
      const stencil = (material: THREE.Material) => [
        material.stencilWrite,
        material.stencilFunc,
        material.stencilRef,
        material.stencilFuncMask,
        material.stencilWriteMask,
      ];
      // The solid leg's depth again: all of it but what is gone.
      expect(restore[0].material.defines).toEqual({});
      expect(restore[0].material.colorWrite).toBe(false);
      expect(stencil(restore[0].material)).toEqual([true, THREE.EqualStencilFunc, 0, goneBit, 0]);
      // The fading top: color alone, over whatever lies behind it, as in the floor's reflection.
      expect(fade.map((mesh) => mesh.material.defines)).toEqual([{ FADE_ZONE: 1 }]);
      expect([fade[0].material.depthWrite, fade[0].material.depthFunc]).toEqual([false, THREE.LessEqualDepth]);
      expect(leg.mirror.children.some((mesh) => (mesh as StageLeg["stocking"]).material === fade[0].material)).toBe(
        true,
      );
      // The inside: one pass that lays its depth down as it goes, the nearer walls first.
      expect(inside.map((mesh) => mesh.material.defines)).toEqual([{ LEG_INSIDE: 1 }]);
      expect([inside[0].material.colorWrite, inside[0].material.depthWrite, inside[0].material.depthFunc]).toEqual([
        true,
        true,
        THREE.LessEqualDepth,
      ]);
      const position = inside[0].geometry.attributes.position;
      const tops: number[] = [];
      const index = inside[0].geometry.index!.array;
      for (let i = 0; i < index.length; i += 3) {
        tops.push(Math.max(position.getY(index[i]), position.getY(index[i + 1]), position.getY(index[i + 2])));
      }
      expect(tops.every((top, i) => i === 0 || top <= tops[i - 1])).toBe(true);
      // What of the solid leg is seen through its top, where the second bit is set: its depth again (and the
      // target's alpha set to one), the curtain in front of it taking the alpha down to how much shows, and its
      // color weighed by that alpha.
      expect(through.map((mesh) => mesh.material.defines)).toEqual([{}, { CURTAIN: 1, VEIL: 1 }, { HIGH_PART: 1 }]);
      for (const mesh of through) {
        expect(stencil(mesh.material)).toEqual([true, THREE.EqualStencilFunc, goneBit, goneBit, 0]);
        expect(mesh.material.blending).toBe(THREE.CustomBlending);
      }
      const blend = (material: THREE.Material) => [
        material.blendSrc,
        material.blendDst,
        material.blendEquationAlpha,
        material.blendSrcAlpha,
        material.blendDstAlpha,
      ];
      expect([through[0].material.colorWrite, through[0].material.depthWrite]).toEqual([true, true]);
      expect(blend(through[0].material)).toEqual([
        THREE.ZeroFactor,
        THREE.OneFactor,
        null,
        THREE.OneFactor,
        THREE.ZeroFactor,
      ]);
      expect([through[1].material.depthFunc, through[1].material.depthWrite]).toEqual([THREE.LessDepth, false]);
      expect(blend(through[1].material)).toEqual([
        THREE.ZeroFactor,
        THREE.OneFactor,
        THREE.MinEquation,
        THREE.OneFactor,
        THREE.OneFactor,
      ]);
      expect([through[2].material.depthFunc, through[2].material.depthWrite]).toEqual([THREE.EqualDepth, false]);
      expect(blend(through[2].material)).toEqual([
        THREE.DstAlphaFactor,
        THREE.OneMinusDstAlphaFactor,
        null,
        THREE.ZeroFactor,
        THREE.OneFactor,
      ]);
      // The depth of the leg's top, for the line that comes after it. It and the inside's are laid down nearer.
      expect(last[0].material.defines).toEqual({ CURTAIN: 1 });
      for (const mesh of [...inside, last[0]]) {
        expect([mesh.material.polygonOffset, mesh.material.polygonOffsetFactor]).toEqual([true, -4]);
      }
      expect(last[1].material.vertexShader).toBe(OUTLINE_VERTEX_SHADER);
      // All of them read the leg's own uniforms, and none copies of them.
      for (const mesh of [...restore, ...fade, ...inside, ...through, last[0]]) {
        expect(mesh.material.uniforms).toBe(leg.stocking.material.uniforms);
      }
      expect(curtainBit).not.toBe(goneBit);
    }
    // Each leg has two bits of the stencil buffer to itself.
    expect(new Set(stage.legs.flatMap((leg) => [1 << (2 * leg.index), 2 << (2 * leg.index)])).size).toBe(4);
  });

  it("keeps the solid leg from showing through its own top with a curtain while the leg is drawn", () => {
    const { stage } = buildStage();
    const model = legModel();
    for (const leg of stage.legs) {
      const [low, curtain, gone, erase] = leg.aroundStocking;
      const [depth, color, , mirrorColor] = leg.stockingParts;
      const [curtainBit, goneBit] = [1 << (2 * leg.index), 2 << (2 * leg.index)];
      // The solid leg's depth, the color of the leg from the ankle down (which shows through the leg's own
      // top), the curtain marking where it hangs in front of that depth, the color of the leg above the ankle
      // where it does not, and the two passes that mark what the curtain kept from being drawn and take its
      // depth out.
      const drawn = [depth, low, curtain, color, gone, erase];
      const inOrder = () => [...drawn].sort((a, b) => a.renderOrder - b.renderOrder);
      expect(inOrder()).toEqual(drawn);
      expect(drawn.map((mesh) => mesh.material.defines ?? {})).toEqual([
        {},
        { LOW_PART: 1 },
        { CURTAIN: 1 },
        { HIGH_PART: 1 },
        {},
        { FAR_PLANE: 1 },
      ]);
      expect([low.material.depthFunc, color.material.depthFunc]).toEqual([THREE.EqualDepth, THREE.EqualDepth]);
      const stencil = (material: THREE.Material) => [
        material.stencilWrite,
        material.stencilFunc,
        material.stencilRef,
        material.stencilFuncMask,
        material.stencilWriteMask,
        material.stencilZPass,
      ];
      // The curtain writes neither color nor depth: it sets the leg's first bit where it is the nearer.
      expect([curtain.material.colorWrite, curtain.material.depthWrite, curtain.material.depthFunc]).toEqual([
        false,
        false,
        THREE.LessDepth,
      ]);
      expect(stencil(curtain.material)).toEqual([
        true,
        THREE.AlwaysStencilFunc,
        curtainBit,
        0xff,
        curtainBit,
        THREE.ReplaceStencilOp,
      ]);
      // The solid leg's color is drawn where that bit is not set...
      expect(stencil(color.material).slice(0, 5)).toEqual([true, THREE.EqualStencilFunc, 0, curtainBit, 0]);
      expect(low.material.stencilWrite).toBe(false);
      // ...and where it is, and the depth there is the solid leg's own, the second bit is set and the depth
      // taken out, drawn at the far end of the depth range.
      expect([gone.material.colorWrite, gone.material.depthWrite, gone.material.depthFunc]).toEqual([
        false,
        false,
        THREE.EqualDepth,
      ]);
      expect(stencil(gone.material)).toEqual([
        true,
        THREE.EqualStencilFunc,
        curtainBit | goneBit,
        curtainBit,
        goneBit,
        THREE.ReplaceStencilOp,
      ]);
      expect([erase.material.colorWrite, erase.material.depthWrite, erase.material.depthFunc]).toEqual([
        false,
        true,
        THREE.AlwaysDepth,
      ]);
      expect(stencil(erase.material).slice(0, 5)).toEqual([true, THREE.EqualStencilFunc, goneBit, goneBit, 0]);
      // No curtain in the floor's reflection: the whole leg's color in one pass there.
      expect(mirrorColor.material.defines).toEqual({});
      expect(mirrorColor.material.stencilWrite).toBe(false);
      expect(mirrorColor.material.uniforms).toBe(color.material.uniforms);
      // The curtain hangs from the top of the mesh alone, and the two colors are drawn from its bottom and from
      // the rest of it: the same vertices, some of the triangles.
      const [, fade, inside, through, last] = leg.late.map((group) => group.children as StageLeg["stocking"][]);
      expect(leg.topParts).toEqual([curtain, fade[0], through[1], last[0]]);
      expect(leg.lowParts).toEqual([low]);
      expect(leg.highParts).toEqual([color, gone, erase, inside[0], through[0], through[2]]);
      const heights = (geometry: THREE.BufferGeometry): [number, number] => {
        let [lowest, highest] = [Infinity, -Infinity];
        for (const i of geometry.index!.array) {
          lowest = Math.min(lowest, geometry.attributes.position.getY(i));
          highest = Math.max(highest, geometry.attributes.position.getY(i));
        }
        return [lowest, highest];
      };
      const check = (whole: THREE.BufferGeometry) => {
        expect(depth.geometry).toBe(whole);
        const parts = [leg.topParts, leg.lowParts, leg.highParts].map((meshes) => {
          expect(meshes.map((mesh) => mesh.geometry)).toEqual(Array(meshes.length).fill(meshes[0].geometry));
          expect(meshes[0].geometry.attributes.position).toBe(whole.attributes.position);
          return meshes[0].geometry;
        });
        const [top, bottom, upper] = parts.map((part) => part.index!.count);
        expect(top).toBeGreaterThan(0);
        expect(top).toBeLessThan(whole.index!.count * 0.25);
        // The two colors between them draw every triangle, and only those along the line between them twice.
        expect(bottom + upper).toBeGreaterThanOrEqual(whole.index!.count);
        expect(bottom + upper).toBeLessThan(whole.index!.count * 1.05);
        expect(heights(parts[0])[0]).toBeGreaterThan(0.5);
        expect(heights(parts[1])[1]).toBeLessThan(0.2);
        expect(heights(parts[2])[0]).toBeGreaterThan(0.07);
      };
      check(model.stockingAtCuff.get(0.7)!);
      // They follow the stocking onto another mesh, and with the forefoot's skin to another place in the order.
      stage.setStocking(leg.index, resolveLegLook({ length: "tights" }));
      check(model.stocking);
      expect(inOrder()).toEqual(drawn);
      stage.setLegOpacity(leg.index, 0.5);
      expect(inOrder()).toEqual(drawn);
    }
  });

  it("leaves out the passes for what is seen through a leg's top while the eye does not look into the leg", () => {
    const { stage } = buildStage();
    const camera = new THREE.PerspectiveCamera();
    const queries: { passed: boolean; asked: boolean }[] = [];
    const answers: boolean[] = [];
    // The GPU's side of an occlusion query: answers when asked the next time.
    const gl = {
      ANY_SAMPLES_PASSED: 1,
      QUERY_RESULT: 2,
      QUERY_RESULT_AVAILABLE: 3,
      createQuery: () => {
        const query = { passed: answers.shift() ?? false, asked: false };
        queries.push(query);
        return query;
      },
      beginQuery: () => {},
      endQuery: () => {
        queries[queries.length - 1].asked = true;
      },
      getQueryParameter: (query: { passed: boolean; asked: boolean }, what: number) =>
        what === 3 ? query.asked : query.passed,
      deleteQuery: () => {},
    };
    const renderer = { getContext: () => gl } as unknown as THREE.WebGLRenderer;
    // One frame, as the renderer goes about it: the scene first, then every mesh that is to be drawn.
    const frame = (from: [number, number, number]) => {
      camera.position.set(...from);
      camera.updateMatrixWorld();
      stage.scene.onBeforeRender(renderer, stage.scene, camera, null as never, null as never, null as never);
      for (const leg of stage.legs) {
        for (const mesh of leg.askParts.filter((part) => part.visible)) {
          mesh.onBeforeRender(renderer, stage.scene, camera, mesh.geometry, mesh.material, null as never);
          mesh.onAfterRender(renderer, stage.scene, camera, mesh.geometry, mesh.material, null as never);
        }
      }
    };
    const shown = (leg: StageLeg) => ({
      into: leg.intoParts.map((part) => part.visible),
      ask: leg.askParts.map((part) => part.visible),
      through: leg.throughParts.map((part) => part.visible),
      whole: leg.stocking.material === leg.solid[0] && leg.stocking.geometry === leg.stockingParts[0].geometry,
    });
    const all = (visible: boolean, count: number) => Array<boolean>(count).fill(visible);
    for (const leg of stage.legs) {
      expect(leg.intoParts).toEqual(leg.late[2].children);
      expect(leg.askParts).toEqual(leg.aroundStocking.slice(1, 3));
      expect(leg.throughParts).toEqual([leg.aroundStocking[0], leg.aroundStocking[3], ...leg.late[3].children]);
    }
    // From the side, level with the knees: nothing of all that, and the solid leg's color in one pass.
    frame([2, 0.5, 1]);
    for (const leg of stage.legs) {
      expect(shown(leg)).toEqual({ into: [false], ask: all(false, 2), through: all(false, 5), whole: true });
      expect(leg.fabric.uInto.value).toBe(0);
      expect(leg.restore.visible).toBe(false);
    }
    expect(queries).toHaveLength(0);
    // From right above: the inside, and the two passes that find what is seen through the top. Until the GPU
    // has told, the passes for that are drawn as well.
    answers.push(false, false);
    frame([0, 3, 0.05]);
    for (const leg of stage.legs) {
      expect(shown(leg)).toEqual({ into: [true], ask: all(true, 2), through: all(true, 5), whole: false });
      expect(leg.fabric.uInto.value).toBe(1);
    }
    expect(stage.legs.map((leg) => leg.restore.visible)).toEqual([false, true]);
    expect(queries).toHaveLength(2);
    // It tells: nothing. Those passes go, the color is one pass again, and the question is asked again only
    // after a while.
    frame([0, 3, 0.05]);
    for (const leg of stage.legs) {
      expect(shown(leg)).toEqual({ into: [true], ask: all(false, 2), through: all(false, 5), whole: true });
      expect(leg.restore.visible).toBe(false);
    }
    expect(queries).toHaveLength(2);
    // Something of one leg is: its passes are back for good, and the other leg lays its depth down again.
    const realNow = performance.now;
    let now = realNow.call(performance);
    performance.now = () => now;
    try {
      now += 31;
      answers.push(true, false);
      frame([0, 3, 0.05]);
      expect(queries).toHaveLength(4);
      now += 1;
      frame([0, 3, 0.05]);
      expect(shown(stage.legs[0])).toEqual({ into: [true], ask: all(true, 2), through: all(true, 5), whole: false });
      expect(shown(stage.legs[1])).toEqual({ into: [true], ask: all(false, 2), through: all(false, 5), whole: true });
      expect(stage.legs.map((leg) => leg.restore.visible)).toEqual([false, true]);
      // Away from above and back: the leg counts as seen through again until the GPU tells otherwise.
      frame([2, 0.5, 1]);
      now += 1;
      frame([0, 3, 0.05]);
      expect(stage.legs.map((leg) => shown(leg).through)).toEqual([all(true, 5), all(true, 5)]);
    } finally {
      performance.now = realNow;
    }
    // A lost context takes the questions with it.
    stage.restore();
    frame([0, 3, 0.05]);
    expect(stage.legs.map((leg) => shown(leg).through)).toEqual([all(true, 5), all(true, 5)]);
  });

  it("keeps the leg's lid with the leg: where it stands, and where its top begins to fade", () => {
    const { stage } = buildStage();
    const leg = stage.legs[0];
    const rig = new LegRig(legModel().collision, stage);
    const matrix = new THREE.Matrix4().fromArray(rig.legs[0].m);
    expect(matrix.elements.slice(12, 15)).not.toEqual([0, 0, 0]);
    const back = leg.fabric.uRestFromWorld.value.clone().multiply(matrix);
    back.elements.forEach((value, i) => expect(value).toBeCloseTo(i % 5 === 0 ? 1 : 0, 9));
    // The line around the leg and its shadow on the other leg go by the same lid and the same fade.
    expect(leg.outlineUniforms.uRestFromWorld).toBe(leg.fabric.uRestFromWorld);
    expect(leg.outlineUniforms.uLidR).toBe(leg.fabric.uLidR);
    expect(leg.caster.material.uniforms.uFadeStart).toBe(leg.fabric.uFadeStart);
    expect(leg.caster.material.uniforms.uFadeEnd).toBe(leg.fabric.uFadeEnd);
    // The shadow map holds where the leg is in the light's way (its depth) and how solid it is there (its color:
    // through every wall of the leg, the most solid one kept). The second pass rides along with the first.
    const cover = leg.caster.children[0] as StageLeg["stocking"];
    expect(leg.caster.children).toHaveLength(1);
    expect(cover.geometry).toBe(leg.caster.geometry);
    expect(cover.material.uniforms).toBe(leg.caster.material.uniforms);
    expect([leg.caster.material.colorWrite, leg.caster.material.depthWrite]).toEqual([false, true]);
    expect([cover.material.colorWrite, cover.material.depthTest, cover.material.depthWrite]).toEqual([
      true,
      false,
      false,
    ]);
    expect([cover.material.blending, cover.material.blendEquation]).toEqual([THREE.CustomBlending, THREE.MaxEquation]);
    expect([cover.material.blendSrc, cover.material.blendDst]).toEqual([THREE.OneFactor, THREE.OneFactor]);
    expect([cover.material.vertexShader, cover.material.fragmentShader]).toEqual([
      CASTER_VERTEX_SHADER,
      CASTER_COVER_FRAGMENT_SHADER,
    ]);
    // Each leg reads the other leg's map: its depth and its color.
    const other = stage.legs[1];
    expect(leg.fabric.uCastShadowCover.value).toBe(leg.fabric.uCastShadowMap.value!.renderTarget!.texture);
    expect(other.fabric.uCastShadowCover.value).not.toBe(leg.fabric.uCastShadowCover.value);
    // Tights fade out lower than stockings do: another outline.
    const stockings = { center: leg.fabric.uLidC.value.toArray(), radii: leg.fabric.uLidR.value };
    expect(stockings.radii).toHaveLength(32);
    stage.setStocking(0, resolveLegLook({ length: "tights" }));
    expect(leg.fabric.uFadeStart.value).toBe(0.7);
    expect(leg.fabric.uLidR.value).not.toEqual(stockings.radii);
    stage.setStocking(0, resolveLegLook({ length: "knee" }));
    expect(leg.fabric.uLidR.value).toBe(stockings.radii);
    expect(leg.fabric.uLidC.value.toArray()).toEqual(stockings.center);
  });

  it("draws the front leg last in both the scene and the mirror", () => {
    const { stage } = buildStage();
    stage.setOrder(1);
    expect(stage.legs.map((leg) => [leg.group.renderOrder, leg.mirror.renderOrder])).toEqual([
      [10, 10],
      [20, 20],
    ]);
  });
});

describe("aimLights", () => {
  it("rotates the key and rim lights around the vertical by the yaw", () => {
    const { stage } = buildStage();
    const light = stage.uniforms.light;
    stage.aimLights(0);
    const key0 = light.uKeyDir.value.clone();
    expect(key0.toArray()).toEqual(new THREE.Vector3(-0.55, 0.78, 0.42).normalize().toArray());
    stage.aimLights(Math.PI / 2);
    expect(light.uKeyDir.value.y).toBeCloseTo(key0.y, 12);
    expect(light.uKeyDir.value.x).toBeCloseTo(key0.z, 12);
    expect(light.uKeyDir.value.z).toBeCloseTo(-key0.x, 12);
    // positive tilt is ignored
    stage.aimLights(0.3, 0.5);
    const untilted = light.uKeyDir.value.clone();
    stage.aimLights(0.3);
    expect(light.uKeyDir.value.toArray()).toEqual(untilted.toArray());
  });

  it("tips the lights over when the view tilts below the horizon", () => {
    const { stage } = buildStage();
    const light = stage.uniforms.light;
    stage.aimLights(0.3, -0.5);
    expect(light.uKeyDir.value.length()).toBeCloseTo(1, 12);
    expect(
      digestRounded([...light.uKeyDir.value.toArray(), ...light.uRimDir.value.toArray()], 9),
    ).toMatchInlineSnapshot(`"65a95832"`);
  });
});

describe("bakeShadow", () => {
  function riggedStage() {
    const fixture = buildStage();
    const rig = new LegRig(legModel().collision, fixture.stage);
    return { ...fixture, rig, names: namesFor(fixture.stage) };
  }

  it("bakes floor, contact and leg-on-leg shadows once, then restores the clear color", () => {
    const { stage, renderer, names } = riggedStage();
    renderer.reset();
    stage.bakeShadow();
    expect(describeCalls(renderer.calls, names)).toMatchInlineSnapshot(`
      [
        "clearColor #000000 1",
        "bind floorShadowRT",
        "clear floorShadowRT",
        "render shadowScene with OrthographicCamera -> floorShadowRT",
        "bind target(640x640)",
        "clear target(640x640)",
        "render Scene with OrthographicCamera -> target(640x640)",
        "bind floorShadowRT",
        "clear floorShadowRT",
        "render Scene with OrthographicCamera -> floorShadowRT",
        "bind contactRT",
        "clear contactRT",
        "render shadowScene with OrthographicCamera -> contactRT",
        "bind target(640x640)",
        "clear target(640x640)",
        "render Scene with OrthographicCamera -> target(640x640)",
        "bind contactRT",
        "clear contactRT",
        "render Scene with OrthographicCamera -> contactRT",
        "bind castRT0",
        "clear castRT0",
        "render castScene0 with OrthographicCamera -> castRT0",
        "bind castRT1",
        "clear castRT1",
        "render castScene1 with OrthographicCamera -> castRT1",
        "bind screen",
        "clearColor #f2eef3 1",
      ]
    `);
    expect(renderer.clearColor.getHex()).toBe(0xf2eef3);
    expect(renderer.clearAlpha).toBe(1);
    expect(renderer.target).toBeNull();
  });

  it("bakes every shadow again after the WebGL context was lost and given back, light unchanged", () => {
    const { stage, renderer } = riggedStage();
    stage.bakeShadow();
    renderer.reset();
    stage.bakeShadow();
    expect(renderer.calls).toEqual([]);
    // The floor's shadow, the contact shadow (otherwise baked once) and the legs' shadows on each other.
    stage.restore();
    expect(renderer.ops("render")).toHaveLength(3 + 3 + 2);
    expect(renderer.target).toBeNull();
  });

  it("skips rebaking for the same light unless forced, and redoes contact shadows only when forced", () => {
    const { stage, renderer } = riggedStage();
    stage.bakeShadow();
    renderer.reset();
    stage.bakeShadow();
    expect(renderer.calls).toEqual([]);
    stage.bakeShadow(true);
    expect(renderer.ops("render")).toHaveLength(3 + 3 + 2);
    renderer.reset();
    stage.aimLights(0.4);
    stage.bakeShadow();
    // floor shadow (projection + two blur passes) and both casters; no contact shadow
    expect(renderer.ops("render")).toHaveLength(3 + 2);
  });

  it("projects the floor shadow along the key light, clamped to a minimum elevation", () => {
    const { stage } = riggedStage();
    const proj = stage.legs[0].shadow.material.uniforms.uProjDir;
    stage.bakeShadow();
    expect(proj.value.toArray()).toEqual([0, 1, 0]);
    // the contact pass ran last; force a floor-only pass for a high light
    stage.aimLights(0);
    stage.bakeShadow();
    expect(proj.value.toArray()).toEqual(stage.uniforms.light.uKeyDir.value.toArray());
    stage.aimLights(0, -1.2);
    const key = stage.uniforms.light.uKeyDir.value;
    expect(key.y).toBeLessThan(0.45);
    stage.bakeShadow();
    expect(proj.value.y).toBe(0.45);
    expect(proj.value.length()).toBeCloseTo(1, 12);
    expect(proj.value.x / proj.value.z).toBeCloseTo(key.x / key.z, 12);
  });

  it("projects straight down for a light right overhead below the minimum elevation", () => {
    const { stage } = riggedStage();
    stage.bakeShadow();
    stage.uniforms.light.uKeyDir.value.set(0, 0.2, 0);
    stage.bakeShadow();
    expect(stage.legs[0].shadow.material.uniforms.uProjDir.value.toArray()).toEqual([0, 0.45, 0]);
  });

  it("fits the leg shadow camera around the cast points", () => {
    const { stage } = riggedStage();
    stage.bakeShadow();
    const [a, b] = stage.legs;
    expect(a.fabric.uCastShadowStrength.value).toBe(1);
    expect(b.fabric.uCastShadowStrength.value).toBe(1);
    expect(digestRounded(a.fabric.uCastShadowMatrix.value.elements, 7)).toMatchInlineSnapshot(`"ef180b12"`);
  });

  it("weights each leg's received shadow by the other leg's opacity", () => {
    const { stage } = riggedStage();
    stage.setLegOpacity(0, 0.4);
    stage.bakeShadow();
    expect(stage.legs[0].fabric.uCastShadowStrength.value).toBe(1);
    expect(stage.legs[1].fabric.uCastShadowStrength.value).toBe(0.4);
  });

  it("drops leg-on-leg shadows when only one leg is shown", () => {
    const { stage, renderer, rig } = riggedStage();
    rig.setPose("single", { instant: true });
    renderer.reset();
    stage.bakeShadow(true);
    expect(stage.legs.map((leg) => leg.fabric.uCastShadowStrength.value)).toEqual([0, 0]);
    expect(renderer.ops("render")).toHaveLength(6);
  });

  it("does not render casters before any cast points are known", () => {
    const { stage, renderer } = buildStage();
    stage.bakeShadow();
    expect(renderer.ops("render").map((call) => call.target?.width)).toEqual([640, 640, 640, 640, 640, 640]);
    stage.setCastPoints([]);
    stage.bakeShadow(true);
    expect(renderer.ops("render")).toHaveLength(12);
  });
});

describe("floor shadow rect", () => {
  const DEFAULT_RECT = [-0.65, -0.72, 1.3, 1.3];

  /** A rigged stage that records the floor camera bounds and blur step of every floor shadow pass. */
  function recordingStage() {
    const passes: { target: string; bounds?: number[]; blur?: number[] }[] = [];
    const fixture = buildStage({
      onRender: (scene, cam, target) => {
        const name =
          target === stage.uniforms.floor.uFloorShadow.value.renderTarget
            ? "shadow"
            : target === stage.uniforms.floor.uContactShadow.value.renderTarget
              ? "contact"
              : "";
        if (scene === stage.shadowScene && name) {
          const ortho = cam as THREE.OrthographicCamera;
          passes.push({ target: name, bounds: [ortho.left, ortho.right, ortho.top, ortho.bottom] });
        } else if (name || target?.width === 640) {
          const blur = (scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material;
          passes.push({ target: name || "temp", blur: blur.uniforms.uBlurStep.value.toArray() });
        }
      },
    });
    const { stage } = fixture;
    const rig = new LegRig(legModel().collision, stage);
    return { ...fixture, rig, passes };
  }

  /** Each axis point's shadow on the floor along `dir`, as the projection shader computes it. */
  const projected = (rig: LegRig, dir: THREE.Vector3) =>
    rig.legs
      .flatMap((leg) => leg.axis)
      .map(([x, y, z]) => [x - (dir.x * y) / Math.max(dir.y, 0.2), z - (dir.z * y) / Math.max(dir.y, 0.2)]);

  it("keeps the default rect, camera and blur while the shadow fits in it", () => {
    const { stage, passes } = recordingStage();
    stage.aimLights(0.282, 0.737);
    stage.setCastPoints(
      [
        [0.1, 0.3, 0],
        [-0.1, 0.05, 0.1],
      ],
      [0.08, 0.1],
    );
    stage.bakeShadow(true);
    expect(stage.uniforms.floor.uShadowRect.value.toArray()).toEqual(DEFAULT_RECT);
    expect(stage.uniforms.floor.uContactRect.value.toArray()).toEqual(DEFAULT_RECT);
    const defaultBounds = [-0.65, 0.65, 0.72, -0.58];
    expect(passes.filter((pass) => pass.bounds).map((pass) => pass.bounds!.map((v) => +v.toFixed(9)))).toEqual([
      defaultBounds,
      defaultBounds,
    ]);
    expect(passes.find((pass) => pass.target === "temp")?.blur).toEqual([1.7 / 640, 0]);
  });

  it.each([0.62, 0.697, -0.368])("grows to hold the whole thigh shadow when the light turns (yaw %s)", (yaw) => {
    const { stage, rig, passes } = recordingStage();
    stage.bakeShadow();
    stage.aimLights(yaw, 0.55);
    passes.length = 0;
    stage.bakeShadow();
    const rect = stage.uniforms.floor.uShadowRect.value;
    const dir = stage.legs[0].shadow.material.uniforms.uProjDir.value;
    expect(rect.z).toBeGreaterThan(1.3);
    expect(rect.w).toBe(rect.z);
    // Every projected axis point, with room for the thigh around it, lies inside the new rect...
    const room = 0.14 * Math.hypot(1, Math.max(Math.abs(dir.x), Math.abs(dir.z)) / dir.y);
    for (const [x, z] of projected(rig, dir).slice(0, 2)) {
      expect(x - room).toBeGreaterThanOrEqual(rect.x - 1e-12);
      expect(x + room).toBeLessThanOrEqual(rect.x + rect.z + 1e-12);
      expect(z - room).toBeGreaterThanOrEqual(rect.y - 1e-12);
      expect(z + room).toBeLessThanOrEqual(rect.y + rect.w + 1e-12);
    }
    for (const [x, z] of projected(rig, dir)) {
      expect(x).toBeGreaterThan(rect.x);
      expect(x).toBeLessThan(rect.x + rect.z);
      expect(z).toBeGreaterThan(rect.y);
      expect(z).toBeLessThan(rect.y + rect.w);
    }
    // ...which still contains the default rect.
    expect(rect.x).toBeLessThanOrEqual(-0.65 + 1e-12);
    expect(rect.y).toBeLessThanOrEqual(-0.72 + 1e-12);
    expect(rect.x + rect.z).toBeGreaterThanOrEqual(0.65 - 1e-12);
    expect(rect.y + rect.w).toBeGreaterThanOrEqual(0.58 - 1e-12);
    // The shadow pass renders exactly that rect, with the blur scaled to stay the same on the floor.
    expect(passes[0].bounds).toEqual([rect.x, rect.x + rect.z, -rect.y, -(rect.y + rect.w)]);
    expect(passes[1].blur![0]).toBeCloseTo(((1.7 / 640) * 1.3) / rect.z, 12);
    // The contact map keeps its own fixed rect.
    expect(stage.uniforms.floor.uContactRect.value.toArray()).toEqual(DEFAULT_RECT);
    stage.bakeShadow(true);
    expect(passes.find((pass) => pass.target === "contact" && pass.bounds)?.bounds?.map((v) => +v.toFixed(9))).toEqual([
      -0.65, 0.65, 0.72, -0.58,
    ]);
  });

  it("sizes the room around each point by its radius, defaulting to the thigh radius", () => {
    const { stage } = recordingStage();
    stage.aimLights(0.697, 0.55);
    const rectFor = (radii?: number[]) => {
      stage.setCastPoints([[0, 0.85, 0.03]], radii);
      stage.bakeShadow(true);
      return stage.uniforms.floor.uShadowRect.value.toArray();
    };
    const thin = rectFor([0.02]);
    const thick = rectFor([0.14]);
    expect(thick[2]).toBeGreaterThan(thin[2]);
    expect(rectFor()).toEqual(thick);
  });

  it("never reaches past the floor disc, however low the light", () => {
    const { stage } = recordingStage();
    stage.bakeShadow();
    stage.uniforms.light.uKeyDir.value.set(-1, 0.05, 0.1).normalize();
    stage.bakeShadow();
    const rect = stage.uniforms.floor.uShadowRect.value;
    expect(rect.z).toBeLessThanOrEqual(3.2);
    expect(rect.x).toBeGreaterThanOrEqual(-1.6);
    expect(rect.y).toBeGreaterThanOrEqual(-1.6);
    expect(rect.x + rect.z).toBeLessThanOrEqual(1.6 + 1e-12);
    expect(rect.y + rect.w).toBeLessThanOrEqual(1.6 + 1e-12);
    // Once the shadow fits again, the default rect comes back.
    stage.setCastPoints([[0, 0.1, 0]], [0.05]);
    stage.aimLights(0.282, 0.737);
    stage.bakeShadow(true);
    expect(rect.toArray()).toEqual(DEFAULT_RECT);
  });
});

describe("renderMirror", () => {
  it("is skipped when the scene has no mirror floor or the camera is at floor level", () => {
    const { stage, renderer } = buildStage();
    const cam = camera();
    expect(stage.renderMirror(cam)).toBe(false);
    stage.setScene("bath");
    cam.position.y = 0.02;
    expect(stage.renderMirror(cam)).toBe(false);
    expect(renderer.calls).toEqual([]);
  });

  it("renders the mirrored legs with flipped light directions, then restores everything", () => {
    const seen: number[][] = [];
    const { stage, renderer } = buildStage({
      onRender: () => {
        const light = stage.uniforms.light;
        seen.push([
          light.uMirrorFlipY.value,
          light.uMirrorFalloff.value,
          light.uKeyDir.value.y,
          stage.legs[0].fabric.uCastShadowMatrix.value.elements[5],
        ]);
      },
    });
    const names = namesFor(stage);
    stage.setScene("street");
    stage.aimLights(0.2);
    const light = stage.uniforms.light;
    const before = [light.uKeyDir, light.uRimDir, light.uRim2Dir, light.uEnvADir, light.uEnvBDir].map((u) =>
      u.value.toArray(),
    );
    const castBefore = [...stage.legs[0].fabric.uCastShadowMatrix.value.elements];
    renderer.setClearColor(0x112233, 0.5);
    renderer.reset();
    expect(stage.renderMirror(camera())).toBe(true);
    expect(describeCalls(renderer.calls, names)).toEqual([
      "clearColor #000000 0",
      "bind mirrorRT",
      "clear mirrorRT",
      "render mirrorScene with PerspectiveCamera -> mirrorRT",
      "bind screen",
      "clearColor #112233 0.5",
    ]);
    expect(seen).toEqual([[-1, SCENES.street.floor.mirrorFall, -before[0][1], -castBefore[5]]]);
    expect(
      [light.uKeyDir, light.uRimDir, light.uRim2Dir, light.uEnvADir, light.uEnvBDir].map((u) => u.value.toArray()),
    ).toEqual(before);
    expect([...stage.legs[0].fabric.uCastShadowMatrix.value.elements]).toEqual(castBefore);
    expect([light.uMirrorFlipY.value, light.uMirrorFalloff.value]).toEqual([1, 0]);
  });

  it("can be switched off and on, also across scene changes", () => {
    const { stage } = buildStage();
    const strength = stage.uniforms.floor.uMirrorStrength;
    stage.setScene("pool");
    expect(strength.value).toBe(SCENES.pool.floor.mirror);
    stage.setMirror(false);
    expect(strength.value).toBe(0);
    expect(stage.renderMirror(camera())).toBe(false);
    stage.setScene("bath");
    expect(strength.value).toBe(0);
    stage.setMirror(true);
    expect(strength.value).toBe(SCENES.bath.floor.mirror);
    expect(stage.renderMirror(camera())).toBe(true);
  });
});

describe("resizeMirror and blit", () => {
  it("scales the mirror target, remembering the scale and keeping at least 4 pixels", () => {
    const { stage } = buildStage();
    const target = stage.uniforms.floor.uMirror.value.renderTarget!;
    stage.resizeMirror(1001, 600);
    expect([target.width, target.height]).toEqual([501, 300]);
    stage.resizeMirror(1000, 600, 0.34);
    expect([target.width, target.height]).toEqual([340, 204]);
    stage.resizeMirror(500, 300);
    expect([target.width, target.height]).toEqual([170, 102]);
    stage.resizeMirror(2, 2);
    expect([target.width, target.height]).toEqual([4, 4]);
  });

  it("composites a color and depth texture with a fullscreen quad", () => {
    const { stage, renderer } = buildStage();
    const color = new THREE.Texture();
    const depth = new THREE.DepthTexture(4, 4);
    stage.blit(color, depth);
    const [call] = renderer.ops("render");
    expect(call.camera).toBeInstanceOf(THREE.OrthographicCamera);
    const quad = call.scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(quad.material.uniforms.uColorTex.value).toBe(color);
    expect(quad.material.uniforms.uDepthTex.value).toBe(depth);
    expect(quad.material.uniforms.uResolution.value).toBe(stage.viewport);
    expect(quad.material.depthFunc).toBe(THREE.AlwaysDepth);
    stage.blit(color, null);
    expect(quad.material.uniforms.uDepthTex.value).toBeNull();
  });
});

describe("cast shadow maps", () => {
  it("are cleared once at creation, so the shadow samplers always see valid depth textures", () => {
    const { stage, setupCalls } = buildStage();
    expect(describeCalls(setupCalls, namesFor(stage))).toEqual([
      "bind castRT0",
      "clear castRT0",
      "bind castRT1",
      "clear castRT1",
      "bind screen",
    ]);
  });
});

describe("warmScene while a compile is in flight", () => {
  it("returns the pending compile instead of resolving early", async () => {
    const { stage, renderer } = buildStage();
    let finish = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const compile = renderer.compileAsync!;
    renderer.compileAsync = (scene, cam) => compile(scene, cam).then((compiled) => gate.then(() => compiled));
    const first = stage.warmScene("street", camera());
    const second = stage.warmScene("street", camera());
    expect(second).toBe(first);
    expect(renderer.ops("compileAsync")).toHaveLength(1);
    let settled = false;
    void second.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await first;
    expect(settled).toBe(true);
    // Once compiled, warming again is immediate and does not compile.
    await stage.warmScene("street", camera());
    expect(renderer.ops("compileAsync")).toHaveLength(1);
  });
});
