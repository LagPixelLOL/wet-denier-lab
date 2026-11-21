/**
 * The shape a cuff presses into the leg: the skin bulges out just above the cuff's edge and the fabric sits in a
 * little below it. One set of numbers for the shaders that place the stocking's surface (CUFF_PRESS_GLSL) and for
 * what rests on that surface (drops).
 */
export const CUFF_PRESS = {
  /** How far the skin bulges out at most, and how high above the cuff's edge that is. */
  bulge: 0.0022,
  bulgeAt: 0.0065,
  /** The bulge falls off over this height to either side of its top. */
  bulgeSpread: 0.0085,
  /** How far the cuff sits in, from just under its edge down to where the press ends. */
  dent: 0.0011,
  dentFrom: -0.05,
  dentFull: -0.008,
  dentEdge: [-0.002, 0.003],
} as const;

const smoothstep = (from: number, to: number, x: number): number => {
  const t = Math.min(Math.max((x - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * How far the pressed surface lies out from the unpressed one (in, if negative) at height `dy` above the cuff's
 * edge, along the surface normal.
 */
export function cuffPressAt(dy: number): number {
  const { bulge, bulgeAt, bulgeSpread, dent, dentFrom, dentFull, dentEdge } = CUFF_PRESS;
  const out = bulge * Math.exp(-(((dy - bulgeAt) / bulgeSpread) ** 2));
  const inward = dent * smoothstep(dentFrom, dentFull, dy) * (1 - smoothstep(dentEdge[0], dentEdge[1], dy));
  return out - inward;
}

/**
 * How soft the leg is at a height at rest, as a share of the thigh: a cuff presses into it by that much (the
 * numbers of CUFF_PRESS are for the thigh). The calf gives half as much, and its top under the knee three quarters
 * of that. The ankle and the knee are bone and sinew and hardly give at all.
 */
export const LEG_SOFTNESS: readonly (readonly [height: number, softness: number])[] = [
  [0.132, 0.1],
  [0.285, 0.5],
  [0.425, 0.375],
  [0.545, 0.1],
  [0.7, 1],
];

export function legSoftness(height: number): number {
  const above = LEG_SOFTNESS.findIndex(([at]) => at >= height);
  if (above <= 0) {
    return LEG_SOFTNESS[above === 0 ? 0 : LEG_SOFTNESS.length - 1][1];
  }
  const [[from, soft], [to, softer]] = [LEG_SOFTNESS[above - 1], LEG_SOFTNESS[above]];
  const along = (height - from) / (to - from);
  return soft * (1 - along) + softer * along;
}
