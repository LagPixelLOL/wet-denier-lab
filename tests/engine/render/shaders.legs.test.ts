import { describe, expect, it } from "vitest";
import { defineProgramSuite, fragmentName, programGroups, unusedUniformsByProgram } from "../../helpers/shaderCatalog";

const isStageProgram = (label: string) => !label.includes(" SCENE=") && !/^(WET_|DROPLET_|BEAD_|GLINT_)/.test(fragmentName(label));

describe("shader catalog", () => {
  it("covers every program the stage, wet map and water simulation draw", () => {
    expect(programGroups().map(([label, uses]) => `${label} x${uses.length}`)).toMatchInlineSnapshot(`
      [
        "BACKDROP_VERTEX BACKDROP_FRAGMENT SCENE=0 x1",
        "BACKDROP_VERTEX BACKDROP_FRAGMENT SCENE=1 x1",
        "BACKDROP_VERTEX BACKDROP_FRAGMENT SCENE=2 x1",
        "BACKDROP_VERTEX BACKDROP_FRAGMENT SCENE=3 x1",
        "BEAD_DECAL_VERTEX BEAD_DECAL_FRAGMENT x1",
        "BOW_VERTEX BOW_FRAGMENT x2",
        "CASTER_VERTEX CASTER_FRAGMENT x2",
        "DROPLET_VERTEX DROPLET_FRAGMENT x1",
        "FLOOR_SHADOW_VERTEX FLOOR_SHADOW_FRAGMENT x2",
        "FLOOR_VERTEX FLOOR_FRAGMENT SCENE=0 x1",
        "FLOOR_VERTEX FLOOR_FRAGMENT SCENE=1 x1",
        "FLOOR_VERTEX FLOOR_FRAGMENT SCENE=2 x1",
        "FLOOR_VERTEX FLOOR_FRAGMENT SCENE=3 x1",
        "FULLSCREEN_VERTEX=WET_QUAD_VERTEX BLUR_FRAGMENT x1",
        "FULLSCREEN_VERTEX=WET_QUAD_VERTEX COMPOSITE_FRAGMENT x1",
        "FULLSCREEN_VERTEX=WET_QUAD_VERTEX WET_UPDATE_FRAGMENT x1",
        "GLINT_VERTEX GLINT_FRAGMENT x1",
        "LEG_VERTEX LEG_DEPTH_FRAGMENT x4",
        "LEG_VERTEX LEG_FRAGMENT x4",
        "OUTLINE_VERTEX OUTLINE_FRAGMENT x4",
        "WET_BAKE_VERTEX WET_BAKE_FRAGMENT x2",
        "WET_STAMP_VERTEX WET_STAMP_FRAGMENT x1",
      ]
    `);
  });
});

describe("leg, bow, outline, shadow and post shaders", () => {
  defineProgramSuite(isStageProgram);

  it("pins the uniforms the leg passes share without reading", () => {
    expect(unusedUniformsByProgram(isStageProgram)).toMatchInlineSnapshot(`
      {
        "BOW_VERTEX BOW_FRAGMENT": [
          "uCaustic",
          "uEnvAColor",
          "uEnvADir",
          "uEnvBColor",
          "uEnvBDir",
          "uEnvHi",
          "uEnvLo",
          "uMirrorFalloff",
          "uMirrorFlipY",
          "uRim2Color",
          "uRim2Dir",
          "uRimColor",
          "uRimDir",
        ],
        "LEG_VERTEX LEG_DEPTH_FRAGMENT": [
          "uBand",
          "uCastShadowMap",
          "uCastShadowMatrix",
          "uCastShadowStrength",
          "uCastShadowTexel",
          "uCaustic",
          "uCuffStyle",
          "uDecalAtlas",
          "uDenier",
          "uDye",
          "uDye2",
          "uEnvAColor",
          "uEnvADir",
          "uEnvBColor",
          "uEnvBDir",
          "uEnvHi",
          "uEnvLo",
          "uFillBottom",
          "uFillTop",
          "uGarter",
          "uGloss",
          "uHasCuff",
          "uHighlightFalloff",
          "uKeyColor",
          "uKeyDir",
          "uKnitMean",
          "uKnitTex",
          "uMatKnit",
          "uMatWet",
          "uMirror",
          "uMirrorFalloff",
          "uMirrorFlipY",
          "uOpacity",
          "uPattern",
          "uPrint",
          "uRim2Color",
          "uRim2Dir",
          "uRimColor",
          "uRimDir",
          "uSecret",
          "uShade",
          "uSheenAmount",
          "uSheenColor",
          "uSkinLit",
          "uSkinScatter",
          "uSkinShade",
          "uStripe",
          "uThrough",
          "uTime",
          "uWetDye",
          "uWetMap",
          "uWetMapSlot",
        ],
      }
    `);
  });
});
