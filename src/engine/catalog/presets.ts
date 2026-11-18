/**
 * Leg spec defaults, the outfit presets and the random outfit generator.
 */
import { COLOR_ORDER } from "./colors";
import { DENIER_OPTIONS, MATERIALS } from "./garments";
import type { CuffStyleKey, MaterialKey, PatternKey, SecretDecalKey, StockingLengthKey } from "./garments";

/** One leg's outfit, expressed as catalog keys. */
export interface LegSpec {
  length: StockingLengthKey;
  cuff: CuffStyleKey;
  garter: boolean;
  material: MaterialKey;
  denier: number;
  pattern: PatternKey;
  /** Palette key or custom "#rrggbb". */
  color: string;
  secret: SecretDecalKey;
  /** Color the fabric turns when wet (palette key or "#rrggbb"), or null. */
  wetColor: string | null;
}

/** A named outfit: either the same spec on both legs or one spec per leg. */
export interface OutfitPreset {
  name: string;
  both?: Partial<LegSpec>;
  legs?: [Partial<LegSpec>, Partial<LegSpec>];
}

export const DEFAULT_LEG_SPEC: LegSpec = {
  length: "thigh",
  cuff: "lace",
  garter: false,
  material: "sheer",
  denier: 40,
  pattern: "none",
  color: "ink",
  secret: "none",
  wetColor: null,
};

export const withLegDefaults = (spec?: Partial<LegSpec>): LegSpec => ({
  ...DEFAULT_LEG_SPEC,
  ...spec,
});

export const PRESETS: OutfitPreset[] = [
  {
    name: "经典黑丝",
    both: {
      length: "thigh",
      cuff: "lace",
      material: "sheer",
      denier: 40,
      color: "ink",
    },
  },
  {
    name: "油亮肉丝",
    both: {
      length: "tights",
      material: "gloss",
      denier: 15,
      color: "nude",
    },
  },
  {
    name: "纯白过膝",
    both: {
      length: "over",
      cuff: "plain",
      material: "velvet",
      denier: 70,
      color: "ivory",
    },
  },
  {
    name: "蓝白条纹",
    both: {
      length: "over",
      cuff: "plain",
      material: "cotton",
      pattern: "hoops",
      color: "mist",
    },
  },
  {
    name: "学院及膝",
    both: {
      length: "knee",
      cuff: "stripes",
      material: "cotton",
      color: "navy",
    },
  },
  {
    name: "吊带网袜",
    both: {
      length: "thigh",
      cuff: "lace",
      garter: true,
      material: "sheer",
      denier: 40,
      pattern: "net",
      color: "ink",
    },
  },
  {
    name: "樱粉爱心",
    both: {
      length: "thigh",
      cuff: "bow",
      material: "sheer",
      denier: 15,
      pattern: "hearts",
      color: "sakura",
    },
  },
  {
    name: "复古后缝",
    both: {
      length: "thigh",
      cuff: "plain",
      garter: true,
      material: "sheer",
      denier: 15,
      pattern: "seam",
      color: "coffee",
    },
  },
  {
    name: "黑白不对称",
    legs: [
      {
        length: "thigh",
        cuff: "lace",
        material: "sheer",
        denier: 40,
        color: "ink",
      },
      {
        length: "thigh",
        cuff: "lace",
        material: "sheer",
        denier: 40,
        color: "ivory",
      },
    ],
  },
  {
    name: "漆皮长筒",
    both: {
      length: "thigh",
      cuff: "plain",
      material: "latex",
      color: "wine",
    },
  },
  {
    name: "遇水显形",
    both: {
      length: "thigh",
      cuff: "plain",
      material: "velvet",
      denier: 70,
      color: "ivory",
      secret: "hearts",
    },
  },
  {
    name: "遇水变色",
    both: {
      length: "over",
      cuff: "rib",
      material: "cotton",
      color: "ivory",
      wetColor: "sakura",
    },
  },
];

export function randomLegSpec(rng: () => number = Math.random): LegSpec {
  const pick = <const T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
  const material = pick(["sheer", "sheer", "sheer", "matte", "gloss", "pearl", "velvet", "cotton", "latex"]);
  const isThick = MATERIALS[material].minDenier > 0;
  const lengthKey = pick(
    isThick && material === "cotton"
      ? ["ankle", "crew", "knee", "over", "thigh"]
      : ["knee", "over", "thigh", "thigh", "tights"],
  );
  const pattern = pick(
    isThick
      ? ["none", "none", "hoops", "dots", "hearts", "stars", "paws"]
      : ["none", "none", "none", "dots", "argyle", "net", "pins", "seam", "hearts", "stars", "lace", "fade"],
  );
  const cuff =
    lengthKey === "tights"
      ? "plain"
      : pick(material === "cotton" ? ["plain", "stripes", "rib", "rib"] : ["lace", "lace", "plain", "bow"]);
  return withLegDefaults({
    length: lengthKey,
    cuff: cuff,
    material: material,
    pattern: pattern,
    color: pick(COLOR_ORDER),
    denier: pick(DENIER_OPTIONS),
    garter: lengthKey === "thigh" && !isThick && rng() < 0.25,
    secret: rng() < 0.15 ? pick(["hearts", "stars", "paws", "words"]) : "none",
    wetColor: rng() < 0.1 ? pick(["sakura", "mist", "taro"]) : null,
  });
}
