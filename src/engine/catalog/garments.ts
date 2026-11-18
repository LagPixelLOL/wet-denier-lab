/**
 * Wardrobe catalog: stocking lengths, cuff styles, materials, denier options, patterns and secret decals.
 */

export interface StockingLengthDef {
  label: string;
  /** Rest-space height of the cuff. */
  cuffY: number;
  band: number;
  tights?: boolean;
}

export interface CuffStyleDef {
  label: string;
  id: number;
  bow?: boolean;
}

/** How a material takes up and sheds water. */
export interface MaterialWater {
  soak: number;
  wick: number;
  take: number;
  bead: number;
  slip: number;
  shed?: number;
}

export interface MaterialDef {
  label: string;
  hint: string;
  gloss: number;
  sheen: number;
  sheenPow: number;
  wetClear: number;
  wetDark: number;
  shine: number;
  pearl: number;
  knit: number;
  knitScale: number;
  rib: number;
  minDenier: number;
  print: number;
  water: MaterialWater;
}

/** Labeled catalog entry with a shader id (patterns, secret decals). */
export interface CatalogIdDef {
  label: string;
  id: number;
}

export const STOCKING_LENGTHS = {
  ankle: {
    label: "短袜",
    cuffY: 0.132,
    band: 0.022,
  },
  crew: {
    label: "中筒袜",
    cuffY: 0.285,
    band: 0.034,
  },
  knee: {
    label: "及膝袜",
    cuffY: 0.425,
    band: 0.04,
  },
  over: {
    label: "过膝袜",
    cuffY: 0.545,
    band: 0.05,
  },
  thigh: {
    label: "大腿袜",
    cuffY: 0.7,
    band: 0.05,
  },
  tights: {
    label: "连裤袜",
    cuffY: 0.7,
    band: 0.05,
    tights: true,
  },
} satisfies Record<string, StockingLengthDef>;

export type StockingLengthKey = keyof typeof STOCKING_LENGTHS;

export const STOCKING_LENGTH_ORDER: StockingLengthKey[] = ["ankle", "crew", "knee", "over", "thigh", "tights"];

export const CUFF_STYLES = {
  plain: {
    label: "纯色宽边",
    id: 0,
  },
  lace: {
    label: "蕾丝花边",
    id: 1,
  },
  stripes: {
    label: "双条纹",
    id: 2,
  },
  rib: {
    label: "罗纹口",
    id: 3,
  },
  bow: {
    label: "蝴蝶结",
    id: 0,
    bow: true,
  },
} satisfies Record<string, CuffStyleDef>;

export type CuffStyleKey = keyof typeof CUFF_STYLES;

export const CUFF_STYLE_ORDER: CuffStyleKey[] = ["lace", "plain", "stripes", "rib", "bow"];

