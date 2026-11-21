/**
 * Wardrobe catalog: stocking lengths, cuff styles, materials, denier options, patterns and secret decals.
 */

// Names and hints are messages keyed by catalog key ("length.<key>", "material.<key>.hint", ...).

export interface StockingLengthDef {
  /** Rest-space height of the cuff. */
  cuffY: number;
  band: number;
  tights?: boolean;
  /** No stocking at all: the cuff sits below the foot, so the whole stocking mesh shades as bare skin. */
  bare?: boolean;
}

export interface CuffStyleDef {
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

/** Catalog entry with a shader id (patterns, secret decals). */
export interface CatalogIdDef {
  id: number;
}

export const STOCKING_LENGTHS = {
  bare: {
    cuffY: -1,
    band: 0,
    bare: true,
  },
  ankle: {
    cuffY: 0.132,
    band: 0.022,
  },
  crew: {
    cuffY: 0.285,
    band: 0.034,
  },
  knee: {
    cuffY: 0.425,
    band: 0.04,
  },
  over: {
    cuffY: 0.545,
    band: 0.05,
  },
  thigh: {
    cuffY: 0.7,
    band: 0.05,
  },
  tights: {
    cuffY: 0.7,
    band: 0.05,
    tights: true,
  },
} satisfies Record<string, StockingLengthDef>;

export type StockingLengthKey = keyof typeof STOCKING_LENGTHS;

export const STOCKING_LENGTH_ORDER: StockingLengthKey[] = ["bare", "ankle", "crew", "knee", "over", "thigh", "tights"];

export const CUFF_STYLES = {
  plain: {
    id: 0,
  },
  lace: {
    id: 1,
  },
  stripes: {
    id: 2,
  },
  rib: {
    id: 3,
  },
  bow: {
    id: 0,
    bow: true,
  },
} satisfies Record<string, CuffStyleDef>;

export type CuffStyleKey = keyof typeof CUFF_STYLES;

export const CUFF_STYLE_ORDER: CuffStyleKey[] = ["lace", "plain", "stripes", "rib", "bow"];

export const MATERIALS = {
  sheer: {
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
  // Only a little less matte than cotton: a slightly stronger, slightly broader sheen and a trace of gloss.
  velvet: {
    gloss: 0.03,
    sheen: 0.55,
    sheenPow: 1.9,
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
  // Smooth rubber: no fibers to glow at a glancing angle (sheen), only what it mirrors (shine).
  latex: {
    gloss: 0.7,
    sheen: 0,
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

/** A back seam and its heel are a nylon stocking's: thick fabrics and latex are made without them. */
export const hasBackSeam = (material: MaterialDef): boolean => material.minDenier === 0;

/** Bare skin barely soaks anything up: water beads and runs off, and the film dries quickly. */
export const BARE_SKIN_WATER: MaterialWater = {
  soak: 0.15,
  wick: 0.2,
  take: 0.2,
  bead: 1.6,
  slip: 1.4,
  shed: 0.25,
};

export const DENIER_OPTIONS: number[] = [15, 40, 70, 120];

export const PATTERNS = {
  none: {
    id: 0,
  },
  dots: {
    id: 1,
  },
  argyle: {
    id: 2,
  },
  net: {
    id: 3,
  },
  hoops: {
    id: 4,
  },
  pins: {
    id: 5,
  },
  seam: {
    id: 6,
  },
  hearts: {
    id: 7,
  },
  stars: {
    id: 8,
  },
  lace: {
    id: 9,
  },
  fade: {
    id: 10,
  },
  paws: {
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
    id: 0,
  },
  hearts: {
    id: 1,
  },
  stars: {
    id: 2,
  },
  paws: {
    id: 3,
  },
  words: {
    id: 4,
  },
} satisfies Record<string, CatalogIdDef>;

export type SecretDecalKey = keyof typeof SECRET_DECALS;

export const SECRET_DECAL_ORDER: SecretDecalKey[] = ["none", "hearts", "stars", "paws", "words"];
