import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DEFAULT_LEG_SPEC, PRESETS } from "../../../src/engine/catalog/presets";
import type { LegSpec } from "../../../src/engine/catalog/presets";
import { resolveLegLook } from "../../../src/engine/catalog/resolveLegLook";
import type { LegLook } from "../../../src/engine/catalog/resolveLegLook";
import { LegRig } from "../../../src/engine/rig/LegRig";
import { computeBowMatrix } from "../../../src/engine/stage/bow";
import type { Stage, StageLeg } from "../../../src/engine/stage/createStage";
import { BACKDROPS, BACKDROP_ORDER, SCENES, SCENE_ORDER, makeCustomBackdrop } from "../../../src/engine/stage/scenes";
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
    cuff: f.uCuffStyle.value,
    band: f.uBand.value,
    garter: f.uGarter.value,
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
    cuff: look.cuff,
    band: look.band,
    garter: look.garter,
    print: look.print,
    fade0: look.fade0,
    fade1: look.fade1,
  });
  const secret = new THREE.Color(look.secretColor);
  // createStage starts with an all-zero secret; setStocking fills in the color
  expect(vec(f.uSecret.value)).toEqual(initial ? [0, 0, 0, 0] : [secret.r, secret.g, secret.b, look.secret]);
  for (const part of leg.skinParts) {
    expect(part.visible).toBe(look.skinVisible);
  }
}

describe("createStage construction", () => {
  const { stage, contexts } = buildStage();

  it("assembles backdrop, floor and two legs with depth, color, outline and bow passes", () => {
    expect(stage.scene.children.map((child) => child.type)).toEqual(["Mesh", "Mesh", "Group", "Group"]);
    expect(stage.scene.children[0].renderOrder).toBe(-10);
    expect(stage.floor.renderOrder).toBe(-5);
    expect(stage.floor.geometry.parameters).toMatchObject({ radius: 1.6, segments: 96 });
    for (const leg of stage.legs) {
      expect(leg.group.children.map((mesh) => mesh.renderOrder)).toEqual([0, 1, 0, 1, 2, 2, 1.5]);
      expect(leg.matrix).toBe(leg.group.matrix);
      expect(leg.group.matrixAutoUpdate).toBe(false);
      expect(leg.mirror.children).toHaveLength(4);
      expect(leg.skinParts).toHaveLength(5);
      expect(leg.bow.visible).toBe(false);
      expect(leg.castScene.children).toEqual([leg.caster]);
    }
    expect(stage.shadowScene.children).toEqual([stage.legs[0].shadow, stage.legs[1].shadow]);
    expect(stage.legs.map((leg) => leg.group.renderOrder)).toEqual([20, 10]);
  });

  it("draws the stocking passes from the fine mesh and the mirror and shadow from the coarse one", () => {
    const model = legModel();
    const leg = stage.legs[0];
    expect(leg.stocking.geometry).toBe(model.stocking);
    expect(leg.skin.geometry).toBe(model.skin);
    expect(leg.mirror.children.map((mesh) => (mesh as THREE.Mesh).geometry)).toEqual([
      model.stockingLow,
      model.stockingLow,
      model.skin,
      model.skin,
    ]);
    expect(leg.shadow.geometry).toBe(model.stockingLow);
    expect(leg.stocking.material.depthFunc).toBe(THREE.EqualDepth);
    expect(leg.skin.material.polygonOffset).toBe(true);
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
    expect(a.skin.material.uniforms.uIsSkin.value).toBe(1);
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
      ? preset.legs.map((spec, i): [string, Partial<LegSpec>] => [`${preset.name} #${i}`, spec])
      : [[preset.name, preset.both ?? {}] satisfies [string, Partial<LegSpec>]],
  );

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
    expect(stage.legs[0].skinParts.every((part) => part.visible)).toBe(true);
    const positions = legModel().stocking.getAttribute("position");
    let lowest = Infinity;
    for (let i = 0; i < positions.count; i++) {
      lowest = Math.min(lowest, positions.getY(i));
    }
    // The cuff shader decorates up to 7.5 cm below the cuff line and bulges the mesh around it.
    expect(stage.legs[0].fabric.uCuffY.value).toBeLessThan(lowest - 0.1);
  });

  it("hides every skin part for tights and shows them again for stockings", () => {
    const { stage } = buildStage();
    stage.setStocking(0, resolveLegLook({ length: "tights" }));
    expect(stage.legs[0].skinParts.every((part) => !part.visible)).toBe(true);
    expect(stage.legs[1].skinParts.every((part) => part.visible)).toBe(true);
    stage.setStocking(0, resolveLegLook({ length: "knee" }));
    expect(stage.legs[0].skinParts.every((part) => part.visible)).toBe(true);
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
    stage.setLegOpacity(1, 0.003);
    expect([leg.group.visible, leg.mirror.visible, leg.shadow.visible]).toEqual([false, false, false]);
    expect(leg.outlineUniforms.uOpacity.value).toBe(0.003);
    expect(stage.legs[0].group.visible).toBe(true);
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
    expect(digestRounded(a.fabric.uCastShadowMatrix.value.elements, 7)).toMatchInlineSnapshot(`"e26875fa"`);
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
    expect(rect.x).toBeLessThanOrEqual(-0.65);
    expect(rect.y).toBeLessThanOrEqual(-0.72);
    expect(rect.x + rect.z).toBeGreaterThanOrEqual(0.65);
    expect(rect.y + rect.w).toBeGreaterThanOrEqual(0.58);
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
