/**
 * Builds materials, meshes and render passes (depth prepass + EqualDepth color, mirrored floor reflection,
 * baked floor shadows, leg-on-leg shadow maps) and returns the stage API.
 */
import * as THREE from "three";
import { DEFAULT_LEG_SPEC } from "../catalog/presets";
import { resolveLegLook } from "../catalog/resolveLegLook";
import type { LegLook } from "../catalog/resolveLegLook";
import { UNDER_FIT, frontOfJoin } from "../model/forefoot";
import type { ToeNail } from "../model/forefoot";
import type { LegModel } from "../model/legModel";
import type { Vec3 } from "../rig/joints";
import type { LegRigTarget } from "../rig/LegRig";
import type { LegPose } from "../rig/skinning";
import { createBowGeometry } from "./bow";
import { BACKDROPS, SCENES, makeCustomBackdrop, studioEnv, studioRimTint } from "./scenes";
import type { BackdropDef, SceneDef } from "./scenes";
import { BACKDROP_FRAGMENT_SHADER, BACKDROP_VERTEX_SHADER } from "./shaders/backdrop";
import { BOW_FRAGMENT_SHADER, BOW_VERTEX_SHADER } from "./shaders/bow";
import {
  FLOOR_FRAGMENT_SHADER,
  FLOOR_SHADOW_FRAGMENT_SHADER,
  FLOOR_SHADOW_VERTEX_SHADER,
  FLOOR_VERTEX_SHADER,
} from "./shaders/floor";
import { watchDrawn, type DrawnWatch } from "./drawn";
import { legLid, type LegLid } from "./lid";
import {
  ANKLE,
  ANKLE_BAND,
  LEG_DEPTH_FRAGMENT_SHADER,
  LEG_FRAGMENT_SHADER,
  LEG_VERTEX_SHADER,
  LID_BINS,
  fadeHeight,
  heightOfFade,
} from "./shaders/leg";
import { NAIL_COUNT } from "./shaders/foot";
import { OUTLINE_FRAGMENT_SHADER, OUTLINE_VERTEX_SHADER } from "./shaders/outline";
import {
  BLUR_FRAGMENT_SHADER,
  CASTER_COVER_FRAGMENT_SHADER,
  CASTER_FRAGMENT_SHADER,
  CASTER_VERTEX_SHADER,
  COMPOSITE_FRAGMENT_SHADER,
  FULLSCREEN_VERTEX_SHADER,
} from "./shaders/post";
import { createDecalAtlas, createKnitTexture, createLogoTexture } from "./textures";

type U<T> = THREE.IUniform<T>;

/** Shared by the backdrop and floor materials. */
export type BackdropUniforms = {
  uTopColor: U<THREE.Color>;
  uBottomColor: U<THREE.Color>;
  uGlowColor: U<THREE.Color>;
  uResolution: U<THREE.Vector2>;
  uBackdropTime: U<number>;
  uPixelAngle: U<number>;
  uFocusDist: U<number>;
  uRain: U<number>;
  uFloorFade: U<number>;
};

/** Scene lighting shared by the leg and bow materials. */
export type LightUniforms = {
  uKeyDir: U<THREE.Vector3>;
  uKeyColor: U<THREE.Color>;
  uRimDir: U<THREE.Vector3>;
  uRimColor: U<THREE.Color>;
  uFillTop: U<THREE.Vector3>;
  uFillBottom: U<THREE.Vector3>;
  uRim2Dir: U<THREE.Vector3>;
  uRim2Color: U<THREE.Color>;
  uEnvLo: U<THREE.Vector3>;
  uEnvHi: U<THREE.Vector3>;
  uEnvAColor: U<THREE.Vector3>;
  uEnvADir: U<THREE.Vector3>;
  uEnvBColor: U<THREE.Vector3>;
  uEnvBDir: U<THREE.Vector3>;
  uCaustic: U<number>;
  uMirrorFlipY: U<number>;
  uMirrorFalloff: U<number>;
};

/** Skin colors, knit/decal textures and the wet map, shared by both legs. */
export type FabricUniforms = {
  uSkinLit: U<THREE.Color>;
  uSkinShade: U<THREE.Color>;
  uSkinScatter: U<THREE.Color>;
  uKnitTex: U<THREE.Texture>;
  uKnitMean: U<number>;
  /** The toenails (see toeNailCoord in shaders/foot.ts). */
  uNailCenter: U<THREE.Vector4[]>;
  uNailForward: U<THREE.Vector4[]>;
  uNailNormal: U<THREE.Vector3[]>;
  uDecalAtlas: U<THREE.Texture>;
  uWetMap: U<THREE.Texture>;
  uTime: U<number>;
  uHighlightFalloff: U<number>;
};

export type FloorUniforms = BackdropUniforms & {
  uFloorShadow: U<THREE.Texture>;
  uContactShadow: U<THREE.Texture>;
  uPuddleTex: U<THREE.Texture>;
  /** Floor area (x, z, width, depth) covered by the key light shadow map; refitted to the shadow on each bake. */
  uShadowRect: U<THREE.Vector4>;
  /** Floor area covered by the contact shadow map; fixed. */
  uContactRect: U<THREE.Vector4>;
  uPuddleRect: U<THREE.Vector4>;
  uLogoTex: U<THREE.Texture>;
  uLogoRect: U<THREE.Vector4>;
  uFloorColor: U<THREE.Color>;
  uShadowColor: U<THREE.Color>;
  uSpotCenter: U<THREE.Vector2>;
  uRipples: U<THREE.Vector4[]>;
  uTime: U<number>;
  uMirror: U<THREE.Texture>;
  uMirrorStrength: U<number>;
  uPuddleLight: U<number>;
  uMarkColor: U<THREE.Vector4>;
};

/** Joint rotations consumed by LEG_SKINNING_GLSL. */
export type RigUniforms = {
  uToeRot: U<THREE.Matrix3>;
  uAnkleRot: U<THREE.Matrix3>;
  uKneeRot: U<THREE.Matrix3>;
  uRigOn: U<number>;
};

export type CastShadowUniforms = {
  uCastShadowMatrix: U<THREE.Matrix4>;
  uCastShadowTexel: U<number>;
};

/** Per-leg stocking look (see LegLook). */
export type StockingUniforms = CastShadowUniforms & {
  uDye: U<THREE.Color>;
  uDye2: U<THREE.Color>;
  uSheenColor: U<THREE.Color>;
  uStripe: U<number>;
  uShade: U<THREE.Vector3>;
  uThrough: U<number>;
  uSheenAmount: U<number>;
  uDenier: U<number>;
  uPattern: U<number>;
  uGloss: U<number>;
  uCuffY: U<number>;
  uHasCuff: U<number>;
  /** How much the cuff presses into the leg (0 or 1): the skin bulges above its edge and is drawn in below it. */
  uCuffBulge: U<number>;
  /** Which side of the forefoot's join this surface is drawn on (see forefootClipGlsl). */
  uClip: U<number>;
  /** 1 for skin seen through a stocking. */
  uUnder: U<number>;
  /** How much the forefoot's skin shows through the stocking as a surface of its own (0 to 1). */
  uOverlay: U<number>;
  uCuffStyle: U<number>;
  uBand: U<number>;
  uGarter: U<number>;
  uToe: U<number>;
  uPrint: U<number>;
  /** 1 for leg 0, -1 for leg 1. */
  uMirror: U<number>;
  uMatWet: U<THREE.Vector4>;
  uMatKnit: U<THREE.Vector4>;
  uSecret: U<THREE.Vector4>;
  uWetDye: U<THREE.Vector4>;
  uFadeStart: U<number>;
  uFadeEnd: U<number>;
  /** The leg's lid, for what the eye sees through the leg's own top (LID_GLSL). */
  uRestFromWorld: U<THREE.Matrix4>;
  uLidC: U<THREE.Vector2>;
  uLidR: U<number[]>;
  /** How far the eye looks into the leg from above (see lookInto): 0 not at all, 1 for all the inside shows. */
  uInto: U<number>;
  uOpacity: U<number>;
  uWetMapSlot: U<THREE.Vector2>;
  uCastShadowMap: U<THREE.DepthTexture | null>;
  uCastShadowCover: U<THREE.Texture>;
  uCastShadowStrength: U<number>;
};

export type OutlineUniforms = RigUniforms & {
  uResolution: U<THREE.Vector2>;
  uLineWidth: U<number>;
  uOutlineColor: U<THREE.Color>;
  uSkinOutlineColor: U<THREE.Color>;
  uCuffY: U<number>;
  uHasCuff: U<number>;
  uCuffBulge: U<number>;
  uClip: U<number>;
  uSilhouette: U<number>;
  uFadeStart: U<number>;
  uFadeEnd: U<number>;
  uRestFromWorld: U<THREE.Matrix4>;
  uLidC: U<THREE.Vector2>;
  uLidR: U<number[]>;
  uOpacity: U<number>;
};

export type BowUniforms = LightUniforms &
  RigUniforms & {
    uBowMatrix: U<THREE.Matrix4>;
    uBowColor: U<THREE.Color>;
    uBowShade: U<THREE.Vector3>;
    uCuffY: U<number>;
    uCuffBulge: U<number>;
    uFadeStart: U<number>;
    uFadeEnd: U<number>;
    uOpacity: U<number>;
  };

export type StageMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

