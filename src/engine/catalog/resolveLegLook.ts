/**
 * Turns a leg spec (catalog keys) into shader and simulation parameters.
 */
import { accentDyeFor, hexToRgb, resolveColor } from "./colors";
import { CUFF_STYLES, MATERIALS, PATTERNS, SECRET_DECALS, STOCKING_LENGTHS } from "./garments";
import { withLegDefaults } from "./presets";

export function resolveLegLook(input) {
  const spec = withLegDefaults(input);
  const lengthDef = STOCKING_LENGTHS[spec.length] || STOCKING_LENGTHS.thigh;
  const cuffDef = CUFF_STYLES[spec.cuff] || CUFF_STYLES.plain;
  const materialDef = MATERIALS[spec.material] || MATERIALS.sheer;
  const patternDef = PATTERNS[spec.pattern] || PATTERNS.none;
  const colorDef = resolveColor(spec.color);
  const isTights = !!lengthDef.tights;
  const secretDef = SECRET_DECALS[spec.secret] || SECRET_DECALS.none;
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
    secret: secretDef.id,
    secretColor: luma > 0.55 ? "#e8456e" : "#ffd7e2",
    wetDye: spec.wetColor ? resolveColor(spec.wetColor).dye : null,
    skinVisible: !isTights,
    fade0: isTights ? 0.7 : 0.79,
    fade1: isTights ? 0.812 : 0.868,
    water: materialDef.water,
  };
}
