import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseShader, resolveIncludes, splitDeclaratorLists } from "../../helpers/glsl";
import {
  defineProgramSuite,
  expectUniformsWired,
  fragmentName,
  programGroups,
  unusedUniformsByProgram,
  valueFits,
} from "../../helpers/shaderCatalog";

const isStageProgram = (label: string) =>
  !label.includes(" SCENE=") && !/^(WET_|DROPLET_|BEAD_|GLINT_)/.test(fragmentName(label));

describe("GLSL validation helpers", () => {
  it("reject undeclared names and accept three's built-ins", () => {
    expect(() => parseShader("void main() { gl_FragColor = vec4(uNope); }", "fragment")).toThrow(/uNope/);
    expect(() => parseShader("void main() { gl_FragColor = vec4(helper()); }", "fragment")).toThrow(/helper/);
    expect(() =>
      parseShader("void main() { gl_Position = projectionMatrix * vec4(position, 1.0); }", "vertex"),
    ).not.toThrow();
  });

  it("apply defines and #if branches like the GPU would", () => {
    const source = "#if SCENE == 2\nvoid main() { gl_FragColor = vec4(1.0); }\n#else\nvoid main() { broken }\n#endif\n";
    expect(() => parseShader(source, "fragment", { defines: { SCENE: 2 } })).not.toThrow();
    expect(() => parseShader(source, "fragment", { defines: { SCENE: 1 } })).toThrow();
  });

  it("split declarator lists so later initializers see earlier names", () => {
    expect(splitDeclaratorLists("  float a = f(1.0, 2.0), b = a, c = a * b;\nuniform float u, v;")).toBe(
      "  float a = f(1.0, 2.0);\n  float b = a;\n  float c = a * b;\nuniform float u, v;",
    );
  });

  it("resolve #include chunks from THREE.ShaderChunk", () => {
    expect(resolveIncludes("#include <common>")).toContain("#define PI 3.141592653589793");
    expect(() => resolveIncludes("#include <nope>")).toThrow(/nope/);
  });

  it("find uniforms that are not wired", () => {
    const material = new THREE.ShaderMaterial({
      vertexShader: "void main() { gl_Position = vec4(position, 1.0); }",
      fragmentShader:
        "uniform vec3 uColor; uniform float uGain; void main() { gl_FragColor = vec4(uColor * uGain, 1.0); }",
      uniforms: { uColor: { value: new THREE.Color() }, uGain: { value: new THREE.Vector2() } },
    });
    const use = { label: "test", material, instancing: false, geometries: new Set<THREE.BufferGeometry>() };
    expect(() => expectUniformsWired(use)).toThrow(/vec2|float uGain/);
    expect(valueFits("vec4[]", [new THREE.Vector4()])).toBe(true);
    expect(valueFits("sampler2D", null)).toBe(true);
    expect(valueFits("bvec2", true)).toBe(false);
  });
});

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
        "LEG_VERTEX LEG_DEPTH_FRAGMENT x6",
        "LEG_VERTEX LEG_FRAGMENT x6",
        "OUTLINE_VERTEX OUTLINE_FRAGMENT x6",
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
          "uNailCenter",
          "uNailForward",
          "uNailNormal",
          "uOpacity",
          "uOverlay",
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
          "uUnder",
          "uWetDye",
          "uWetMap",
          "uWetMapSlot",
        ],
      }
    `);
  });
});