/** Meshes and uniforms of one leg. */
export interface StageLeg {
  index: number;
  group: THREE.Group;
  /**
   * What is drawn after both legs, in groups that share the leg's matrix: the solid leg's depth again, the leg's
   * fading top and its inside (so that what lies behind them shows through them), and last the line around the
   * leg (see addSeenThrough and setOrder).
   */
  late: THREE.Group[];
  /** The one of them that draws the fading top, and the one for what of the solid leg is seen through it. */
  fadeGroup: THREE.Group;
  throughGroup: THREE.Group;
  /** The passes that draw the line around the leg's top while the leg is the one behind, and the one in front. */
  topLine: { behind: StageMesh[]; front: StageMesh[] };
  /** The solid leg's depth again: for the leg drawn first, which lost some to what of the other leg is gone. */
  restore: StageMesh;
  /** The passes drawn with the leg around the stocking's own (see orderStocking). */
  aroundStocking: StageMesh[];
  /**
   * The passes that draw the top of the stocking alone, the leg from the ankle down, or the leg above the ankle,
   * each from that part of its mesh.
   */
  topParts: StageMesh[];
  lowParts: StageMesh[];
  highParts: StageMesh[];
  /**
   * The passes drawn only while the eye looks into the leg, those drawn only while something of the solid leg is
   * seen through its top (which `gone` tells), the materials the solid leg's color is drawn with while nothing is
   * and while something is, and whether the one and the other are so (see lookInto).
   */
  intoParts: StageMesh[];
  throughParts: StageMesh[];
  /** The passes that find what of the solid leg is seen through its top, and whether they are drawn this time. */
  askParts: StageMesh[];
  ask: boolean;
  gone: DrawnWatch;
  solid: THREE.ShaderMaterial[];
  into: boolean;
  through: boolean;
  /** Whether the other leg is the one in front (see setOrder). */
  behind: boolean;
  /** Mirrored copy rendered into the floor reflection. */
  mirror: THREE.Group;
  rig: RigUniforms;
  fabric: StockingUniforms;
  outlineUniforms: OutlineUniforms;
  /** The stocking's color pass. */
  stocking: StageMesh;
  /** The stocking's depth and color passes, in the view and in the floor's reflection. */
  stockingParts: StageMesh[];
  /** What draws the cuff's press in the view: the stocking's passes and its outline (see setStocking). */
  cuffParts: StageMesh[];
  /**
   * The same passes for the stocking in front of the forefoot's join alone. While the forefoot's skin shows
   * through the fabric, the stocking is drawn in two parts: behind the join first, then the skin, then this
   * part over both, so the leg is also seen through the fabric that spans the gaps between the toes.
   */
  stockingFrontParts: StageMesh[];
  /** Whether the leg wears no stocking. */
  bare: boolean;
  /**
   * The forefoot's skin: whether it is seen through a stocking (1) or bare (0), its depth and color passes (in the
   * view and in the floor's reflection), and its line, drawn when bare.
   */
  forefootUnder: U<number>;
  forefootClip: U<number>;
  forefootParts: StageMesh[];
  /**
   * For a leg in a stocking: the passes that draw the forefoot's skin once more, bare, where it is right under
   * the nearest fabric. Elsewhere the skin is seen through another part of the fabric and wears its own (see
   * showForefoot).
   */
  forefootNearParts: StageMesh[];
  forefootOutline: StageMesh | null;
  shadow: StageMesh;
  caster: StageMesh;
  castScene: THREE.Scene;
  bow: StageMesh;
  bowU: BowUniforms;
  /** Same object as group.matrix. */
  matrix: THREE.Matrix4;
}

/** The stage API returned by createStage. */
export interface Stage extends LegRigTarget {
  scene: THREE.Scene;
  floor: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  legs: StageLeg[];
  uniforms: {
    light: LightUniforms;
    fabric: FabricUniforms;
    floor: FloorUniforms;
    bg: BackdropUniforms;
  };
  /** Switches scene (unknown keys fall back to studio) and returns its def. */
  setScene(sceneKey: string): SceneDef;
  /** Backdrop key, custom hex color or def. */
  setBackdrop(backdrop: string | BackdropDef): void;
  /** Precompiles a scene's materials; resolves immediately if already cached or unknown. */
  warmScene(sceneKey: string, camera: THREE.Camera): Promise<unknown>;
  /** Renders the floor reflection; false when skipped. */
  renderMirror(camera: THREE.Camera): boolean;
  resizeMirror(width: number, height: number, scale?: number): void;
  setMirror(enabled: boolean): void;
  lineWidth: U<number>;
  blank: THREE.DataTexture;
  readonly sceneNow: SceneDef;
  readonly backdropNow: BackdropDef;
  viewport: THREE.Vector2;
  ripples: THREE.Vector4[];
  setStocking(index: number, look: LegLook, bowMatrix?: ArrayLike<number> | null): void;
  setLegPose(index: number, pose: LegPose, matrix: ArrayLike<number>): void;
  setLegOpacity(index: number, opacity: number): void;
  setOrder(frontIndex: number): void;
  /** Leg axis points for shadow fitting, with the leg radius around each (default: the thigh radius). */
  setCastPoints(points: Iterable<Vec3>, radii?: ArrayLike<number>): void;
  aimLights(yaw: number, tilt?: number): void;
  bakeShadow(force?: boolean): void;
  /** After the WebGL context was lost and given back: draws again what the stage draws only now and then. */
  restore(): void;
  shadowScene: THREE.Scene;
  blit(colorTexture: THREE.Texture, depthTexture: THREE.Texture | null): void;
}

/** How many pixels' worth of its slope the depth of what is seen through is laid down nearer (see there). */
const SEEN_THROUGH_PULL = 4;

/** Render orders of the groups drawn after both legs (10 and 20), in this order (see setOrder). */
const LATE_ORDER = {
  restore: 25,
  line: 27,
  fadeFirst: 30,
  topLine: 32,
  fadeSecond: 40,
  inside: 45,
  throughFirst: 46,
  throughSecond: 48,
  last: 50,
};

/**
 * The leg from the ankle down, drawn in a pass of its own (see addSeenThrough), reaches up to the top of the band
 * above the ankle. Its mesh takes in the triangles that reach below this height at rest, and the mesh of the leg
 * above it those that reach above HIGH_FROM: they overlap, and the shaders draw the line between them.
 */
const LOW_TO = ANKLE + ANKLE_BAND + 0.01;

const HIGH_FROM = ANKLE + ANKLE_BAND - 0.01;

/**
 * How steeply the eye has to look down into a leg, as the sine of the angle between its line of sight to the
 * middle of the leg's top and the plane where the top begins to fade, for anything of the leg to be seen through
 * that top: from the first on, the inside begins to show, and from the second all of it (see lookInto).
 */
const INTO_FROM = [0.25, 0.35];

/**
 * How often (ms) a leg the eye looks into finds out whether anything of its solid surface is seen through its
 * top, while nothing is (see lookInto).
 */
const ASK_EVERY = 30;

/** The top of a stocking's mesh, where it fades out, begins above this height on the leg at rest. */
const TOP_FROM = 0.6;

const toColor = (hex: THREE.ColorRepresentation): THREE.Color => new THREE.Color(hex);

