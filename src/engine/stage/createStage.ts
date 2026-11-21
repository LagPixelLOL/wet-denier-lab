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
import { BACKDROPS, SCENES, makeCustomBackdrop, studioEnv } from "./scenes";
import type { BackdropDef, SceneDef } from "./scenes";
import { BACKDROP_FRAGMENT_SHADER, BACKDROP_VERTEX_SHADER } from "./shaders/backdrop";
import { BOW_FRAGMENT_SHADER, BOW_VERTEX_SHADER } from "./shaders/bow";
import {
  FLOOR_FRAGMENT_SHADER,
  FLOOR_SHADOW_FRAGMENT_SHADER,
  FLOOR_SHADOW_VERTEX_SHADER,
  FLOOR_VERTEX_SHADER,
} from "./shaders/floor";
import { LEG_DEPTH_FRAGMENT_SHADER, LEG_FRAGMENT_SHADER, LEG_VERTEX_SHADER } from "./shaders/leg";
import { NAIL_COUNT } from "./shaders/foot";
import { OUTLINE_FRAGMENT_SHADER, OUTLINE_VERTEX_SHADER } from "./shaders/outline";
import {
  BLUR_FRAGMENT_SHADER,
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
  uOpacity: U<number>;
  uWetMapSlot: U<THREE.Vector2>;
  uCastShadowMap: U<THREE.DepthTexture | null>;
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
  /** Mirrored copy rendered into the floor reflection. */
  mirror: THREE.Group;
  rig: RigUniforms;
  fabric: StockingUniforms;
  outlineUniforms: OutlineUniforms;
  /** Color passes of the stocking and the skin. */
  stocking: StageMesh;
  skin: StageMesh;
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
  /** Everything hidden when the skin is covered. */
  skinParts: StageMesh[];
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
  shadowScene: THREE.Scene;
  blit(colorTexture: THREE.Texture, depthTexture: THREE.Texture | null): void;
}

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
      value: 0.7,
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
        value: defaultLook.hasCuff,
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
      uOpacity: {
        value: 1,
      },
      uWetMapSlot: {
        value: new THREE.Vector2(0.5, index * 0.5),
      },
      uCastShadowMap: {
        value: castTargets[1 - index].depthTexture,
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
    // `behind` pushes the surface back a little in depth, for skin under the stocking: "on" it (the skin above
    // the cuff, which lies on the stocking's own surface, so the push grows with the slope) or "under" it (the
    // forefoot, which is a surface of its own a little inside the fabric: a slope-scaled push would send skin
    // seen at a glancing angle behind whatever is drawn before it, like the rest of its own leg). `extra`
    // overrides uniforms for this surface alone.
    const addSurfacePasses = (
      geometry: THREE.BufferGeometry,
      isSkin: number,
      behind: "on" | "under" | null,
      extra: Record<string, U<number>> = {},
    ): [StageMesh, StageMesh] => {
      const uniforms = {
        ...surfaceUniforms,
        uIsSkin: {
          value: isSkin,
        },
        ...extra,
      };
      const offsetOptions = behind
        ? {
            polygonOffset: true,
            polygonOffsetFactor: behind === "on" ? 1 : 0,
            polygonOffsetUnits: 2,
          }
        : {};
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
      uOpacity: stockingUniforms.uOpacity,
      ...rigUniforms,
    };
    const addOutline = (
      geometry: THREE.BufferGeometry,
      isSkin: number,
      extra: Record<string, U<number>> = {},
    ): StageMesh =>
      addMesh(
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
          side: THREE.BackSide,
          ...transparentOptions,
        }),
        2,
      );
    const stockingPasses = addSurfacePasses(stockingFor(defaultLook), 0, null);
    const skinPasses = addSurfacePasses(model.skin, 1, "on");
    const skinParts = [...skinPasses, addOutline(model.skin, 1)];
    const stockingOutline = addOutline(stockingFor(defaultLook), 0);
    // The skin of the forefoot, in front of the join only: under the stocking, or in place of the stocking
    // mesh's front on a bare leg, where it also gets a line around it (see showForefoot).
    const forefootUniforms = {
      uUnder: { value: 0 },
      uClip: { value: -1 },
      uCover: { value: 1 },
    };
    const forefootParts: StageMesh[] = model.forefoot
      ? addSurfacePasses(model.forefoot, 0, "under", forefootUniforms)
      : [];
    const forefootOutline = model.forefoot
      ? addOutline(model.forefoot, 0, { uClip: forefootUniforms.uClip, uSilhouette: { value: 1 } })
      : null;
    const stockingFrontParts: StageMesh[] = stockingFront
      ? addSurfacePasses(stockingFront, 0, null, { uClip: { value: -1 } })
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
    const addMirrorMesh = (geometry: THREE.BufferGeometry, source: StageMesh, renderOrder: number): StageMesh => {
      const mesh = new THREE.Mesh(geometry, source.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      mirrorGroup.add(mesh);
      return mesh;
    };
    const stockingParts = [
      ...stockingPasses,
      addMirrorMesh(model.stockingLow, stockingPasses[0], 0),
      addMirrorMesh(model.stockingLow, stockingPasses[1], 1),
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
    skinParts.push(addMirrorMesh(model.skin, skinPasses[0], 0), addMirrorMesh(model.skin, skinPasses[1], 1));
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
        },
        side: THREE.DoubleSide,
        colorWrite: false,
      }),
    );
    casterMesh.frustumCulled = false;
    casterMesh.matrixAutoUpdate = false;
    const castScene = new THREE.Scene();
    castScene.add(casterMesh);
    return {
      index: index,
      group: legGroup,
      mirror: mirrorGroup,
      rig: rigUniforms,
      fabric: stockingUniforms,
      outlineUniforms: outlineUniforms,
      stocking: stockingPasses[1],
      skin: skinPasses[1],
      stockingParts: stockingParts,
      cuffParts: [...stockingPasses, stockingOutline],
      stockingFrontParts: stockingFrontParts,
      skinParts: skinParts,
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
  function showForefoot(leg: StageLeg): void {
    if (!model.forefoot) {
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
    leg.stockingParts.forEach((part, i) => {
      part.renderOrder = (i % 2) - (through ? 6 : 0);
    });
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
  }
  function setOrder(frontIndex: number): void {
    for (let i = 0; i < 2; i++) {
      legs[i].group.renderOrder = legs[i].mirror.renderOrder = frontIndex === i ? 20 : 10;
    }
  }
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
    // Only a cuff presses into the leg: tights have none, so their line at cuffY leaves the leg's shape alone.
    fabric.uCuffBulge.value = look.hasCuff;
    for (const part of leg.cuffParts) {
      part.geometry = stockingFor(look);
    }
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
    for (const part of leg.skinParts) {
      part.visible = look.skinVisible;
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
      // What the legs reflect is the room, which takes the backdrop's color.
      const env = studioEnv(currentScene.light, currentBackdrop);
      lightUniforms.uEnvLo.value.set(...env.envLo);
      lightUniforms.uEnvHi.value.set(...env.envHi);
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
    shadowScene: shadowScene,
    blit(colorTexture: THREE.Texture, depthTexture: THREE.Texture | null): void {
      blitMaterial.uniforms.uColorTex.value = colorTexture;
      blitMaterial.uniforms.uDepthTex.value = depthTexture;
      renderer.render(blitScene, quadCamera);
    },
  };
}
