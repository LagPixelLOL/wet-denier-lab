/**
 * Turns a leg spec (catalog keys) into shader and simulation parameters.
 */
import { accentDyeFor, hexToRgb, resolveColor } from "./colors";
import type { Rgb } from "./colors";
import { BARE_SKIN_WATER, CUFF_STYLES, MATERIALS, PATTERNS, SECRET_DECALS, STOCKING_LENGTHS } from "./garments";
import type { CatalogIdDef, CuffStyleDef, MaterialDef, MaterialWater, StockingLengthDef } from "./garments";
import { withLegDefaults } from "./presets";
import type { LegSpec } from "./presets";

/** Shader and simulation parameters for one leg, resolved from a LegSpec. */
export interface LegLook {
  spec: LegSpec;
  dye: string;
  dye2: string;
  sheen: string;
  shade: Rgb;
  through: number;
  sheenAmt: number;
  stripe: number;
  outline: string;
  denier: number;
  pattern: number;
  gloss: number;
  cuffY: number;
  hasCuff: number;
  cuff: number;
  band: number;
  bow: boolean;
  garter: number;
  /** wetClear, wetDark, shine, pearl */
  mat: [number, number, number, number];
  /** knit, rib, sheenPow, knitScale */
  mat2: [number, number, number, number];
  print: number;
  secret: number;
  secretColor: string;
  wetDye: string | null;
  skinVisible: boolean;
  fade0: number;
  fade1: number;
  water: MaterialWater;
}

// Unknown keys can still arrive at runtime (e.g. hand-edited specs), hence the fallbacks below.
export function resolveLegLook(input?: Partial<LegSpec>): LegLook {
  const spec = withLegDefaults(input);
  const lengthDef: StockingLengthDef = STOCKING_LENGTHS[spec.length] || STOCKING_LENGTHS.thigh;
  const isBare = !!lengthDef.bare;
  const cuffDef: CuffStyleDef = (!isBare && CUFF_STYLES[spec.cuff]) || CUFF_STYLES.plain;
  const materialDef: MaterialDef = MATERIALS[spec.material] || MATERIALS.sheer;
  const patternDef: CatalogIdDef = PATTERNS[spec.pattern] || PATTERNS.none;
  const colorDef = resolveColor(spec.color);
  const isTights = !!lengthDef.tights;
  const secretDef: CatalogIdDef = SECRET_DECALS[spec.secret] || SECRET_DECALS.none;
  const luma = hexToRgb(colorDef.dye).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
  return {
    spec: spec,
    dye: colorDef.dye,
    dye2: accentDyeFor(spec.color),
    sheen: colorDef.sheen,
    shade: colorDef.shade,
    through: colorDef.through,
    sheenAmt: colorDef.sheenAmt * materialDef.sheen,
    stripe: colorDef.stripe,
    outline: colorDef.outline,
    denier: Math.max(spec.denier, materialDef.minDenier),
    pattern: patternDef.id,
    gloss: materialDef.gloss,
    cuffY: lengthDef.cuffY,
    hasCuff: isTights ? 0 : 1,
    cuff: cuffDef.id,
    band: lengthDef.band,
    bow: !!cuffDef.bow && !isTights,
    garter: spec.garter && spec.length === "thigh" ? 1 : 0,
    mat: [materialDef.wetClear, materialDef.wetDark, materialDef.shine, materialDef.pearl],
    mat2: [materialDef.knit, materialDef.rib, materialDef.sheenPow, materialDef.knitScale],
    print: materialDef.print,
    secret: isBare ? 0 : secretDef.id,
    secretColor: luma > 0.55 ? "#e8456e" : "#ffd7e2",
    wetDye: spec.wetColor && !isBare ? resolveColor(spec.wetColor).dye : null,
    skinVisible: !isTights,
    fade0: isTights ? 0.7 : 0.79,
    fade1: isTights ? 0.812 : 0.868,
    water: isBare ? BARE_SKIN_WATER : materialDef.water,
  };
}