export const MATERIALS = {
  sheer: {
    label: "薄丝",
    hint: "遇水变透",
    gloss: 1,
    sheen: 1,
    sheenPow: 2,
    wetClear: 0.66,
    wetDark: 0.45,
    shine: 0,
    pearl: 0,
    knit: 0.55,
    knitScale: 1,
    rib: 0,
    minDenier: 0,
    print: 0,
    water: {
      soak: 1,
      wick: 1,
      take: 1,
      bead: 1,
      slip: 1,
    },
  },
  matte: {
    label: "哑光丝",
    hint: "柔雾质感",
    gloss: 0.25,
    sheen: 0.8,
    sheenPow: 2,
    wetClear: 0.66,
    wetDark: 0.45,
    shine: 0,
    pearl: 0,
    knit: 0.55,
    knitScale: 1,
    rib: 0,
    minDenier: 0,
    print: 0,
    water: {
      soak: 1,
      wick: 1,
      take: 1,
      bead: 1,
      slip: 1,
    },
  },
  gloss: {
    label: "油亮",
    hint: "水珠更圆更滑",
    gloss: 2.2,
    sheen: 1.5,
    sheenPow: 2.4,
    wetClear: 0.6,
    wetDark: 0.38,
    shine: 0.2,
    pearl: 0,
    knit: 0.35,
    knitScale: 1,
    rib: 0,
    minDenier: 0,
    print: 0,
    water: {
      soak: 0.6,
      wick: 0.8,
      take: 0.8,
      bead: 1.5,
      slip: 1.35,
      shed: 0.06,
    },
  },
  pearl: {
    label: "珠光",
    hint: "沾水更闪",
    gloss: 1.4,
    sheen: 1.3,
    sheenPow: 2,
    wetClear: 0.62,
    wetDark: 0.4,
    shine: 0.06,
    pearl: 1,
    knit: 0.45,
    knitScale: 1,
    rib: 0,
    minDenier: 0,
    print: 0,
    water: {
      soak: 0.9,
      wick: 1,
      take: 1,
      bead: 1.1,
      slip: 1,
    },
  },
  velvet: {
    label: "天鹅绒",
    hint: "遇水变深",
    gloss: 0.1,
    sheen: 2.3,
    sheenPow: 1.3,
    wetClear: 0.1,
    wetDark: 0.6,
    shine: 0,
    pearl: 0,
    knit: 0.18,
    knitScale: 1,
    rib: 0,
    minDenier: 230,
    print: 1,
    water: {
      soak: 1.7,
      wick: 1.5,
      take: 1.2,
      bead: 0.55,
      slip: 0.8,
    },
  },
  cotton: {
    label: "棉袜",
    hint: "吸水很快",
    gloss: 0,
    sheen: 0.5,
    sheenPow: 2,
    wetClear: 0.2,
    wetDark: 0.5,
    shine: 0,
    pearl: 0,
    knit: 1,
    knitScale: 0.42,
    rib: 1,
    minDenier: 330,
    print: 1,
    water: {
      soak: 3.2,
      wick: 2.6,
      take: 1.5,
      bead: 0.16,
      slip: 0.6,
    },
  },
  latex: {
    label: "漆皮",
    hint: "完全不吸水",
    gloss: 0.7,
    sheen: 0.5,
    sheenPow: 3,
    wetClear: 0,
    wetDark: 0,
    shine: 1,
    pearl: 0,
    knit: 0,
    knitScale: 1,
    rib: 0,
    minDenier: 900,
    print: 1,
    water: {
      soak: 0,
      wick: 0,
      take: 0,
      bead: 2.6,
      slip: 2.2,
      shed: 0.55,
    },
  },
} satisfies Record<string, MaterialDef>;

export type MaterialKey = keyof typeof MATERIALS;

export const MATERIAL_ORDER: MaterialKey[] = ["sheer", "matte", "gloss", "pearl", "velvet", "cotton", "latex"];

export const DENIER_OPTIONS: number[] = [15, 40, 70, 120];

export const PATTERNS = {
  none: {
    label: "素面",
    id: 0,
  },
  dots: {
    label: "波点",
    id: 1,
  },
  argyle: {
    label: "菱格",
    id: 2,
  },
  net: {
    label: "网袜",
    id: 3,
  },
  hoops: {
    label: "横条纹",
    id: 4,
  },
  pins: {
    label: "竖条纹",
    id: 5,
  },
  seam: {
    label: "后中缝",
    id: 6,
  },
  hearts: {
    label: "爱心",
    id: 7,
  },
  stars: {
    label: "星星",
    id: 8,
  },
  lace: {
    label: "全蕾丝",
    id: 9,
  },
  fade: {
    label: "渐变",
    id: 10,
  },
  paws: {
    label: "猫爪",
    id: 11,
  },
} satisfies Record<string, CatalogIdDef>;

export type PatternKey = keyof typeof PATTERNS;

export const PATTERN_ORDER: PatternKey[] = [
  "none",
  "dots",
  "argyle",
  "net",
  "hoops",
  "pins",
  "seam",
  "hearts",
  "stars",
  "paws",
  "lace",
  "fade",
];

export const SECRET_DECALS = {
  none: {
    label: "无",
    id: 0,
  },
  hearts: {
    label: "爱心",
    id: 1,
  },
  stars: {
    label: "星星",
    id: 2,
  },
  paws: {
    label: "猫爪",
    id: 3,
  },
  words: {
    label: "雨丝",
    id: 4,
  },
} satisfies Record<string, CatalogIdDef>;

export type SecretDecalKey = keyof typeof SECRET_DECALS;

export const SECRET_DECAL_ORDER: SecretDecalKey[] = ["none", "hearts", "stars", "paws", "words"];
