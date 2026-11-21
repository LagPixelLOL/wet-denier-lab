import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MATERIALS, MATERIAL_ORDER } from "../../../src/engine/catalog/garments";
import {
  FUZZ_WET_SHINE,
  LEG_FRAGMENT_SHADER,
  RIB_THROUGH,
  SHINE_ENV,
  SHINE_KEY,
  STITCH_SHADE,
} from "../../../src/engine/stage/shaders/leg";
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
        "CASTER_VERTEX CASTER_COVER_FRAGMENT x2",
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
        "LEG_VERTEX LEG_DEPTH_FRAGMENT x14",
        "LEG_VERTEX LEG_DEPTH_FRAGMENT CURTAIN=1 x6",
        "LEG_VERTEX LEG_DEPTH_FRAGMENT CURTAIN=1 VEIL=1 x2",
        "LEG_VERTEX LEG_DEPTH_FRAGMENT FAR_PLANE=1 x2",
        "LEG_VERTEX LEG_FRAGMENT x8",
        "LEG_VERTEX LEG_FRAGMENT FADE_ZONE=1 x2",
        "LEG_VERTEX LEG_FRAGMENT HIGH_PART=1 x4",
        "LEG_VERTEX LEG_FRAGMENT LEG_INSIDE=1 x2",
        "LEG_VERTEX LEG_FRAGMENT LOW_PART=1 x2",
        "OUTLINE_VERTEX OUTLINE_FRAGMENT x2",
        "OUTLINE_VERTEX OUTLINE_FRAGMENT SOLID_LINE=1 x2",
        "OUTLINE_VERTEX OUTLINE_FRAGMENT TOP_LINE=1 x4",
        "WET_BAKE_VERTEX WET_BAKE_FRAGMENT x2",
        "WET_STAMP_VERTEX WET_STAMP_FRAGMENT x1",
      ]
    `);
  });
});

describe("leg, bow, outline, shadow and post shaders", () => {
  defineProgramSuite(isStageProgram);

  it("has a shiny material mirror the room less than water on it does, and take dimmer highlights from the lamps", () => {
    for (const amount of [SHINE_ENV, SHINE_KEY]) {
      expect(amount).toBeGreaterThan(0.2);
      expect(amount).toBeLessThan(0.8);
    }
    expect(LEG_FRAGMENT_SHADER).toContain(
      `float specAmt = max(waterSpec, shineSpec), envAmt = max(waterSpec, shineSpec * ${SHINE_ENV.toFixed(2)});`,
    );
    expect(LEG_FRAGMENT_SHADER).toContain(`float keyAmt = max(waterSpec, shineSpec * ${SHINE_KEY.toFixed(2)});`);
    // The lamps' highlights by keyAmt, the surroundings by envAmt; specAmt only says whether anything shines.
    expect(LEG_FRAGMENT_SHADER).toMatch(/col \+= uKeyColor \* \([^;]*\) \* keyAmt \+ env \* fres \* 0\.9 \* envAmt;/);
    expect(LEG_FRAGMENT_SHADER).toContain("if (specAmt > 0.0) {");
  });

  describe("water on a fuzzy fabric", () => {
    // The shader's measure of a fuzzy fabric, from its gloss.
    const fuzz = (gloss: number) => 1 - THREE.MathUtils.smoothstep(gloss, 0.1, 0.25);

    it("counts cotton and velvet as fuzzy, and no other material", () => {
      expect(LEG_FRAGMENT_SHADER).toContain("float fuzz = (1.0 - smoothstep(0.1, 0.25, uGloss)) * fabric,");
      for (const key of MATERIAL_ORDER) {
        expect([key, fuzz(MATERIALS[key].gloss)]).toEqual([key, key === "cotton" || key === "velvet" ? 1 : 0]);
      }
    });

    it("leaves only a little of a water film's shine, however much water there is", () => {
      expect(FUZZ_WET_SHINE).toBeGreaterThan(0.01);
      expect(FUZZ_WET_SHINE).toBeLessThan(0.1);
      expect(LEG_FRAGMENT_SHADER).toContain(`float waterGloss = mix(1.0, ${FUZZ_WET_SHINE.toFixed(2)}, fuzz);`);
      // Fresh hits on top of each other add up past a full film's shine: on a fuzzy fabric that is capped first.
      expect(LEG_FRAGMENT_SHADER).toContain("waterSpec = mix(waterSpec, min(waterSpec, 1.0), fuzz) * waterGloss * ");
    });

    it("shines as a soft glow: no mirror-sharp highlight, no streak along the leg, no glitter", () => {
      // Of the highlight's parts only the broad one is left (half as strong 14 degrees off the mirror angle).
      expect(LEG_FRAGMENT_SHADER).toContain(
        "float spec = mix(smoothstep(0.962, 0.982, ndh) * 1.4 + pow(ndh, 140.0) * 0.6 + pow(ndh, 22.0) * 0.22, pow(ndh, 22.0), fuzz);",
      );
      expect(Math.cos((14.4 * Math.PI) / 180) ** 22).toBeCloseTo(0.5, 2);
      expect(LEG_FRAGMENT_SHADER).toMatch(/float glint = [^;]* \* onLeg \* \(1\.0 - fuzz\);/);
      // The glitter starts at 0.2: what is left of a film on a fuzzy fabric stays below that.
      expect(LEG_FRAGMENT_SHADER).toContain(
        "float sparkAmt = max(max(film, wetness * 0.22) * waterGloss, pearl * 0.8);",
      );
      expect(LEG_FRAGMENT_SHADER).toContain("if (sparkAmt > 0.2) {");
      expect(FUZZ_WET_SHINE).toBeLessThan(0.2);
    });

    it("has no bright line around the wet patch: that is the edge of the water on a smooth yarn", () => {
      expect(LEG_FRAGMENT_SHADER).toContain("wetRing *= edgeAmt * (1.0 - fuzz);");
      expect(LEG_FRAGMENT_SHADER).toContain("col += uKeyColor * wetRing * 0.22 * smoothstep(-0.3, 0.4, ndl) * lit;");
      // The darker line where the water stops stays: fabric dries to a tide line.
      expect(LEG_FRAGMENT_SHADER).toContain("wetEdge *= edgeAmt;");
      expect(LEG_FRAGMENT_SHADER).toContain("col *= 1.0 - wetEdge * 0.38;");
    });
  });

  describe("water and latex", () => {
    // The shader's measure of a material that is all shine.
    const allShine = (shine: number) => THREE.MathUtils.smoothstep(shine, 0.5, 1);

    it("counts latex as all shine, and no other material: it is also the one that takes no water in", () => {
      expect(LEG_FRAGMENT_SHADER).toContain("float allShine = smoothstep(0.5, 1.0, uMatWet.z) * fabric;");
      for (const key of MATERIAL_ORDER) {
        const { shine, water } = MATERIALS[key];
        expect([key, allShine(shine)]).toEqual([key, key === "latex" ? 1 : 0]);
        expect([key, water.soak === 0 && water.take === 0]).toEqual([key, key === "latex"]);
      }
      // The glossy nylon has a little shine of its own, and stays a nylon.
      expect(MATERIALS.gloss.shine).toBeGreaterThan(0);
    });

    it("adds no shine: no brighter patch where the latex is wet, no white flash where it is hit", () => {
      expect(LEG_FRAGMENT_SHADER).toContain("float waterSpec = max(max(film, wetness * 0.55), fresh * 0.8);");
      expect(LEG_FRAGMENT_SHADER).toMatch(/waterSpec = [^;]* \* \(1\.0 - allShine\);/);
    });

    it("shows nothing of what another fabric, or the bare leg, soaked up before the latex went on", () => {
      // The wet map keeps it, for the skin above the stocking and for when the other fabric is back. On the
      // latex there is no wet patch, no line around one (bright or dark), and no hidden print brought out by it.
      expect(LEG_FRAGMENT_SHADER).toContain("wetness *= 1.0 - allShine;");
      expect(LEG_FRAGMENT_SHADER).toContain("float edgeAmt = mix(0.3, 1.0, fabric) * (1.0 - allShine);");
      expect(LEG_FRAGMENT_SHADER).toContain("wetEdge *= edgeAmt;");
      expect(LEG_FRAGMENT_SHADER).toContain("wetRing *= edgeAmt * (1.0 - fuzz);");
      expect(LEG_FRAGMENT_SHADER).toContain("max(soak * (1.0 - allShine), wet.g * 0.6)");
      // It is set once the cuff has decided where the fabric ends, and before anything of the fabric uses it.
      const at = (text: string) => LEG_FRAGMENT_SHADER.indexOf(text);
      expect(at("fabric *= 1.0 - cut;")).toBeGreaterThan(0);
      expect(at("wetness *= 1.0 - allShine;")).toBeGreaterThan(at("fabric *= 1.0 - cut;"));
      expect(at("denier *= 1.0 - uMatWet.x * wetness;")).toBeGreaterThan(at("wetness *= 1.0 - allShine;"));
    });
  });

  it("keeps the long highlight along the leg a streak where the surface faces the light", () => {
    // Across the leg the highlight falls off steeply from where the surface faces the light (a twentieth power:
    // half strength 15 degrees to either side). With a broad falloff, and a good part of the highlight given to
    // the whole leg whichever way it faced, a leg seen right at the angle that mirrors the lamp washed out white.
    expect(LEG_FRAGMENT_SHADER).toContain("mix(1.0, pow(hdn, 20.0), uHighlightFalloff)");
    expect(Math.cos((15 * Math.PI) / 180) ** 20).toBeCloseTo(0.5, 1);
    expect(LEG_FRAGMENT_SHADER).toContain("col += uKeyColor * sheenStripe * uStripe * uGloss * 0.55 * fabric");
    // The tight glint on wet and shiny surfaces is kept to the same streak.
    expect(LEG_FRAGMENT_SHADER).toMatch(/float glint = [^;]* \* lobe \* /);
  });

  describe("the ribs and stitches of a knit, by how light its yarn is", () => {
    // The shader's measures: how much a fold shades a fabric of this albedo, and how much of the skin shows
    // through the yarn itself between two ribs.
    const foldLit = (folds: number, albedo: number) => folds / (1 - albedo * (1 - folds));
    const yarnThrough = (albedo: number, ribWave: number) => RIB_THROUGH * albedo * (1 - ribWave) ** 2;
    const [white, grey, black] = [0.9, 0.17, 0.0064];

    it("shades a light fabric between its ribs far less than a dark one: no grey stripes on white", () => {
      expect(LEG_FRAGMENT_SHADER).toContain("ribShade = mix(1.0, 0.82 + 0.3 * ribWave, ribAmt);");
      expect(LEG_FRAGMENT_SHADER).toContain("vec3 foldLit = folds / (1.0 - dyeDark * (1.0 - folds));");
      expect(LEG_FRAGMENT_SHADER).toMatch(/vec3 fabCol = dyeDark \* [^;]* \* foldLit \* /);
      expect(LEG_FRAGMENT_SHADER).not.toMatch(/vec3 fabCol = [^;]* \* ribShade/);
      // Between two ribs, where the shade is deepest: black yarn keeps all of it, white yarn next to none.
      expect(foldLit(0.82, black)).toBeCloseTo(0.82, 2);
      expect(foldLit(0.82, grey)).toBeCloseTo(0.846, 3);
      expect(foldLit(0.82, white)).toBeGreaterThan(0.97);
      // On a rib, where the fabric is lit more than its share, likewise.
      expect(foldLit(1.12, black)).toBeCloseTo(1.12, 2);
      expect(foldLit(1.12, white)).toBeLessThan(1.02);
      // No fold, no change; and the lighter the fabric, the less a fold shades it.
      for (const albedo of [black, grey, white]) {
        expect(foldLit(1, albedo)).toBe(1);
      }
      expect(foldLit(0.6, grey)).toBeGreaterThan(foldLit(0.6, black));
      expect(foldLit(0.6, white)).toBeGreaterThan(foldLit(0.6, grey));
    });

    it("lets the skin show through light yarn itself between the ribs, however little the knit is stretched", () => {
      expect(LEG_FRAGMENT_SHADER).toContain(
        "float yarnAlbedo = dot(dye, vec3(0.2126, 0.7152, 0.0722)), yarnLight = sqrt(yarnAlbedo);",
      );
      expect(LEG_FRAGMENT_SHADER).toContain(
        `yarnThrough = ${RIB_THROUGH.toFixed(2)} * yarnAlbedo * ribAmt * (1.0 - ribWave) * (1.0 - ribWave);`,
      );
      // It adds to what shows between the stitches, before the angle of view and the knit's pattern weigh in.
      expect(LEG_FRAGMENT_SHADER).toMatch(
        /float trans0 = exp\(-denier \/ 50\.0\);\s+trans0 \+= \(1\.0 - trans0\) \* yarnThrough;\s+float transView = /,
      );
      // The knit itself is as thin between the ribs as it was, whatever its color: dark yarn looks as it did.
      expect(LEG_FRAGMENT_SHADER).toContain("denier *= mix(1.0, 0.7 + 0.6 * ribWave, ribAmt);");
      expect(yarnThrough(black, 0)).toBeLessThan(0.003);
      expect(yarnThrough(grey, 0)).toBeGreaterThan(0.04);
      expect(yarnThrough(white, 0)).toBeGreaterThan(0.25);
      // Between the ribs only.
      expect(yarnThrough(white, 1)).toBe(0);
      expect(yarnThrough(white, 0.5)).toBeCloseTo(yarnThrough(white, 0) / 4, 12);
    });

    it("shows the stitches of a fuzzy fabric in its color, the more the lighter the yarn", () => {
      expect(LEG_FRAGMENT_SHADER).toContain(
        `float folds = ribShade * mix(1.0, knit / uKnitMean, ${STITCH_SHADE.toFixed(2)} * yarnLight * knitAmt * fuzz);`,
      );
      // Cotton is knit from thick yarn and fuzzy; hosiery is neither, and its color stays free of the pattern.
      expect(MATERIALS.cotton.knit).toBe(1);
      expect(MATERIALS.cotton.gloss).toBeLessThan(0.1);
      expect(MATERIALS.sheer.gloss).toBeGreaterThan(0.25);
      // Between two stitches (the pattern at nothing), by the yarn: black as it was, grey and white shaded.
      const between = (albedo: number) => foldLit(1 - STITCH_SHADE * Math.sqrt(albedo), albedo);
      expect(between(black)).toBeGreaterThan(0.95);
      expect(between(grey)).toBeLessThan(0.85);
      expect(between(white)).toBeLessThan(0.95);
      expect(between(white)).toBeGreaterThan(0.85);
    });
  });

  describe("what belongs to the leg's outline", () => {
    // The shader's measure, for a round leg along `axis`, a surface normal across it and a direction to the eye.
    const outline = (normal: number[], axis: number[], toEye: number[]): number => {
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const unit = (a: number[]) => a.map((c) => c / Math.hypot(...a));
      const [n, v] = [unit(normal), unit(toEye)];
      const fiber = unit(axis.map((c, i) => c - n[i] * dot(n, axis)));
      const ndv = Math.min(Math.max(dot(n, v), 0), 1);
      const alongView = dot(fiber, v);
      return 1 - Math.min(Math.max(ndv / Math.max(Math.sqrt(Math.max(1 - alongView * alongView, 0)), 0.05), 0), 1);
    };
    const up = [0, 1, 0];
    const around = (degrees: number) => [Math.sin((degrees * Math.PI) / 180), 0, Math.cos((degrees * Math.PI) / 180)];
    const from = (elevation: number) => [
      0,
      Math.sin((elevation * Math.PI) / 180),
      Math.cos((elevation * Math.PI) / 180),
    ];

    it("is the angle to the line of sight for a leg seen from the side", () => {
      for (const turned of [0, 20, 45, 70, 89]) {
        expect(outline(around(turned), up, from(0))).toBeCloseTo(1 - Math.cos((turned * Math.PI) / 180), 12);
      }
    });

    it("stays at the leg's outline when the leg is seen from above or below", () => {
      for (const elevation of [66, -66, 40, -38]) {
        // The middle of the leg as seen from there is not at its outline, however flat the view onto it...
        expect(outline(around(0), up, from(elevation))).toBeCloseTo(0, 12);
        // ...and the further round the leg, the nearer its outline, exactly as from the side.
        for (const turned of [20, 45, 70, 89]) {
          expect(outline(around(turned), up, from(elevation))).toBeCloseTo(1 - Math.cos((turned * Math.PI) / 180), 9);
        }
      }
      // Going by the angle to the line of sight, the whole leg counted as outline from 66 degrees up: even its
      // middle was three fifths of the way there.
      expect(1 - Math.cos((66 * Math.PI) / 180)).toBeGreaterThan(0.59);
    });

    it("does not blow up for a leg seen straight along its length", () => {
      for (const turned of [0, 45, 89]) {
        const value = outline(around(turned), up, from(89.9));
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });

    it("drives the rim lights and the fabric's sheen, and nothing that depends on the true angle", () => {
      expect(LEG_FRAGMENT_SHADER).toContain(
        "float outline = 1.0 - clamp(ndv / max(sqrt(max(1.0 - alongView * alongView, 0.0)), 0.05), 0.0, 1.0);",
      );
      expect(LEG_FRAGMENT_SHADER).toContain("float rim = smoothstep(0.62, 0.86, outline) *");
      expect(LEG_FRAGMENT_SHADER).toContain("col += uRim2Color * smoothstep(0.55, 0.86, outline) *");
      expect(LEG_FRAGMENT_SHADER).toContain("fabCol += uSheenColor * pow(outline, uMatKnit.z) * uSheenAmount");
      // A mirror-like surface does reflect more at a glancing angle all over, and fabric is denser seen along it.
      expect(LEG_FRAGMENT_SHADER).toContain("float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);");
      expect(LEG_FRAGMENT_SHADER).toContain("float transView = pow(trans0, 1.0 / max(ndv, 0.035));");
      expect(LEG_FRAGMENT_SHADER).not.toMatch(/smoothstep\([^)]*, 1\.0 - ndv\)/);
    });
  });

  it("blends the cuff's density into the stocking's, never through a marker value", () => {
    // Fading the cuff's density toward a "no cuff" marker of -1 made the fabric all but transparent for a pixel
    // along the cuff's lower edge, where the skin then showed as a bright dotted line.
    expect(LEG_FRAGMENT_SHADER).toContain("denier = mix(denier, cuffDen, cuffAmt);");
    expect(LEG_FRAGMENT_SHADER).not.toMatch(/cuffDen = mix\(/);
    expect(LEG_FRAGMENT_SHADER).not.toMatch(/cuffDen\s*(>=|<|>|<=)\s*0\.0/);
    // Both kinds of cuff say how much of them there is at their lower edge.
    expect(LEG_FRAGMENT_SHADER.match(/cuffAmt = 1\.0 - /g)).toHaveLength(2);
  });

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
        "CASTER_VERTEX CASTER_FRAGMENT": [
          "uFadeStart",
        ],
        "LEG_VERTEX LEG_DEPTH_FRAGMENT": [
          "uBand",
          "uCastShadowCover",
          "uCastShadowMap",
          "uCastShadowMatrix",
          "uCastShadowStrength",
          "uCastShadowTexel",
          "uCaustic",
          "uCover",
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
          "uInto",
          "uKeyColor",
          "uKeyDir",
          "uKnitMean",
          "uKnitTex",
          "uMatKnit",
          "uMatWet",
          "uMirror",
          "uMirrorFalloff",
          "uNailCenter",
          "uNailForward",
          "uNailNormal",
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
          "uToe",
          "uWetDye",
          "uWetMap",
          "uWetMapSlot",
        ],
        "LEG_VERTEX LEG_DEPTH_FRAGMENT CURTAIN=1": [
          "uBand",
          "uCastShadowCover",
          "uCastShadowMap",
          "uCastShadowMatrix",
          "uCastShadowStrength",
          "uCastShadowTexel",
          "uCaustic",
          "uCover",
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
          "uInto",
          "uKeyColor",
          "uKeyDir",
          "uKnitMean",
          "uKnitTex",
          "uMatKnit",
          "uMatWet",
          "uMirror",
          "uMirrorFalloff",
          "uNailCenter",
          "uNailForward",
          "uNailNormal",
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
          "uToe",
          "uWetDye",
          "uWetMap",
          "uWetMapSlot",
        ],
        "LEG_VERTEX LEG_DEPTH_FRAGMENT CURTAIN=1 VEIL=1": [
          "uBand",
          "uCastShadowCover",
          "uCastShadowMap",
          "uCastShadowMatrix",
          "uCastShadowStrength",
          "uCastShadowTexel",
          "uCaustic",
          "uCover",
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
          "uInto",
          "uKeyColor",
          "uKeyDir",
          "uKnitMean",
          "uKnitTex",
          "uMatKnit",
          "uMatWet",
          "uMirror",
          "uMirrorFalloff",
          "uNailCenter",
          "uNailForward",
          "uNailNormal",
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
          "uToe",
          "uWetDye",
          "uWetMap",
          "uWetMapSlot",
        ],
        "LEG_VERTEX LEG_DEPTH_FRAGMENT FAR_PLANE=1": [
          "uBand",
          "uCastShadowCover",
          "uCastShadowMap",
          "uCastShadowMatrix",
          "uCastShadowStrength",
          "uCastShadowTexel",
          "uCaustic",
          "uCover",
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
          "uInto",
          "uKeyColor",
          "uKeyDir",
          "uKnitMean",
          "uKnitTex",
          "uMatKnit",
          "uMatWet",
          "uMirror",
          "uMirrorFalloff",
          "uNailCenter",
          "uNailForward",
          "uNailNormal",
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
          "uToe",
          "uWetDye",
          "uWetMap",
          "uWetMapSlot",
        ],
      }
    `);
  });
});