export function createStage(renderer: THREE.WebGLRenderer, model: LegModel): Stage {
  const mainScene = new THREE.Scene();
  const viewport = new THREE.Vector2(1, 1);
  const knitTexture = createKnitTexture(renderer);
  const blankTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blankTexture.needsUpdate = true;
  const backdropUniforms: BackdropUniforms = {
    uTopColor: {
      value: toColor("#f6f2f6"),
    },
    uBottomColor: {
      value: toColor("#e4dce8"),
    },
    uGlowColor: {
      value: toColor("#3a3438"),
    },
    uResolution: {
      value: viewport,
    },
    uBackdropTime: {
      value: 0,
    },
    uPixelAngle: {
      value: 0.001,
    },
    uFocusDist: {
      value: 2,
    },
    uRain: {
      value: 0,
    },
    uFloorFade: {
      value: 0,
    },
  };
  const lightUniforms: LightUniforms = {
    uKeyDir: {
      value: new THREE.Vector3(-0.5, 0.75, 0.45).normalize(),
    },
    uKeyColor: {
      value: toColor("#fffaf4"),
    },
    uRimDir: {
      value: new THREE.Vector3(0.75, 0.25, -0.6).normalize(),
    },
    uRimColor: {
      value: toColor("#d8e4ff"),
    },
    uFillTop: {
      value: new THREE.Vector3(1, 0.99, 1),
    },
    uFillBottom: {
      value: new THREE.Vector3(0.8, 0.76, 0.86),
    },
    uRim2Dir: {
      value: new THREE.Vector3(0, 0, 1),
    },
    uRim2Color: {
      value: toColor("#000000"),
    },
    uEnvLo: {
      value: new THREE.Vector3(0.55, 0.53, 0.62),
    },
    uEnvHi: {
      value: new THREE.Vector3(1.5, 1.48, 1.55),
    },
    uEnvAColor: {
      value: new THREE.Vector3(),
    },
    uEnvADir: {
      value: new THREE.Vector3(0, 1, 0),
    },
    uEnvBColor: {
      value: new THREE.Vector3(),
    },
    uEnvBDir: {
      value: new THREE.Vector3(0, 1, 0),
    },
    uCaustic: {
      value: 0,
    },
    uMirrorFlipY: {
      value: 1,
    },
    uMirrorFalloff: {
      value: 0,
    },
  };
  // The shader always loops over NAIL_COUNT nails; missing ones are parked far away.
  const nails: ToeNail[] = Array.from(
    { length: NAIL_COUNT },
    (_, i) => model.nails[i] ?? { center: [0, -9, 0], normal: [0, 1, 0], forward: [0, 0, 1], half: [1, 1] },
  );
  const fabricUniforms: FabricUniforms = {
    uSkinLit: {
      value: toColor("#ffebe3"),
    },
    uSkinShade: {
      value: toColor("#eec4bc"),
    },
    uSkinScatter: {
      value: toColor("#ffae9f"),
    },
    uKnitTex: {
      value: knitTexture,
    },
    uKnitMean: {
      value: knitTexture.userData.mean,
    },
    uNailCenter: {
      value: nails.map((nail) => new THREE.Vector4(...nail.center, 1 / nail.half[0])),
    },
    uNailForward: {
      value: nails.map((nail) => new THREE.Vector4(...nail.forward, 1 / nail.half[1])),
    },
    uNailNormal: {
      value: nails.map((nail) => new THREE.Vector3(...nail.normal)),
    },
    uDecalAtlas: {
      value: createDecalAtlas(renderer),
    },
    uWetMap: {
      value: blankTexture,
    },
    uTime: {
      value: 0,
    },
    uHighlightFalloff: {
      value: 0.94,
    },
  };
  const makeBackdropMaterial = (sceneId: number): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      vertexShader: BACKDROP_VERTEX_SHADER,
      fragmentShader: BACKDROP_FRAGMENT_SHADER,
      uniforms: backdropUniforms,
      defines: {
        SCENE: sceneId,
      },
      depthTest: false,
      depthWrite: false,
    });
  const backdropMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), makeBackdropMaterial(0));
  backdropMesh.frustumCulled = false;
  backdropMesh.renderOrder = -10;
  mainScene.add(backdropMesh);
  const floorMapSize = 640;
  const floorTargetOptions = {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  };
  const floorShadowTarget = new THREE.WebGLRenderTarget(floorMapSize, floorMapSize, floorTargetOptions);
  const floorContactTarget = new THREE.WebGLRenderTarget(floorMapSize, floorMapSize, floorTargetOptions);
  const blurTempTarget = new THREE.WebGLRenderTarget(floorMapSize, floorMapSize, floorTargetOptions);
  const floorMapRect = new THREE.Vector4(-0.65, -0.72, 1.3, 1.3);
  const ripples = Array.from(
    {
      length: 16,
    },
    () => new THREE.Vector4(0, 0, -10, 0),
  );
  const floorUniforms: FloorUniforms = {
    ...backdropUniforms,
    uFloorShadow: {
      value: floorShadowTarget.texture,
    },
    uContactShadow: {
      value: floorContactTarget.texture,
    },
    uPuddleTex: {
      value: blankTexture,
    },
    uShadowRect: {
      value: floorMapRect.clone(),
    },
    uContactRect: {
      value: floorMapRect,
    },
    uPuddleRect: {
      value: new THREE.Vector4(-0.4, -0.37, 0.8, 0.8),
    },
    uLogoTex: {
      value: createLogoTexture(renderer),
    },
    uLogoRect: {
      value: new THREE.Vector4(-0.15, 0.27, 0.3, 0.0375),
    },
    uFloorColor: {
      value: toColor("#ece4ee"),
    },
    uShadowColor: {
      value: toColor("#b7a6c4"),
    },
    uSpotCenter: {
      value: new THREE.Vector2(-0.005, 0.05),
    },
    uRipples: {
      value: ripples,
    },
    uTime: {
      value: 0,
    },
    uFloorFade: backdropUniforms.uFloorFade,
    uMirror: {
      value: blankTexture,
    },
    uMirrorStrength: {
      value: 0,
    },
    uPuddleLight: {
      value: 1,
    },
    uMarkColor: {
      value: new THREE.Vector4(0, 0, 0, 0.5),
    },
  };
  const makeFloorMaterial = (sceneId: number): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERTEX_SHADER,
      fragmentShader: FLOOR_FRAGMENT_SHADER,
      uniforms: floorUniforms,
      defines: {
        SCENE: sceneId,
      },
    });
  const floorMesh = new THREE.Mesh(new THREE.CircleGeometry(1.6, 96), makeFloorMaterial(0));
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.renderOrder = -5;
  mainScene.add(floorMesh);
  const shadowScene = new THREE.Scene();
  const shadowProjUniforms = {
    uProjDir: {
      value: new THREE.Vector3(),
    },
    uContactMode: {
      value: 0,
    },
  };
  const shadowMapSize = matchMedia("(pointer: coarse)").matches ? 640 : 1024;
  const castShadowUniforms: CastShadowUniforms = {
    uCastShadowMatrix: {
      value: new THREE.Matrix4(),
    },
    uCastShadowTexel: {
      value: 1 / shadowMapSize,
    },
  };
  const lightCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 6);
  const castTargets = [0, 1].map(() => {
    const depthTexture = new THREE.DepthTexture(shadowMapSize, shadowMapSize);
    depthTexture.compareFunction = THREE.LessEqualCompare;
    depthTexture.minFilter = depthTexture.magFilter = THREE.LinearFilter;
    return new THREE.WebGLRenderTarget(shadowMapSize, shadowMapSize, {
      depthTexture: depthTexture,
    });
  });
  // Each leg samples the other leg's map through a shadow sampler, even while only one leg is shown and the maps
  // are not rendered. Clear them once so they are always valid depth textures.
  {
    const prevTarget = renderer.getRenderTarget();
    for (const target of castTargets) {
      renderer.setRenderTarget(target);
      renderer.clear();
    }
    renderer.setRenderTarget(prevTarget);
  }
  const skinOutlineColor: U<THREE.Color> = {
    value: toColor("#a06a66"),
  };
  const lineWidth: U<number> = {
    value: 1.6,
  };
  const mirrorScene = new THREE.Scene();
  const flipYMatrix = new THREE.Matrix4().makeScale(1, -1, 1);
  const mirrorTarget = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
  });
  floorUniforms.uMirror.value = mirrorTarget.texture;
  const transparentOptions = {
    transparent: true,
  };
  const bowGeometry = createBowGeometry();
  /**
   * How far (along its normal) the fabric may be over the forefoot's skin for the skin to count as right under
   * it (m): twice the distance up to which skin counts as wearing the fabric over it.
   */
  const UNDER_NEAR = 2 * UNDER_FIT.worn;
  // A stocking with a cuff is drawn from the mesh that has rings of vertices around the cuff's height.
  const stockingFor = (look: LegLook): THREE.BufferGeometry =>
    (look.hasCuff && model.stockingAtCuff.get(look.cuffY)) || model.stocking;
  // A part of a stocking's mesh: the same vertices, and the triangles that reach above TOP_FROM (its top, where
  // it fades out), below LOW_TO (the leg from the ankle down, most of the mesh: the toes are fine work) or above
  // HIGH_FROM (the rest of it). The passes for those parts alone are drawn from them, so that they do not run
  // the whole leg through again.
  const partOf = (keep: (lowest: number, highest: number) => boolean, fromTop = false) => {
    const parts = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
    return (geometry: THREE.BufferGeometry): THREE.BufferGeometry => {
      let part = parts.get(geometry);
      if (!part) {
        part = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(geometry.attributes)) {
          part.setAttribute(name, attribute);
        }
        const position = geometry.attributes.position;
        const index = geometry.index!.array;
        const kept: { top: number; corners: number[] }[] = [];
        for (let i = 0; i < index.length; i += 3) {
          const heights = [position.getY(index[i]), position.getY(index[i + 1]), position.getY(index[i + 2])];
          if (keep(Math.min(...heights), Math.max(...heights))) {
            kept.push({ top: Math.max(...heights), corners: [index[i], index[i + 1], index[i + 2]] });
          }
        }
        if (fromTop) {
          kept.sort((a, b) => b.top - a.top);
        }
        part.setIndex(kept.flatMap((triangle) => triangle.corners));
        parts.set(geometry, part);
      }
      return part;
    };
  };
  const topOf = partOf((_lowest, highest) => highest > TOP_FROM);
  const bottomOf = partOf((lowest) => lowest < LOW_TO);
  // The leg above the ankle has its triangles from the top down: looking into a leg from above, which is when
  // its inside is drawn, the nearer of two walls behind each other is the higher one, and so is drawn first.
  const upperOf = partOf((_lowest, highest) => highest > HIGH_FROM, true);
  // The leg's outline where its top begins to fade, per height that begins at (see LID_GLSL).
  const lids = new Map<number, LegLid>();
  const lidAt = (fadeStart: number): LegLid => {
    let lid = lids.get(fadeStart);
    if (!lid) {
      lid = legLid(model.stocking.attributes.position.array, fadeStart, LID_BINS);
      lids.set(fadeStart, lid);
    }
    return lid;
  };
  const stockingFront = model.forefoot ? frontOfJoin(model.stocking) : null;
  const stockingLowFront = model.forefoot ? frontOfJoin(model.stockingLow) : null;
  function createLeg(index: number): StageLeg {
    const rigUniforms: RigUniforms = {
      uToeRot: {
        value: new THREE.Matrix3(),
      },
      uAnkleRot: {
        value: new THREE.Matrix3(),
      },
      uKneeRot: {
        value: new THREE.Matrix3(),
      },
      uRigOn: {
        value: 0,
      },
    };
    const defaultLook = resolveLegLook(DEFAULT_LEG_SPEC);
    const stockingUniforms: StockingUniforms = {
      uDye: {
        value: toColor(defaultLook.dye),
      },
      uDye2: {
        value: toColor(defaultLook.dye2),
      },
      uSheenColor: {
        value: toColor(defaultLook.sheen),
      },
      uStripe: {
        value: defaultLook.stripe,
      },
      uShade: {
        value: new THREE.Vector3(...defaultLook.shade),
      },
      uThrough: {
        value: defaultLook.through,
      },
      uSheenAmount: {
        value: defaultLook.sheenAmt,
      },
      uDenier: {
        value: defaultLook.denier,
      },
      uPattern: {
        value: defaultLook.pattern,
      },
      uGloss: {
        value: defaultLook.gloss,
      },
      uCuffY: {
        value: defaultLook.cuffY,
      },
      uHasCuff: {
        value: defaultLook.hasCuff,
      },
      uCuffBulge: {
        value: defaultLook.cuffPress,
      },
      uClip: {
        value: 0,
      },
      uUnder: {
        value: 0,
      },
      uOverlay: {
        value: 0,
      },
      uCuffStyle: {
        value: defaultLook.cuff,
      },
      uBand: {
        value: defaultLook.band,
      },
      uGarter: {
        value: defaultLook.garter,
      },
      uToe: {
        value: defaultLook.toe,
      },
      uPrint: {
        value: defaultLook.print,
      },
      uMirror: {
        value: index === 0 ? 1 : -1,
      },
      uMatWet: {
        value: new THREE.Vector4(...defaultLook.mat),
      },
      uMatKnit: {
        value: new THREE.Vector4(...defaultLook.mat2),
      },
      uSecret: {
        value: new THREE.Vector4(0, 0, 0, 0),
      },
      uWetDye: {
        value: new THREE.Vector4(0, 0, 0, 0),
      },
      uFadeStart: {
        value: defaultLook.fade0,
      },
      uFadeEnd: {
        value: defaultLook.fade1,
      },
      uRestFromWorld: {
        value: new THREE.Matrix4(),
      },
      uLidC: {
        value: new THREE.Vector2(...lidAt(defaultLook.fade0).center),
      },
      uLidR: {
        value: lidAt(defaultLook.fade0).radii,
      },
      uInto: {
        value: 1,
      },
      uOpacity: {
        value: 1,
      },
      uWetMapSlot: {
        value: new THREE.Vector2(0.5, index * 0.5),
      },
      uCastShadowMap: {
        value: castTargets[1 - index].depthTexture,
      },
      uCastShadowCover: {
        value: castTargets[1 - index].texture,
      },
      uCastShadowStrength: {
        value: 0,
      },
      ...castShadowUniforms,
    };
    // Every material of the leg shaders sets every uniform: they share one program, which keeps the last value
    // of a uniform a material leaves out.
    const surfaceUniforms = {
      ...lightUniforms,
      ...fabricUniforms,
      ...stockingUniforms,
      ...rigUniforms,
      uCover: { value: 0 },
      uTowardEye: { value: 0 },
    };
    const legGroup = new THREE.Group();
    legGroup.matrixAutoUpdate = false;
    mainScene.add(legGroup);
    // What is drawn after both legs, in this order (see addSeenThrough, addOutline and setOrder): the solid
    // legs' depth again, the lines around them, the leg's fading top (and the line around that of the leg
    // behind), its all but invisible inside, what of the solid leg is seen through its top, and last the depth
    // of the top with the line around that of the leg in front. They follow the leg's own group.
    const lateGroup = (renderOrder: number): THREE.Group => {
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      group.matrix = legGroup.matrix;
      group.renderOrder = renderOrder;
      mainScene.add(group);
      return group;
    };
    const lineGroup = lateGroup(LATE_ORDER.line);
    const fadeGroup = lateGroup(LATE_ORDER.fadeFirst);
    const topLineGroup = lateGroup(LATE_ORDER.topLine);
    const insideGroup = lateGroup(LATE_ORDER.inside);
    const lastGroup = lateGroup(LATE_ORDER.last);
    const restoreGroup = lateGroup(LATE_ORDER.restore);
    const throughGroup = lateGroup(LATE_ORDER.throughFirst);
    const addMesh = (
      geometry: THREE.BufferGeometry,
      material: THREE.ShaderMaterial,
      renderOrder: number,
    ): StageMesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      legGroup.add(mesh);
      return mesh;
    };
    // `under` pushes the surface back a little in depth, for the skin under the stocking: the forefoot, which is
    // a surface of its own a little inside the fabric. (By a fixed amount: a push that grew with the slope would
    // send skin seen at a glancing angle behind whatever is drawn before it, like the rest of its own leg.)
    // `extra` overrides uniforms for this surface alone.
    const addSurfacePasses = (
      geometry: THREE.BufferGeometry,
      isSkin: number,
      under: boolean,
      extra: Record<string, U<number>> = {},
    ): [StageMesh, StageMesh] => {
      const uniforms = {
        ...surfaceUniforms,
        uIsSkin: {
          value: isSkin,
        },
        ...extra,
      };
      const offsetOptions = under ? { polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: 2 } : {};
      const depthMesh = addMesh(
        geometry,
        new THREE.ShaderMaterial({
          vertexShader: LEG_VERTEX_SHADER,
          fragmentShader: LEG_DEPTH_FRAGMENT_SHADER,
          uniforms: uniforms,
          side: THREE.DoubleSide,
          colorWrite: false,
          ...transparentOptions,
          ...offsetOptions,
        }),
        0,
      );
      const colorMesh = addMesh(
        geometry,
        new THREE.ShaderMaterial({
          vertexShader: LEG_VERTEX_SHADER,
          fragmentShader: LEG_FRAGMENT_SHADER,
          uniforms: uniforms,
          side: THREE.DoubleSide,
          depthFunc: THREE.EqualDepth,
          depthWrite: false,
          ...transparentOptions,
          ...offsetOptions,
        }),
        1,
      );
      return [depthMesh, colorMesh];
    };
    // The leg's three bits in the stencil buffer: where its curtain hangs in front of what is there, where what
    // is there is the leg's own solid surface, which is gone (for both see addSeenThrough), and where its top
    // lies, for the line around that (see addOutline).
    const [curtainBit, goneBit, topBit] = [1 << (2 * index), 2 << (2 * index), 16 << index];
    const stencil = (
      ref: number,
      funcMask: number,
      writeMask = 0,
      func: THREE.StencilFunc = THREE.EqualStencilFunc,
    ): THREE.ShaderMaterialParameters => ({
      stencilWrite: true,
      stencilFunc: func,
      stencilRef: ref,
      stencilFuncMask: funcMask,
      stencilWriteMask: writeMask,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    // What of the leg is seen through: its fading top and its all but invisible inside. Drawn with the leg,
    // their depth kept what lies behind them from being drawn: the top faded to the backdrop, and the inside
    // cut holes into the other leg. So only what is solid is drawn with the leg, and they come after both legs:
    // the top as color alone, and the inside with a depth of its own first and its color where that is the
    // nearest (where two walls of it lie behind each other, one shows, not their sum).
    //
    // What of the solid leg the eye sees through the leg's own top is not drawn. The lid in the shaders tells as
    // much for most of it. What it cannot tell (what the eye sees through the top's side, under its rim where it
    // flares, and right along the rim) is left to the curtain: everything of the leg's top that is not solid
    // (the fading top, and the inside of the leg up there). Where that lies in front of the solid leg's depth, it
    // marks the pixel in the stencil buffer (`curtain`: the leg's first bit), and the solid leg's color is not
    // drawn there. Nor may its depth stay, or nothing behind it would show either: the solid leg marks where a
    // marked pixel's depth is its own (`gone`: the leg's second bit) and its depth is taken out there (`erase`:
    // drawn at the far end of the depth range). What lay behind it of the other leg lost its depth to it before:
    // after both legs the leg that was drawn first lays its depth down again (`restore`), but for what is gone.
    //
    // What is gone comes back after everything else of the legs, as much of it as the top it is seen through has
    // faded out: all of it through what is not there any more, nothing through the leg's inside or where the
    // fade begins, so the solid leg under a top that flares goes over into the fade without a step. Its depth is
    // laid down again, at the pixels of the second bit (`throughDepth`, which also sets the target's alpha to
    // one there). The curtain in front of that depth takes the alpha down to how much shows through each part of
    // it (`veil`: the least of them stays), and the color is drawn at that depth, weighed by the alpha
    // (`throughColor`).
    //
    // From the band above the ankle down the leg is drawn all the same (`low`): the foot is seen through its own
    // leg's top. So the stocking's own color pass draws the leg above that band alone.
    const addSeenThrough = ([depthMesh, colorMesh]: [StageMesh, StageMesh]) => {
      const variant = (
        source: StageMesh,
        defines: Record<string, number>,
        options: THREE.ShaderMaterialParameters = {},
      ): THREE.ShaderMaterial => {
        // The source's settings and its shaders, with the leg's own uniforms (not copies of them).
        const material = new THREE.ShaderMaterial();
        THREE.Material.prototype.copy.call(material, source.material);
        material.vertexShader = source.material.vertexShader;
        material.fragmentShader = source.material.fragmentShader;
        material.uniforms = source.material.uniforms;
        material.defines = defines;
        material.setValues(options);
        return material;
      };
      const add = (
        group: THREE.Group,
        material: THREE.ShaderMaterial,
        renderOrder: number,
        part: (geometry: THREE.BufferGeometry) => THREE.BufferGeometry = (geometry) => geometry,
      ): StageMesh => {
        const mesh: StageMesh = new THREE.Mesh(part(depthMesh.geometry), material);
        mesh.frustumCulled = false;
        mesh.renderOrder = renderOrder;
        group.add(mesh);
        return mesh;
      };
      // The line around the leg's top is these same faces, pushed out sideways by the line's width: next to each
      // other in depth, so that some of a line would come out in front of the face it should be hidden behind.
      // What is to hide it is laid down nearer by a few pixels' worth of the face's slope.
      const pulled = {
        polygonOffset: true,
        polygonOffsetFactor: -SEEN_THROUGH_PULL,
        polygonOffsetUnits: -SEEN_THROUGH_PULL,
      };
      const fadeZone = { FADE_ZONE: 1 };
      // The whole leg's color, for the floor's reflection: no curtain there.
      const whole = variant(colorMesh, {});
      colorMesh.material.defines = { HIGH_PART: 1 };
      colorMesh.geometry = upperOf(colorMesh.geometry);
      // The fading top as color alone: after both legs, and in the floor's reflection.
      const fade = variant(colorMesh, fadeZone, { depthFunc: THREE.LessEqualDepth });
      const low = variant(colorMesh, { LOW_PART: 1 });
      // The inside, in one pass that lays its depth down as it goes: its nearer walls come first (see upperOf),
      // so where two lie behind each other the farther one finds the nearer one's depth there and is left out.
      const inside = variant(
        colorMesh,
        { LEG_INSIDE: 1 },
        { ...pulled, depthFunc: THREE.LessEqualDepth, depthWrite: true },
      );
      const curtain = variant(
        depthMesh,
        { CURTAIN: 1 },
        {
          depthFunc: THREE.LessDepth,
          depthWrite: false,
          ...stencil(curtainBit, 0xff, curtainBit, THREE.AlwaysStencilFunc),
        },
      );
      colorMesh.material.setValues(stencil(0, curtainBit));
      const gone = variant(
        depthMesh,
        {},
        { depthFunc: THREE.EqualDepth, depthWrite: false, ...stencil(curtainBit | goneBit, curtainBit, goneBit) },
      );
      const erase = variant(
        depthMesh,
        { FAR_PLANE: 1 },
        { depthFunc: THREE.AlwaysDepth, ...stencil(goneBit, goneBit) },
      );
      const restore = variant(depthMesh, {}, stencil(0, goneBit));
      // Alpha alone: the color stays as it is.
      const alphaOnly = {
        colorWrite: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.ZeroFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.OneFactor,
      };
      const throughDepth = variant(
        depthMesh,
        {},
        { ...alphaOnly, blendDstAlpha: THREE.ZeroFactor, ...stencil(goneBit, goneBit) },
      );
      const veil = variant(
        depthMesh,
        { CURTAIN: 1, VEIL: 1 },
        {
          ...alphaOnly,
          blendEquationAlpha: THREE.MinEquation,
          blendDstAlpha: THREE.OneFactor,
          depthFunc: THREE.LessDepth,
          depthWrite: false,
          ...stencil(goneBit, goneBit),
        },
      );
      const throughColor = variant(
        colorMesh,
        { HIGH_PART: 1 },
        {
          blending: THREE.CustomBlending,
          blendEquation: THREE.AddEquation,
          blendSrc: THREE.DstAlphaFactor,
          blendDst: THREE.OneMinusDstAlphaFactor,
          blendSrcAlpha: THREE.ZeroFactor,
          blendDstAlpha: THREE.OneFactor,
          ...stencil(goneBit, goneBit),
        },
      );
      return {
        // With the leg (their order goes by the stocking's own passes: see orderStocking).
        low: add(legGroup, low, 0, bottomOf),
        curtain: add(legGroup, curtain, 0, topOf),
        // (What of the solid leg is seen through its top may be any of it above the ankle: the shin of a leg
        // that is bent, say.)
        gone: add(legGroup, gone, 0, upperOf),
        erase: add(legGroup, erase, 0, upperOf),
        // After both legs.
        restore: add(restoreGroup, restore, 0),
        fade: add(fadeGroup, fade, 0, topOf),
        inside: add(insideGroup, inside, 0, upperOf),
        through: [
          add(throughGroup, throughDepth, 0, upperOf),
          add(throughGroup, veil, 1, topOf),
          add(throughGroup, throughColor, 2, upperOf),
        ],
        // The leg's top, for the line around it (see addOutline): marked in the stencil buffer, and laid down as
        // depth after everything (the water in the air is drawn against that as well).
        topMark: add(
          topLineGroup,
          variant(
            depthMesh,
            { CURTAIN: 1 },
            { ...pulled, depthWrite: false, ...stencil(topBit, 0xff, topBit, THREE.AlwaysStencilFunc) },
          ),
          0,
          topOf,
        ),
        topDepth: add(lastGroup, variant(depthMesh, { CURTAIN: 1 }, pulled), 0, topOf),
        mirrored: [whole, fade],
        // The solid leg's color: all of it in one pass while nothing of it is seen through the leg's top, and
        // above the ankle alone, where the curtain leaves it, while something may be.
        solid: [whole, colorMesh.material],
      };
    };
    const outlineUniforms: OutlineUniforms = {
      uResolution: backdropUniforms.uResolution,
      uLineWidth: lineWidth,
      uOutlineColor: {
        value: toColor(defaultLook.outline),
      },
      uSkinOutlineColor: skinOutlineColor,
      uCuffY: stockingUniforms.uCuffY,
      uHasCuff: stockingUniforms.uHasCuff,
      uCuffBulge: stockingUniforms.uCuffBulge,
      // The stocking's line stops at the join on a bare leg only (see showForefoot).
      uClip: {
        value: 0,
      },
      uSilhouette: {
        value: 0,
      },
      uFadeStart: stockingUniforms.uFadeStart,
      uFadeEnd: stockingUniforms.uFadeEnd,
      uRestFromWorld: stockingUniforms.uRestFromWorld,
      uLidC: stockingUniforms.uLidC,
      uLidR: stockingUniforms.uLidR,
      uOpacity: stockingUniforms.uOpacity,
      ...rigUniforms,
    };
    // The line around a surface is drawn from its back faces, pushed out by the line's width: what shows of them
    // past the surface's edge is the line, and the surface's own depth hides the rest.
    //
    // The line around the stocking, which reaches the leg's top, comes after both legs, in two parts (`late`).
    // Around the solid leg (SOLID_LINE) it is drawn right after the solid legs and before anything that is seen
    // through, and lays down its depth: so it is seen through a fading top like the leg it goes around, the
    // top's color over it. What lies behind what is gone of the solid leg is not drawn (the second bit).
    //
    // Around the leg's top (TOP_LINE) it is drawn after the top's own depth, which hides what of it lies behind
    // the top. For the leg in front that is after everything, where that depth is laid down. The line around
    // the top of the leg behind is to show through the top of the leg in front, so it has to be drawn before
    // that one's color, when the depth of no top may be there yet: its top marks where it lies instead
    // (`topMark`: the leg's third bit) right after its color is drawn, and its line is drawn where that is not
    // set. Each leg has both, and setOrder picks.
    const addOutline = (
      geometry: THREE.BufferGeometry,
      isSkin: number,
      extra: Record<string, U<number>> = {},
      late?: {
        group: THREE.Group;
        renderOrder: number;
        defines: Record<string, number>;
        options: THREE.ShaderMaterialParameters;
      },
    ): StageMesh => {
      const mesh = addMesh(
        geometry,
        new THREE.ShaderMaterial({
          vertexShader: OUTLINE_VERTEX_SHADER,
          fragmentShader: OUTLINE_FRAGMENT_SHADER,
          uniforms: {
            ...outlineUniforms,
            uIsSkin: {
              value: isSkin,
            },
            ...extra,
          },
          defines: late?.defines ?? {},
          side: THREE.BackSide,
          ...transparentOptions,
          ...late?.options,
        }),
        late?.renderOrder ?? 2,
      );
      late?.group.add(mesh);
      return mesh;
    };
    // The stocking's mesh is the whole leg: above its cuff, and all over a bare leg, its passes draw the skin.
    const stockingPasses = addSurfacePasses(stockingFor(defaultLook), 0, false);
    const seenThrough = addSeenThrough(stockingPasses);
    const stockingOutline = addOutline(
      stockingFor(defaultLook),
      0,
      {},
      {
        group: lineGroup,
        renderOrder: 0,
        defines: { SOLID_LINE: 1 },
        options: stencil(0, goneBit),
      },
    );
    const topOutlines = [
      { group: topLineGroup, options: stencil(0, topBit) },
      { group: lastGroup, options: {} },
    ].map(({ group, options }) =>
      addOutline(
        topOf(stockingFor(defaultLook)),
        0,
        {},
        {
          group: group,
          renderOrder: 1,
          defines: { TOP_LINE: 1 },
          options: { depthWrite: false, ...options },
        },
      ),
    );
    // The skin of the forefoot, in front of the join only: under the stocking, or in place of the stocking
    // mesh's front on a bare leg, where it also gets a line around it (see showForefoot).
    const forefootUniforms = {
      uUnder: { value: 0 },
      uClip: { value: -1 },
      uCover: { value: 1 },
    };
    const forefootParts: StageMesh[] = model.forefoot
      ? addSurfacePasses(model.forefoot, 0, true, forefootUniforms)
      : [];
    const forefootOutline = model.forefoot
      ? addOutline(model.forefoot, 0, { uClip: forefootUniforms.uClip, uSilhouette: { value: 1 } })
      : null;
    const stockingFrontParts: StageMesh[] = stockingFront
      ? addSurfacePasses(stockingFront, 0, false, { uClip: { value: -1 } })
      : [];
    // The skin once more, bare, where it is right under the nearest fabric. To find where that is, the front of
    // the stocking is first drawn into the depth buffer alone, UNDER_NEAR further away than it is: that only
    // leaves the skin's own depth where the fabric lies that close over the nearest skin, and there the bare
    // skin is drawn.
    const forefootNearParts: StageMesh[] =
      model.forefoot && stockingFront
        ? [
            addMesh(
              stockingFront,
              new THREE.ShaderMaterial({
                vertexShader: LEG_VERTEX_SHADER,
                fragmentShader: LEG_DEPTH_FRAGMENT_SHADER,
                uniforms: {
                  ...surfaceUniforms,
                  uIsSkin: { value: 0 },
                  uClip: { value: -1 },
                  uTowardEye: { value: -UNDER_NEAR },
                },
                side: THREE.DoubleSide,
                colorWrite: false,
                ...transparentOptions,
              }),
              -2.5,
            ),
            addMesh(
              model.forefoot,
              new THREE.ShaderMaterial({
                vertexShader: LEG_VERTEX_SHADER,
                fragmentShader: LEG_FRAGMENT_SHADER,
                uniforms: {
                  ...surfaceUniforms,
                  uIsSkin: { value: 0 },
                  uUnder: forefootUniforms.uUnder,
                  // Up to the join only: behind it the stocking is the nearest fabric, and paints its own skin.
                  uClip: { value: -1 },
                },
                side: THREE.DoubleSide,
                depthFunc: THREE.EqualDepth,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: 0,
                polygonOffsetUnits: 2,
                ...transparentOptions,
              }),
              -2,
            ),
          ]
        : [];
    if (stockingFrontParts.length) {
      stockingFrontParts[0].renderOrder = -1;
    }
    const mirrorGroup = new THREE.Group();
    mirrorGroup.matrixAutoUpdate = false;
    mirrorScene.add(mirrorGroup);
    const addMirrorMesh = (
      geometry: THREE.BufferGeometry,
      source: Pick<StageMesh, "material">,
      renderOrder: number,
    ): StageMesh => {
      const mesh = new THREE.Mesh(geometry, source.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      mirrorGroup.add(mesh);
      return mesh;
    };
    const stockingParts = [
      ...stockingPasses,
      addMirrorMesh(model.stockingLow, stockingPasses[0], 0),
      addMirrorMesh(model.stockingLow, { material: seenThrough.mirrored[0] }, 1),
    ];
    if (model.forefoot) {
      // The reflection keeps to the bare skin under the fabric: it is too faint to tell which fabric that is.
      forefootParts.push(
        addMirrorMesh(model.forefoot, forefootParts[0], 0),
        addMirrorMesh(model.forefoot, forefootNearParts[1], 1),
      );
      stockingFrontParts.push(
        addMirrorMesh(stockingLowFront!, stockingFrontParts[0], -1),
        addMirrorMesh(stockingLowFront!, stockingFrontParts[1], 1),
      );
    }
    // The fading top in the reflection, after the rest of the leg.
    addMirrorMesh(model.stockingLow, { material: seenThrough.mirrored[1] }, 4);
    const bowUniforms: BowUniforms = {
      ...lightUniforms,
      ...rigUniforms,
      uBowMatrix: {
        value: new THREE.Matrix4(),
      },
      uBowColor: {
        value: toColor("#f6f3f4"),
      },
      uBowShade: {
        value: new THREE.Vector3(0.8, 0.74, 0.86),
      },
      uCuffY: stockingUniforms.uCuffY,
      uCuffBulge: stockingUniforms.uCuffBulge,
      uFadeStart: stockingUniforms.uFadeStart,
      uFadeEnd: stockingUniforms.uFadeEnd,
      uOpacity: stockingUniforms.uOpacity,
    };
    const bowMesh = addMesh(
      bowGeometry,
      new THREE.ShaderMaterial({
        vertexShader: BOW_VERTEX_SHADER,
        fragmentShader: BOW_FRAGMENT_SHADER,
        uniforms: bowUniforms,
        side: THREE.DoubleSide,
        ...transparentOptions,
      }),
      1.5,
    );
    bowMesh.visible = false;
    const shadowMesh = new THREE.Mesh(
      model.stockingLow,
      new THREE.ShaderMaterial({
        vertexShader: FLOOR_SHADOW_VERTEX_SHADER,
        fragmentShader: FLOOR_SHADOW_FRAGMENT_SHADER,
        uniforms: {
          ...shadowProjUniforms,
          uOpacity: stockingUniforms.uOpacity,
          ...rigUniforms,
        },
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      }),
    );
    shadowMesh.frustumCulled = false;
    shadowMesh.matrixAutoUpdate = false;
    shadowScene.add(shadowMesh);
    const casterMesh = new THREE.Mesh(
      model.stockingLow,
      new THREE.ShaderMaterial({
        vertexShader: CASTER_VERTEX_SHADER,
        fragmentShader: CASTER_FRAGMENT_SHADER,
        uniforms: {
          ...rigUniforms,
          uFadeStart: stockingUniforms.uFadeStart,
          uFadeEnd: stockingUniforms.uFadeEnd,
        },
        side: THREE.DoubleSide,
        colorWrite: false,
      }),
    );
    casterMesh.frustumCulled = false;
    casterMesh.matrixAutoUpdate = false;
    // How solid the leg is in the light's way, into the shadow map's color: through every wall of the leg, the
    // most solid one kept.
    const casterCover = new THREE.Mesh(
      model.stockingLow,
      new THREE.ShaderMaterial({
        vertexShader: CASTER_VERTEX_SHADER,
        fragmentShader: CASTER_COVER_FRAGMENT_SHADER,
        uniforms: casterMesh.material.uniforms,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      }),
    );
    casterCover.frustumCulled = false;
    casterMesh.add(casterCover);
    const castScene = new THREE.Scene();
    castScene.add(casterMesh);
    return {
      index: index,
      group: legGroup,
      late: [restoreGroup, lineGroup, fadeGroup, topLineGroup, insideGroup, throughGroup, lastGroup],
      fadeGroup: fadeGroup,
      throughGroup: throughGroup,
      topLine: { behind: [seenThrough.topMark, topOutlines[0]], front: [topOutlines[1]] },
      restore: seenThrough.restore,
      aroundStocking: [seenThrough.low, seenThrough.curtain, seenThrough.gone, seenThrough.erase],
      topParts: [
        seenThrough.curtain,
        seenThrough.fade,
        seenThrough.topMark,
        ...topOutlines,
        seenThrough.through[1],
        seenThrough.topDepth,
      ],
      // What is drawn only while the eye looks into the leg from above where its top begins to fade (see
      // lookInto): what tells the solid leg seen through its own top, and the leg's inside.
      intoParts: [seenThrough.inside],
      askParts: [seenThrough.curtain, seenThrough.gone],
      ask: true,
      throughParts: [seenThrough.low, seenThrough.erase, ...seenThrough.through],
      gone: watchDrawn(seenThrough.gone),
      solid: seenThrough.solid,
      into: true,
      through: true,
      behind: false,
      lowParts: [seenThrough.low],
      highParts: [
        stockingPasses[1],
        seenThrough.gone,
        seenThrough.erase,
        seenThrough.inside,
        seenThrough.through[0],
        seenThrough.through[2],
      ],
      mirror: mirrorGroup,
      rig: rigUniforms,
      fabric: stockingUniforms,
      outlineUniforms: outlineUniforms,
      stocking: stockingPasses[1],
      stockingParts: stockingParts,
      cuffParts: [stockingPasses[0], seenThrough.restore, stockingOutline],
      stockingFrontParts: stockingFrontParts,
      bare: false,
      forefootUnder: forefootUniforms.uUnder,
      forefootClip: forefootUniforms.uClip,
      forefootParts: forefootParts,
      forefootNearParts: forefootNearParts,
      forefootOutline: forefootOutline,
      shadow: shadowMesh,
      caster: casterMesh,
      castScene: castScene,
      bow: bowMesh,
      bowU: bowUniforms,
      matrix: legGroup.matrix,
    };
  }
  const legs = [createLeg(0), createLeg(1)];
  legs.forEach(showForefoot);
  function setLegPose(index: number, rig: LegPose, matrix: ArrayLike<number>): void {
    const leg = legs[index];
    leg.rig.uToeRot.value.set(...rig.T);
    leg.rig.uAnkleRot.value.set(...rig.A);
    leg.rig.uKneeRot.value.set(...rig.K);
    leg.rig.uRigOn.value = rig.on;
    leg.group.matrix.fromArray(matrix);
    leg.group.matrixWorldNeedsUpdate = true;
    for (const group of leg.late) {
      group.matrixWorldNeedsUpdate = true;
    }
    leg.fabric.uRestFromWorld.value.copy(leg.group.matrix).invert();
    leg.mirror.matrix.fromArray(matrix).premultiply(flipYMatrix);
    leg.mirror.matrixWorldNeedsUpdate = true;
    leg.shadow.matrix.fromArray(matrix);
    leg.shadow.matrixWorldNeedsUpdate = true;
    leg.caster.matrix.fromArray(matrix);
    leg.caster.matrixWorldNeedsUpdate = true;
  }
  /**
   * How the forefoot's skin is drawn. On a bare leg it stands in for the front of the stocking mesh and is drawn
   * along with it, so a faded leg still shows its nearest surface only. Under a stocking it is drawn first and
   * shows through the fabric, but only on a leg that is all there: a fading leg goes back to one surface, on
   * which the fabric paints the skin itself. What shows through the fabric must be drawn before it, and that
   * includes the rest of the leg (seen between the toes, where the fabric spans the gaps): the stocking behind
   * the join comes first, then the skin, then the stocking in front of the join.
   * Only the nearest surface of that front part is drawn, so skin seen through one part of it (the fabric
   * between two toes) would lack the fabric that lies on the skin itself. The skin is therefore drawn wearing
   * that fabric first, and once more bare where it is right under the nearest fabric, which then covers it.
   */
  // The stocking's depth and color passes are drawn at `first` and the order after it, and around them the
  // passes that keep the solid leg from showing through its own fading top (see addSeenThrough): between them
  // the leg from the ankle down and then the curtain, and after them the two that take out the depth of what
  // the curtain kept from being drawn.
  function orderStocking(leg: StageLeg, first: number): void {
    leg.stockingParts.forEach((part, i) => {
      part.renderOrder = first + (i % 2);
    });
    leg.aroundStocking.forEach((part, i) => {
      part.renderOrder = first + [0.1, 0.2, 1.1, 1.2][i];
    });
  }
  function showForefoot(leg: StageLeg): void {
    if (!model.forefoot) {
      orderStocking(leg, 0);
      return;
    }
    const overlay = leg.bare ? 0 : THREE.MathUtils.smoothstep(leg.fabric.uOpacity.value, 0.9, 1);
    const through = overlay > 0;
    leg.fabric.uClip.value = leg.bare || through ? 1 : 0;
    leg.outlineUniforms.uClip.value = leg.bare ? 1 : 0;
    leg.fabric.uOverlay.value = overlay;
    leg.forefootUnder.value = leg.bare ? 0 : 1;
    // Under a stocking the skin lies a little inside the stocking's surface, so it reaches back under the
    // stocking behind the join: seen through the fabric over the toes, no slit opens between the two.
    leg.forefootClip.value = leg.bare ? -1 : -0.1;
    orderStocking(leg, through ? -6 : 0);
    leg.forefootParts.forEach((part, i) => {
      part.visible = leg.bare || through;
      part.renderOrder = (i % 2) - (leg.bare ? 0 : 4);
    });
    for (const part of [...leg.stockingFrontParts, ...leg.forefootNearParts]) {
      part.visible = through;
    }
    leg.forefootOutline!.visible = leg.bare;
  }
  function setLegOpacity(index: number, opacity: number): void {
    const leg = legs[index];
    leg.fabric.uOpacity.value = opacity;
    showForefoot(leg);
    leg.group.visible = leg.shadow.visible = leg.mirror.visible = opacity > 0.003;
    for (const group of leg.late) {
      group.visible = leg.group.visible;
    }
  }
  function setOrder(frontIndex: number): void {
    for (let i = 0; i < 2; i++) {
      const front = frontIndex === i;
      legs[i].group.renderOrder = legs[i].mirror.renderOrder = front ? 20 : 10;
      // After both legs: the fading top of the leg behind and the line around it, then the top of the leg in
      // front, over them. The line around that one comes last (see addOutline).
      legs[i].fadeGroup.renderOrder = front ? LATE_ORDER.fadeSecond : LATE_ORDER.fadeFirst;
      for (const part of legs[i].topLine.behind) {
        part.visible = !front;
      }
      for (const part of legs[i].topLine.front) {
        part.visible = front;
      }
      legs[i].throughGroup.renderOrder = front ? LATE_ORDER.throughSecond : LATE_ORDER.throughFirst;
      legs[i].behind = !front;
    }
    lookAgain();
  }
  // Nothing of a leg is seen through its own top, nor is its inside seen, unless the eye looks down into the leg:
  // from above the plane where the top begins to fade (in the leg's own space at rest, as the lid has it: see
  // LID_GLSL), and steeply enough for the line of sight over the near rim to reach the far wall where the inside
  // is not yet lost in the fade (INTO_FROM, as the sine of its angle to that plane). While it does not, which is
  // most of the time, the passes for all of that are left out (`intoParts`) and the solid leg's color is drawn
  // in one pass. Past that angle the inside comes in gradually (uInto).
  //
  // And while it does, what the curtain keeps from being drawn is mostly nothing: the lid has told. The pass
  // that marks it (`gone`) is watched: as long as it marks no pixel, the passes that deal with what is gone are
  // left out as well (`throughParts`), the leg that was drawn first lays its depth down again only if the other
  // leg took any of it out, and the curtain and that pass themselves are drawn only every ASK_EVERY ms
  // (`askParts`). The GPU tells a frame or two late: all in all that is how long a part that comes to be seen
  // through the leg's top is drawn as it is before it fades.
  const eye = new THREE.Vector3();
  function lookInto(amounts: number[], through: boolean[], ask: boolean[]): void {
    legs.forEach((leg, i) => {
      leg.fabric.uInto.value = amounts[i];
      leg.into = amounts[i] > 0;
      leg.through = leg.into && through[i];
      leg.ask = leg.into && (leg.through || ask[i]);
      for (const part of leg.intoParts) {
        part.visible = leg.into;
      }
      for (const part of leg.askParts) {
        part.visible = leg.ask;
      }
      for (const part of leg.throughParts) {
        part.visible = leg.through;
      }
      leg.restore.visible = leg.behind && amounts[1 - i] > 0 && through[1 - i];
      const [depth, color] = leg.stockingParts;
      color.material = leg.solid[leg.through ? 1 : 0];
      color.geometry = leg.through ? upperOf(depth.geometry) : depth.geometry;
    });
  }
  const lookAgain = (): void =>
    lookInto(
      legs.map((leg) => leg.fabric.uInto.value),
      legs.map((leg) => leg.through),
      legs.map((leg) => leg.ask),
    );
  mainScene.onBeforeRender = (renderer, _scene, camera) => {
    const now = performance.now();
    const amounts = legs.map((leg) => {
      eye.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(leg.fabric.uRestFromWorld.value);
      const fadeStart = leg.fabric.uFadeStart.value;
      const [x, z] = leg.fabric.uLidC.value.toArray();
      // The middle of the lid, on that plane.
      const away = eye.distanceTo(tmpVec.set(x, heightOfFade(fadeStart, x, z), z));
      return THREE.MathUtils.smoothstep(
        (fadeHeight(eye.x, eye.y, eye.z) - fadeStart) / away,
        INTO_FROM[0],
        INTO_FROM[1],
      );
    });
    lookInto(
      amounts,
      legs.map((leg, i) => {
        if (amounts[i] <= 0) {
          leg.gone.assume(camera);
        }
        return leg.gone.drawn(renderer, camera);
      }),
      legs.map((leg) => leg.gone.due(camera, now, ASK_EVERY)),
    );
  };
  setOrder(0);
  const floorCamera = new THREE.OrthographicCamera(
    floorMapRect.x,
    floorMapRect.x + floorMapRect.z,
    -floorMapRect.y,
    -(floorMapRect.y + floorMapRect.w),
    -2,
    2,
  );
  floorCamera.position.set(0, 1, 0);
  floorCamera.up.set(0, 0, -1);
  floorCamera.lookAt(0, 0, 0);
  /** Points the floor camera at a floor rect (x, z, width, depth). */
  function aimFloorCamera(rect: THREE.Vector4): void {
    floorCamera.left = rect.x;
    floorCamera.right = rect.x + rect.z;
    floorCamera.top = -rect.y;
    floorCamera.bottom = -(rect.y + rect.w);
    floorCamera.updateProjectionMatrix();
  }
  /** Leg radius around a cast point given without one: the widest part of the leg, at the thigh top. */
  const MAX_LEG_RADIUS = 0.14;
  /** Radius of the floor disc; the shadow map never needs to reach past it. */
  const FLOOR_RADIUS = 1.6;
  /**
   * Fits the shadow map to the legs' shadow along `dir`, so a low or turned light never projects the thighs past
   * the map edge (where sampling would smear the edge texels into streaks). Keeps the default rect whenever the
   * shadow fits in it; otherwise grows to a square around the default rect and the shadow, within the floor.
   */
  function fitShadowRect(rect: THREE.Vector4, dir: THREE.Vector3): void {
    rect.copy(floorMapRect);
    const run = 1 / Math.max(dir.y, 0.2);
    // A ball of radius r projects to within r * sqrt(1 + (dx / dy)^2) of its center's shadow along x (same for z).
    const spreadX = Math.hypot(1, dir.x * run);
    const spreadZ = Math.hypot(1, dir.z * run);
    let minX = floorMapRect.x;
    let minZ = floorMapRect.y;
    let maxX = floorMapRect.x + floorMapRect.z;
    let maxZ = floorMapRect.y + floorMapRect.w;
    let grown = false;
    castPoints.forEach((point, i) => {
      const x = point[0] - dir.x * point[1] * run;
      const z = point[2] - dir.z * point[1] * run;
      const rx = castRadii[i] * spreadX;
      const rz = castRadii[i] * spreadZ;
      if (x - rx < minX || x + rx > maxX || z - rz < minZ || z + rz > maxZ) {
        grown = true;
        minX = Math.min(minX, x - rx);
        maxX = Math.max(maxX, x + rx);
        minZ = Math.min(minZ, z - rz);
        maxZ = Math.max(maxZ, z + rz);
      }
    });
    if (!grown) {
      return;
    }
    const size = Math.min(FLOOR_RADIUS * 2, Math.max(maxX - minX, maxZ - minZ));
    const clampStart = (center: number) => THREE.MathUtils.clamp(center - size / 2, -FLOOR_RADIUS, FLOOR_RADIUS - size);
    rect.set(clampStart((minX + maxX) / 2), clampStart((minZ + maxZ) / 2), size, size);
  }
  const blurScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blurMaterial = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: BLUR_FRAGMENT_SHADER,
    uniforms: {
      uBlurTex: {
        value: null,
      },
      uBlurStep: {
        value: new THREE.Vector2(),
      },
    },
    depthTest: false,
    depthWrite: false,
  });
  const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial);
  blurQuad.frustumCulled = false;
  blurScene.add(blurQuad);
  const worldUp = new THREE.Vector3(0, 1, 0);
  function renderFloorShadow(
    target: THREE.WebGLRenderTarget,
    lightDir: THREE.Vector3,
    contactMode: number,
    blurRadius: number,
  ): void {
    shadowProjUniforms.uProjDir.value.copy(lightDir);
    shadowProjUniforms.uContactMode.value = contactMode;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(shadowScene, floorCamera);
    blurMaterial.uniforms.uBlurTex.value = target.texture;
    blurMaterial.uniforms.uBlurStep.value.set(blurRadius / floorMapSize, 0);
    renderer.setRenderTarget(blurTempTarget);
    renderer.clear();
    renderer.render(blurScene, quadCamera);
    blurMaterial.uniforms.uBlurTex.value = blurTempTarget.texture;
    blurMaterial.uniforms.uBlurStep.value.set(0, blurRadius / floorMapSize);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(blurScene, quadCamera);
  }
  const castPoints: Vec3[] = [];
  const castRadii: number[] = [];
  const tmpVec = new THREE.Vector3();
  const biasMatrix = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  function setCastPoints(points: Iterable<Vec3>, radii?: ArrayLike<number>): void {
    castPoints.length = 0;
    castRadii.length = 0;
    for (const point of points) {
      castRadii.push(radii?.[castPoints.length] ?? MAX_LEG_RADIUS);
      castPoints.push(point);
    }
  }
  function updateLegShadows(): void {
    const bothVisible = legs[0].fabric.uOpacity.value > 0.003 && legs[1].fabric.uOpacity.value > 0.003;
    legs[0].fabric.uCastShadowStrength.value = bothVisible ? legs[1].fabric.uOpacity.value : 0;
    legs[1].fabric.uCastShadowStrength.value = bothVisible ? legs[0].fabric.uOpacity.value : 0;
    if (!bothVisible || !castPoints.length) {
      return;
    }
    const keyDir = lightUniforms.uKeyDir.value;
    lightCamera.position.set(0, 0.45, 0.05).addScaledVector(keyDir, 2.5);
    lightCamera.up.set(0, 1, 0);
    lightCamera.lookAt(0, 0.45, 0.05);
    lightCamera.updateMatrixWorld();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of castPoints) {
      tmpVec.set(point[0], point[1], point[2]).applyMatrix4(lightCamera.matrixWorldInverse);
      minX = Math.min(minX, tmpVec.x);
      maxX = Math.max(maxX, tmpVec.x);
      minY = Math.min(minY, tmpVec.y);
      maxY = Math.max(maxY, tmpVec.y);
      minZ = Math.min(minZ, -tmpVec.z);
      maxZ = Math.max(maxZ, -tmpVec.z);
    }
    const margin = 0.14;
    lightCamera.left = minX - margin;
    lightCamera.right = maxX + margin;
    lightCamera.bottom = minY - margin;
    lightCamera.top = maxY + margin;
    lightCamera.near = Math.max(0.05, minZ - 0.3);
    lightCamera.far = maxZ + 0.3;
    lightCamera.updateProjectionMatrix();
    castShadowUniforms.uCastShadowMatrix.value
      .multiplyMatrices(biasMatrix, lightCamera.projectionMatrix)
      .multiply(lightCamera.matrixWorldInverse);
    for (let i = 0; i < 2; i++) {
      renderer.setRenderTarget(castTargets[i]);
      renderer.clear();
      renderer.render(legs[i].castScene, lightCamera);
    }
  }
  let lastShadowKey = "";
  const shadowDir = new THREE.Vector3();
  const tmpClearColor = new THREE.Color();
  function bakeShadow(force = false): void {
    const keyDir = lightUniforms.uKeyDir.value;
    const dir = shadowDir.copy(keyDir);
    if (dir.y < 0.45) {
      const horizontal = Math.hypot(dir.x, dir.z) || 1;
      const scale = Math.sqrt(0.7975) / horizontal;
      dir.set(dir.x * scale, 0.45, dir.z * scale);
    }
    const key = Math.round(keyDir.x * 1000) + "," + Math.round(keyDir.y * 1000) + "," + Math.round(keyDir.z * 1000);
    if (key === lastShadowKey && !force) {
      return;
    }
    const prevClearColor = renderer.getClearColor(tmpClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0, 1);
    const shadowRect = floorUniforms.uShadowRect.value;
    fitShadowRect(shadowRect, dir);
    aimFloorCamera(shadowRect);
    // Same blur on the floor whatever the rect size.
    renderFloorShadow(floorShadowTarget, dir, 0, (1.7 * floorMapRect.z) / shadowRect.z);
    aimFloorCamera(floorMapRect);
    if (force || !lastShadowKey) {
      renderFloorShadow(floorContactTarget, worldUp, 1, 3.4);
    }
    updateLegShadows();
    lastShadowKey = key;
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }
  const baseKeyDir = new THREE.Vector3(-0.55, 0.78, 0.42).normalize();
  const baseRimDir = new THREE.Vector3(0.78, 0.22, -0.58).normalize();
  const yawQuat = new THREE.Quaternion();
  const tiltQuat = new THREE.Quaternion();
  const tiltAxis = new THREE.Vector3();
  function aimLights(yaw: number, tilt = 0): void {
    yawQuat.setFromAxisAngle(worldUp, yaw);
    lightUniforms.uKeyDir.value.copy(baseKeyDir).applyQuaternion(yawQuat);
    lightUniforms.uRimDir.value.copy(baseRimDir).applyQuaternion(yawQuat);
    if (tilt < 0) {
      tiltQuat.setFromAxisAngle(tiltAxis.set(-Math.cos(yaw), 0, Math.sin(yaw)), tilt * 0.8);
      lightUniforms.uKeyDir.value.applyQuaternion(tiltQuat);
      lightUniforms.uRimDir.value.applyQuaternion(tiltQuat);
    }
  }
  const blitMaterial = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: COMPOSITE_FRAGMENT_SHADER,
    uniforms: {
      uColorTex: {
        value: null,
      },
      uDepthTex: {
        value: null,
      },
      uResolution: {
        value: viewport,
      },
    },
    depthTest: true,
    depthWrite: true,
    depthFunc: THREE.AlwaysDepth,
  });
  const blitScene = new THREE.Scene();
  const blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMaterial);
  blitQuad.frustumCulled = false;
  blitScene.add(blitQuad);
  const tmpColor = new THREE.Color();
  function setStocking(index: number, look: LegLook, bowMatrix: ArrayLike<number> | null = null): void {
    const leg = legs[index];
    const fabric = leg.fabric;
    fabric.uDye.value.set(look.dye);
    fabric.uDye2.value.set(look.dye2);
    fabric.uSheenColor.value.set(look.sheen);
    fabric.uStripe.value = look.stripe;
    fabric.uShade.value.set(...look.shade);
    fabric.uThrough.value = look.through;
    fabric.uSheenAmount.value = look.sheenAmt;
    leg.outlineUniforms.uOutlineColor.value.set(look.outline);
    fabric.uDenier.value = look.denier;
    fabric.uPattern.value = look.pattern;
    fabric.uGloss.value = look.gloss;
    fabric.uCuffY.value = look.cuffY;
    fabric.uHasCuff.value = look.hasCuff;
    // A cuff presses into the leg by how soft the leg is where it sits. Tights have none, so their line at cuffY
    // leaves the leg's shape alone.
    fabric.uCuffBulge.value = look.cuffPress;
    for (const part of leg.cuffParts) {
      part.geometry = stockingFor(look);
    }
    for (const part of leg.topParts) {
      part.geometry = topOf(stockingFor(look));
    }
    for (const part of leg.lowParts) {
      part.geometry = bottomOf(stockingFor(look));
    }
    for (const part of leg.highParts) {
      part.geometry = upperOf(stockingFor(look));
    }
    lookAgain();
    const lid = lidAt(look.fade0);
    fabric.uLidC.value.set(...lid.center);
    fabric.uLidR.value = lid.radii;
    fabric.uCuffStyle.value = look.cuff;
    fabric.uBand.value = look.band;
    fabric.uGarter.value = look.garter;
    fabric.uToe.value = look.toe;
    fabric.uPrint.value = look.print;
    fabric.uMatWet.value.set(...look.mat);
    fabric.uMatKnit.value.set(...look.mat2);
    tmpColor.set(look.secretColor);
    fabric.uSecret.value.set(tmpColor.r, tmpColor.g, tmpColor.b, look.secret);
    if (look.wetDye) {
      tmpColor.set(look.wetDye);
      fabric.uWetDye.value.set(tmpColor.r, tmpColor.g, tmpColor.b, 0.85);
    } else {
      fabric.uWetDye.value.set(0, 0, 0, 0);
    }
    leg.bare = !!look.bare;
    showForefoot(leg);
    fabric.uFadeStart.value = look.fade0;
    fabric.uFadeEnd.value = look.fade1;
    leg.bow.visible = !!look.bow && !!bowMatrix;
    if (leg.bow.visible) {
      leg.bowU.uBowMatrix.value.fromArray(bowMatrix!);
      leg.bowU.uBowColor.value.set(look.dye2);
    }
  }
  const sceneMaterialCache = new Map<number, [THREE.ShaderMaterial, THREE.ShaderMaterial]>([
    [0, [backdropMesh.material, floorMesh.material]],
  ]);
  let currentScene: SceneDef = SCENES.studio;
  let currentBackdrop: BackdropDef = BACKDROPS.lilac;
  let mirrorFalloff = 0;
  let mirrorEnabled = true;
  const getSceneMaterials = (sceneId: number): [THREE.ShaderMaterial, THREE.ShaderMaterial] => {
    if (!sceneMaterialCache.has(sceneId)) {
      sceneMaterialCache.set(sceneId, [makeBackdropMaterial(sceneId), makeFloorMaterial(sceneId)]);
    }
    return sceneMaterialCache.get(sceneId)!;
  };
  function setBackdrop(backdrop: string | BackdropDef): void {
    currentBackdrop = typeof backdrop == "string" ? BACKDROPS[backdrop] || makeCustomBackdrop(backdrop) : backdrop;
    if (currentScene.id === 0) {
      backdropUniforms.uTopColor.value.set(currentBackdrop.top);
      backdropUniforms.uBottomColor.value.set(currentBackdrop.bottom);
      backdropUniforms.uGlowColor.value.set(currentBackdrop.glow);
      floorUniforms.uFloorColor.value.set(currentBackdrop.floor);
      floorUniforms.uShadowColor.value.set(currentBackdrop.shadow);
      // What the legs reflect is the room, which takes the backdrop's color, and so does the light that
      // reaches their edges from behind.
      const env = studioEnv(currentScene.light, currentBackdrop);
      lightUniforms.uEnvLo.value.set(...env.envLo);
      lightUniforms.uEnvHi.value.set(...env.envHi);
      const [rimR, rimG, rimB] = studioRimTint(currentBackdrop);
      const rim = lightUniforms.uRimColor.value.set(currentScene.light.rim);
      rim.setRGB(rim.r * rimR, rim.g * rimG, rim.b * rimB);
    }
  }
  function setScene(sceneKey: string): SceneDef {
    const sceneDef = (currentScene = SCENES[sceneKey] || SCENES.studio);
    const lightDef = sceneDef.light;
    const floorDef = sceneDef.floor;
    [backdropMesh.material, floorMesh.material] = getSceneMaterials(sceneDef.id);
    lightUniforms.uKeyColor.value.set(lightDef.key);
    lightUniforms.uRimColor.value.set(lightDef.rim);
    lightUniforms.uFillTop.value.set(...lightDef.fillTop);
    lightUniforms.uFillBottom.value.set(...lightDef.fillBottom);
    lightUniforms.uRim2Color.value.set(lightDef.rim2);
    lightUniforms.uRim2Dir.value.set(...lightDef.rim2Dir).normalize();
    lightUniforms.uEnvLo.value.set(...lightDef.envLo);
    lightUniforms.uEnvHi.value.set(...lightDef.envHi);
    lightUniforms.uEnvAColor.value.set(...lightDef.envA);
    lightUniforms.uEnvADir.value.set(...lightDef.envADir).normalize();
    lightUniforms.uEnvBColor.value.set(...lightDef.envB);
    lightUniforms.uEnvBDir.value.set(...lightDef.envBDir).normalize();
    lightUniforms.uCaustic.value = lightDef.caustic;
    floorUniforms.uShadowColor.value.set(floorDef.shadow);
    tmpColor.set(floorDef.mark);
    floorUniforms.uMarkColor.value.set(tmpColor.r, tmpColor.g, tmpColor.b, floorDef.markAmt);
    floorUniforms.uMirrorStrength.value = mirrorEnabled ? floorDef.mirror : 0;
    floorUniforms.uPuddleLight.value = floorDef.puddleLight === undefined ? 1 : floorDef.puddleLight;
    mirrorFalloff = floorDef.mirrorFall || 1.6;
    if (sceneDef.id === 0) {
      setBackdrop(currentBackdrop);
    }
    return sceneDef;
  }
  /** Compiles still in flight, so a second warm-up of the same scene waits for the first. */
  const warming = new Map<number, Promise<unknown>>();
  function warmScene(sceneKey: string, camera: THREE.Camera): Promise<unknown> {
    const sceneDef = SCENES[sceneKey];
    const pending = sceneDef && warming.get(sceneDef.id);
    if (pending) {
      return pending;
    }
    if (!sceneDef || sceneMaterialCache.has(sceneDef.id) || !renderer.compileAsync) {
      return Promise.resolve();
    }
    const [backdropMaterial, floorMaterial] = getSceneMaterials(sceneDef.id);
    const warmupScene = new THREE.Scene();
    const backdropProbe = new THREE.Mesh(backdropMesh.geometry, backdropMaterial);
    const floorProbe = new THREE.Mesh(floorMesh.geometry, floorMaterial);
    backdropProbe.frustumCulled = floorProbe.frustumCulled = false;
    warmupScene.add(backdropProbe, floorProbe);
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(mirrorTarget);
    const sceneId = sceneDef.id;
    const compilePromise = renderer
      .compileAsync(warmupScene, camera)
      .catch(() => {})
      .finally(() => warming.delete(sceneId));
    warming.set(sceneId, compilePromise);
    renderer.setRenderTarget(prevTarget);
    return compilePromise;
  }
  /**
   * After the WebGL context was lost and given back. The renderer rebuilds its programs, buffers and textures by
   * itself; what was drawn into a texture is gone. Here that is the shadows, which are only baked again when the
   * light turns, and the contact shadow, baked once. A scene still being warmed up may never finish: forget it,
   * so the next request starts over.
   */
  function restore(): void {
    for (const leg of legs) {
      leg.gone.assume();
    }
    warming.clear();
    lastShadowKey = "";
    bakeShadow(true);
  }
  const flipY = (vec: THREE.Vector3): void => {
    vec.y = -vec.y;
  };
  const mirroredDirUniforms = [
    lightUniforms.uKeyDir,
    lightUniforms.uRimDir,
    lightUniforms.uRim2Dir,
    lightUniforms.uEnvADir,
    lightUniforms.uEnvBDir,
  ];
  let mirrorScale = 0.5;
  function resizeMirror(width: number, height: number, scale = mirrorScale): void {
    mirrorScale = scale;
    mirrorTarget.setSize(Math.max(4, Math.round(width * scale)), Math.max(4, Math.round(height * scale)));
  }
  function setMirror(enabled: boolean): void {
    mirrorEnabled = enabled;
    floorUniforms.uMirrorStrength.value = enabled ? currentScene.floor.mirror : 0;
  }
  function renderMirror(camera: THREE.Camera): boolean {
    if (floorUniforms.uMirrorStrength.value <= 0 || camera.position.y < 0.03) {
      return false;
    }
    for (const uniform of mirroredDirUniforms) {
      flipY(uniform.value);
    }
    lightUniforms.uMirrorFlipY.value = -1;
    lightUniforms.uMirrorFalloff.value = mirrorFalloff;
    castShadowUniforms.uCastShadowMatrix.value.multiply(flipYMatrix);
    const prevClearColor = renderer.getClearColor(tmpClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0, 0);
    renderer.setRenderTarget(mirrorTarget);
    renderer.clear();
    renderer.render(mirrorScene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    castShadowUniforms.uCastShadowMatrix.value.multiply(flipYMatrix);
    lightUniforms.uMirrorFlipY.value = 1;
    lightUniforms.uMirrorFalloff.value = 0;
    for (const uniform of mirroredDirUniforms) {
      flipY(uniform.value);
    }
    return true;
  }
  return {
    scene: mainScene,
    floor: floorMesh,
    legs: legs,
    uniforms: {
      light: lightUniforms,
      fabric: fabricUniforms,
      floor: floorUniforms,
      bg: backdropUniforms,
    },
    setScene: setScene,
    setBackdrop: setBackdrop,
    warmScene: warmScene,
    renderMirror: renderMirror,
    resizeMirror: resizeMirror,
    setMirror: setMirror,
    lineWidth: lineWidth,
    blank: blankTexture,
    get sceneNow() {
      return currentScene;
    },
    get backdropNow() {
      return currentBackdrop;
    },
    viewport: viewport,
    ripples: ripples,
    setStocking: setStocking,
    setLegPose: setLegPose,
    setLegOpacity: setLegOpacity,
    setOrder: setOrder,
    setCastPoints: setCastPoints,
    aimLights: aimLights,
    bakeShadow: bakeShadow,
    restore: restore,
    shadowScene: shadowScene,
    blit(colorTexture: THREE.Texture, depthTexture: THREE.Texture | null): void {
      blitMaterial.uniforms.uColorTex.value = colorTexture;
      blitMaterial.uniforms.uDepthTex.value = depthTexture;
      renderer.render(blitScene, quadCamera);
    },
  };
}
