import { afterEach, describe, expect, it } from "vitest";
import { accentDyeFor, COLOR_ORDER, COLORS, hexToRgb, resolveColor } from "../../../src/engine/catalog/colors";
import type { ColorStyle } from "../../../src/engine/catalog/colors";
import {
  BARE_SKIN_WATER,
  CUFF_STYLE_ORDER,
  CUFF_STYLES,
  DENIER_OPTIONS,
  MATERIAL_ORDER,
  MATERIALS,
  PATTERN_ORDER,
  PATTERNS,
  SECRET_DECAL_ORDER,
  SECRET_DECALS,
  STOCKING_LENGTH_ORDER,
  STOCKING_LENGTHS,
} from "../../../src/engine/catalog/garments";
import { DEFAULT_LEG_SPEC, PRESETS, randomLegSpec, withLegDefaults } from "../../../src/engine/catalog/presets";
import type { LegSpec } from "../../../src/engine/catalog/presets";
import { resolveLegLook } from "../../../src/engine/catalog/resolveLegLook";
import type { LegLook } from "../../../src/engine/catalog/resolveLegLook";
import { seedRandom } from "../../helpers/random";

const HEX = /^#[0-9a-f]{6}$/;

/** Test-only escape hatch for specs with keys the types do not allow (as hand-edited specs might have). */
const looseSpec = (spec: Record<string, unknown>): Partial<LegSpec> => spec as Partial<LegSpec>;

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function expectFiniteLook(look: LegLook): void {
  const numbers = [
    look.through,
    look.sheenAmt,
    look.stripe,
    look.denier,
    look.pattern,
    look.gloss,
    look.cuffY,
    look.hasCuff,
    look.cuff,
    look.band,
    look.garter,
    look.print,
    look.secret,
    look.fade0,
    look.fade1,
    ...look.shade,
    ...look.mat,
    ...look.mat2,
    ...Object.values(look.water),
  ];
  expect(numbers.every(Number.isFinite)).toBe(true);
  for (const color of [look.dye, look.dye2, look.sheen, look.outline, look.secretColor]) {
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  }
  if (look.wetDye !== null) {
    expect(look.wetDye).toMatch(/^#[0-9a-fA-F]{6}$/);
  }
}

describe("catalog tables", () => {
  it.each([
    ["colors", COLOR_ORDER, COLORS],
    ["lengths", STOCKING_LENGTH_ORDER, STOCKING_LENGTHS],
    ["cuffs", CUFF_STYLE_ORDER, CUFF_STYLES],
    ["materials", MATERIAL_ORDER, MATERIALS],
    ["patterns", PATTERN_ORDER, PATTERNS],
    ["secrets", SECRET_DECAL_ORDER, SECRET_DECALS],
  ] as const)("orders every %s entry exactly once", (_name, order, table) => {
    expect([...order].sort()).toEqual(Object.keys(table).sort());
    expect(new Set(order).size).toBe(order.length);
  });

  it("gives patterns and secret decals unique shader ids", () => {
    for (const table of [PATTERNS, SECRET_DECALS]) {
      const ids = Object.values(table).map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("keeps palette colors as lowercase hex with shading in range", () => {
    for (const color of Object.values(COLORS)) {
      expect(color.dye).toMatch(HEX);
      expect(color.sheen).toMatch(HEX);
      expect(color.outline).toMatch(HEX);
      expect(color.shade.every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  });

  it("only lists the default denier among the denier options", () => {
    expect(DENIER_OPTIONS).toContain(DEFAULT_LEG_SPEC.denier);
  });
});

describe("hexToRgb", () => {
  it("converts #rrggbb to 0..1 channels", () => {
    expect(hexToRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#FFFFFF")).toEqual([1, 1, 1]);
  });

  it("round-trips through the custom color derivation", () => {
    for (const hex of ["#000000", "#ffffff", "#123456", "#abcdef", "#7f00ff"]) {
      const style = resolveColor(hex);
      expect(style.dye).toBe(hex);
      const back =
        "#" +
        hexToRgb(style.dye)
          .map((c) =>
            Math.round(c * 255)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");
      expect(back).toBe(hex);
    }
  });
});

describe("resolveColor", () => {
  it("returns palette entries as they are", () => {
    expect(resolveColor("wine")).toBe(COLORS.wine);
  });

  it("derives a full style for custom colors", () => {
    const round = (style: ColorStyle) => ({
      ...style,
      shade: style.shade.map((v) => Math.round(v * 1e6) / 1e6),
      through: Math.round(style.through * 1e6) / 1e6,
      sheenAmt: Math.round(style.sheenAmt * 1e6) / 1e6,
      stripe: Math.round(style.stripe * 1e6) / 1e6,
    });
    expect(["#336699", "#000000", "#ffffff", "#ff0000"].map((hex) => round(resolveColor(hex)))).toMatchInlineSnapshot(`
      [
        {
          "dye": "#336699",
          "outline": "#172e45",
          "shade": [
            0.674265,
            0.703332,
            0.825777,
          ],
          "sheen": "#d2dde9",
          "sheenAmt": 0.314384,
          "stripe": 0.776848,
          "through": 0.268731,
        },
        {
          "dye": "#000000",
          "outline": "#0c0b0e",
          "shade": [
            0.62,
            0.6,
            0.72,
          ],
          "sheen": "#c7c7c7",
          "sheenAmt": 0.24,
          "stripe": 1,
          "through": 0.08,
        },
        {
          "dye": "#ffffff",
          "outline": "#737373",
          "shade": [
            0.84,
            0.8,
            0.92,
          ],
          "sheen": "#ffffff",
          "sheenAmt": 0.24,
          "stripe": 0.4,
          "through": 0.08,
        },
        {
          "dye": "#ff0000",
          "outline": "#730000",
          "shade": [
            0.784047,
            0.564134,
            0.618134,
          ],
          "sheen": "#ffc7c7",
          "sheenAmt": 0.28252,
          "stripe": 0.87244,
          "through": 0.387472,
        },
      ]
    `);
  });

  it("darkens and neutralises outlines of very dark colors", () => {
    // Below luma 0.15 the outline is pulled 60% towards a neutral near-black.
    expect(resolveColor("#000000").outline).toBe("#0c0b0e");
    expect(resolveColor("#202020").outline).toBe("#121014");
    expect(resolveColor("#808080").outline).toBe("#3a3a3a");
  });

  it("keeps derived values in sensible ranges for any color", () => {
    const rng = lcg(3);
    for (let i = 0; i < 200; i++) {
      const hex =
        "#" +
        Math.floor(rng() * 0x1000000)
          .toString(16)
          .padStart(6, "0");
      const style = resolveColor(hex);
      expect(style.sheen).toMatch(HEX);
      expect(style.outline).toMatch(HEX);
      expect(style.through).toBeGreaterThanOrEqual(0.08);
      expect(style.through).toBeLessThanOrEqual(0.42);
      expect(style.sheenAmt).toBeGreaterThanOrEqual(0.24);
      expect(style.sheenAmt).toBeLessThanOrEqual(0.34);
      expect(style.stripe).toBeGreaterThanOrEqual(0.4);
      expect(style.stripe).toBeLessThanOrEqual(1);
      expect(style.shade.every((v) => v >= 0.5 && v <= 0.92)).toBe(true);
    }
  });
});

describe("accentDyeFor", () => {
  it("uses pink accents on light colors and off-white on dark ones", () => {
    expect(accentDyeFor("ivory")).toBe("#f29bb4");
    expect(accentDyeFor("#ffffff")).toBe("#f29bb4");
    expect(accentDyeFor("sakura")).toBe("#f29bb4");
    expect(accentDyeFor("ink")).toBe("#f6f3f4");
    expect(accentDyeFor("mist")).toBe("#f6f3f4");
    expect(accentDyeFor("#123456")).toBe("#f6f3f4");
  });
});

describe("withLegDefaults", () => {
  it("fills missing keys from the defaults without sharing the default object", () => {
    expect(withLegDefaults()).toEqual(DEFAULT_LEG_SPEC);
    expect(withLegDefaults()).not.toBe(DEFAULT_LEG_SPEC);
    expect(withLegDefaults({ color: "#123456", garter: true })).toEqual({
      ...DEFAULT_LEG_SPEC,
      color: "#123456",
      garter: true,
    });
  });
});

describe("resolveLegLook", () => {
  it("resolves every preset leg to finite shader parameters", () => {
    for (const preset of PRESETS) {
      const legs = preset.legs ?? [preset.both!, preset.both!];
      expect(preset.both === undefined).toBe(preset.legs !== undefined);
      for (const leg of legs) {
        const look = resolveLegLook(leg);
        expectFiniteLook(look);
        expect(look.spec).toEqual(withLegDefaults(leg));
      }
    }
  });

  it("pins the default look", () => {
    expect(resolveLegLook()).toMatchInlineSnapshot(`
      {
        "band": 0.05,
        "bare": 0,
        "bow": false,
        "cuff": 1,
        "cuffY": 0.7,
        "denier": 40,
        "dye": "#141318",
        "dye2": "#f6f3f4",
        "fade0": 0.79,
        "fade1": 0.868,
        "garter": 0,
        "gloss": 1,
        "hasCuff": 1,
        "mat": [
          0.66,
          0.45,
          0,
          0,
        ],
        "mat2": [
          0.55,
          0,
          2,
          1,
        ],
        "outline": "#141218",
        "pattern": 0,
        "print": 0,
        "secret": 0,
        "secretColor": "#ffd7e2",
        "shade": [
          0.62,
          0.6,
          0.72,
        ],
        "sheen": "#b8b2cf",
        "sheenAmt": 0.26,
        "skinVisible": true,
        "spec": {
          "color": "ink",
          "cuff": "lace",
          "denier": 40,
          "garter": false,
          "length": "thigh",
          "material": "sheer",
          "pattern": "none",
          "secret": "none",
          "wetColor": null,
        },
        "stripe": 1,
        "through": 0.1,
        "water": {
          "bead": 1,
          "slip": 1,
          "soak": 1,
          "take": 1,
          "wick": 1,
        },
        "wetDye": null,
      }
    `);
  });

  it("raises the denier to the material minimum", () => {
    expect(resolveLegLook({ material: "latex", denier: 15 }).denier).toBe(900);
    expect(resolveLegLook({ material: "sheer", denier: 70 }).denier).toBe(70);
  });

  it("drops the cuff, bow and visible skin for tights", () => {
    const tights = resolveLegLook({ length: "tights", cuff: "bow" });
    expect([tights.hasCuff, tights.bow, tights.skinVisible, tights.fade0, tights.fade1]).toEqual([
      0,
      false,
      false,
      0.7,
      0.812,
    ]);
    const bow = resolveLegLook({ length: "over", cuff: "bow" });
    expect([bow.hasCuff, bow.bow, bow.skinVisible, bow.fade0, bow.fade1]).toEqual([1, true, true, 0.79, 0.868]);
  });

  it("turns bare legs into skin with no cuff decoration, decals or fabric water", () => {
    const bare = resolveLegLook({
      length: "bare",
      cuff: "bow",
      garter: true,
      material: "latex",
      secret: "hearts",
      wetColor: "sakura",
    });
    expect([bare.hasCuff, bare.cuff, bare.bow, bare.garter, bare.secret, bare.wetDye]).toEqual([
      1,
      CUFF_STYLES.plain.id,
      false,
      0,
      0,
      null,
    ]);
    expect([bare.skinVisible, bare.fade0, bare.fade1]).toEqual([true, 0.79, 0.868]);
    expect(bare.water).toBe(BARE_SKIN_WATER);
    expect(resolveLegLook({ length: "bare", material: "cotton" }).water).toBe(BARE_SKIN_WATER);
  });

  it("only shows a garter on thigh-high stockings", () => {
    expect(resolveLegLook({ length: "thigh", garter: true }).garter).toBe(1);
    expect(resolveLegLook({ length: "over", garter: true }).garter).toBe(0);
    expect(resolveLegLook({ length: "tights", garter: true }).garter).toBe(0);
    expect(resolveLegLook({ length: "thigh", garter: false }).garter).toBe(0);
  });

  it("picks a secret decal color that contrasts with the dye", () => {
    expect(resolveLegLook({ color: "ivory" }).secretColor).toBe("#e8456e");
    expect(resolveLegLook({ color: "ink" }).secretColor).toBe("#ffd7e2");
  });

  it("resolves wet colors from the palette or custom hex", () => {
    expect(resolveLegLook({ wetColor: "sakura" }).wetDye).toBe(COLORS.sakura.dye);
    expect(resolveLegLook({ wetColor: "#00ff00" }).wetDye).toBe("#00ff00");
    expect(resolveLegLook({ wetColor: null }).wetDye).toBeNull();
  });

  it("combines palette sheen with the material sheen and copies material parameters", () => {
    const look = resolveLegLook({ material: "velvet", color: "wine", pattern: "stars", secret: "paws", cuff: "rib" });
    expect(look.sheenAmt).toBeCloseTo(COLORS.wine.sheenAmt * MATERIALS.velvet.sheen, 12);
    expect(look.mat).toEqual([0.1, 0.6, 0, 0]);
    expect(look.mat2).toEqual([0.18, 0, 1.3, 1]);
    expect(look.water).toBe(MATERIALS.velvet.water);
    expect([look.pattern, look.secret, look.cuff]).toEqual([8, 3, 3]);
  });

  it("falls back to safe defaults for unknown keys", () => {
    const look = resolveLegLook(
      looseSpec({ length: "socklet", cuff: "frill", material: "silk", pattern: "plaid", secret: "ghost" }),
    );
    const fallback = resolveLegLook({
      length: "thigh",
      cuff: "plain",
      material: "sheer",
      pattern: "none",
      secret: "none",
    });
    expect({ ...look, spec: null }).toEqual({ ...fallback, spec: null });
    expect(look.spec.length).toBe("socklet");
  });
});

describe("randomLegSpec", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("only produces valid, resolvable combinations", () => {
    const rng = lcg(11);
    const seen = { garter: false, secret: false, wet: false, tights: false, cotton: false };
    for (let i = 0; i < 400; i++) {
      const spec = randomLegSpec(rng);
      expect(STOCKING_LENGTHS[spec.length]).toBeDefined();
      expect(CUFF_STYLES[spec.cuff]).toBeDefined();
      expect(PATTERNS[spec.pattern]).toBeDefined();
      expect(SECRET_DECALS[spec.secret]).toBeDefined();
      expect(COLOR_ORDER).toContain(spec.color);
      expect(DENIER_OPTIONS).toContain(spec.denier);
      const thick = MATERIALS[spec.material].minDenier > 0;
      if (spec.length === "tights") {
        expect(spec.cuff).toBe("plain");
        seen.tights = true;
      }
      if (spec.material === "cotton") {
        expect(spec.length).not.toBe("tights");
        expect(["plain", "stripes", "rib"]).toContain(spec.cuff);
        seen.cotton = true;
      } else {
        expect(["ankle", "crew"]).not.toContain(spec.length);
      }
      if (thick) {
        expect(["none", "hoops", "dots", "hearts", "stars", "paws"]).toContain(spec.pattern);
      }
      if (spec.garter) {
        expect(spec.length).toBe("thigh");
        expect(thick).toBe(false);
        seen.garter = true;
      }
      seen.secret ||= spec.secret !== "none";
      if (spec.wetColor !== null) {
        expect(["sakura", "mist", "taro"]).toContain(spec.wetColor);
        seen.wet = true;
      }
      expectFiniteLook(resolveLegLook(spec));
    }
    expect(seen).toEqual({ garter: true, secret: true, wet: true, tights: true, cotton: true });
  });

  it("is deterministic for a given random source and defaults to Math.random", () => {
    restore = seedRandom(42);
    const fromMath = [randomLegSpec(), randomLegSpec(), randomLegSpec()];
    const rng = lcg(42);
    expect([randomLegSpec(rng), randomLegSpec(rng), randomLegSpec(rng)]).toEqual(fromMath);
    expect(fromMath).toMatchInlineSnapshot(`
      [
        {
          "color": "coffee",
          "cuff": "lace",
          "denier": 15,
          "garter": false,
          "length": "knee",
          "material": "sheer",
          "pattern": "pins",
          "secret": "none",
          "wetColor": null,
        },
        {
          "color": "sakura",
          "cuff": "stripes",
          "denier": 120,
          "garter": false,
          "length": "thigh",
          "material": "cotton",
          "pattern": "stars",
          "secret": "none",
          "wetColor": "sakura",
        },
        {
          "color": "cherry",
          "cuff": "plain",
          "denier": 15,
          "garter": false,
          "length": "tights",
          "material": "latex",
          "pattern": "paws",
          "secret": "none",
          "wetColor": null,
        },
      ]
    `);
  });
});
