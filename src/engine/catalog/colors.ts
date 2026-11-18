/**
 * Stocking color palette and helpers for custom colors and accent dyes.
 */

/** Linear 0..1 RGB triple. */
export type Rgb = [number, number, number];

/** Shading parameters derived from a stocking color (palette entry or custom hex). */
export interface ColorStyle {
  dye: string;
  shade: Rgb;
  through: number;
  sheen: string;
  sheenAmt: number;
  outline: string;
  stripe: number;
}

/** A palette color; its name is the "color.<key>" message. */
export type ColorDef = ColorStyle;

export const COLORS = {
  ink: {
    dye: "#141318",
    shade: [0.62, 0.6, 0.72],
    through: 0.1,
    sheen: "#b8b2cf",
    sheenAmt: 0.26,
    outline: "#141218",
    stripe: 1,
  },
  smoke: {
    dye: "#6c7381",
    shade: [0.6, 0.65, 0.78],
    through: 0.14,
    sheen: "#e9eff9",
    sheenAmt: 0.36,
    outline: "#353a44",
    stripe: 0.9,
  },
  ivory: {
    dye: "#f4f1f3",
    shade: [0.84, 0.8, 0.92],
    through: 0,
    sheen: "#ffffff",
    sheenAmt: 0.22,
    outline: "#9b90a3",
    stripe: 0.4,
  },
  nude: {
    dye: "#dba585",
    shade: [0.82, 0.62, 0.5],
    through: 0.42,
    sheen: "#fff3e9",
    sheenAmt: 0.34,
    outline: "#8a5a44",
    stripe: 0.8,
  },
  coffee: {
    dye: "#5a3a2c",
    shade: [0.7, 0.58, 0.56],
    through: 0.3,
    sheen: "#e8cdbb",
    sheenAmt: 0.3,
    outline: "#2e1c15",
    stripe: 0.95,
  },
  wine: {
    dye: "#6e1b2e",
    shade: [0.66, 0.52, 0.66],
    through: 0.26,
    sheen: "#f0b9c4",
    sheenAmt: 0.3,
    outline: "#360c16",
    stripe: 0.95,
  },
  sakura: {
    dye: "#f3b3c6",
    shade: [0.86, 0.7, 0.8],
    through: 0.3,
    sheen: "#fff0f4",
    sheenAmt: 0.3,
    outline: "#a8627a",
    stripe: 0.6,
  },
  taro: {
    dye: "#b49ad6",
    shade: [0.76, 0.7, 0.9],
    through: 0.24,
    sheen: "#f3ecff",
    sheenAmt: 0.32,
    outline: "#62508a",
    stripe: 0.7,
  },
  mist: {
    dye: "#8fb4de",
    shade: [0.7, 0.76, 0.92],
    through: 0.2,
    sheen: "#eef6ff",
    sheenAmt: 0.32,
    outline: "#44628c",
    stripe: 0.7,
  },
  navy: {
    dye: "#1f2a4d",
    shade: [0.6, 0.62, 0.8],
    through: 0.14,
    sheen: "#b9c4ea",
    sheenAmt: 0.28,
    outline: "#10162b",
    stripe: 1,
  },
  forest: {
    dye: "#254a3c",
    shade: [0.6, 0.7, 0.7],
    through: 0.18,
    sheen: "#c2e3d4",
    sheenAmt: 0.28,
    outline: "#11261e",
    stripe: 0.95,
  },
  cherry: {
    dye: "#c22a3a",
    shade: [0.72, 0.52, 0.6],
    through: 0.3,
    sheen: "#ffd0d4",
    sheenAmt: 0.3,
    outline: "#5e0f18",
    stripe: 0.85,
  },
} satisfies Record<string, ColorDef>;

/** Palette color key. Custom colors are "#rrggbb" strings, so APIs take `string`. */
export type ColorKey = keyof typeof COLORS;

export const COLOR_ORDER: ColorKey[] = [
  "ink",
  "smoke",
  "ivory",
  "nude",
  "coffee",
  "wine",
  "cherry",
  "sakura",
  "taro",
  "mist",
  "navy",
  "forest",
];

export const hexToRgb = (hex: string): Rgb => {
  const num = parseInt(hex.slice(1), 16);
  return [(num >> 16) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
};

const rgbToHex = (rgb: readonly number[]): string =>
  "#" +
  rgb
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

const lerpRgb = (a: readonly number[], b: readonly number[], t: number): number[] =>
  a.map((value, i) => value + (b[i] - value) * t);

function deriveCustomColor(hex: string): ColorStyle {
  const rgb = hexToRgb(hex);
  const maxChannel = Math.max(...rgb);
  const minChannel = Math.min(...rgb);
  const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  const saturation = maxChannel > 0.001 ? (maxChannel - minChannel) / maxChannel : 0;
  const tint = rgb.map((channel) => (maxChannel > 0.001 ? channel / maxChannel : 1));
  const shade = lerpRgb(
    lerpRgb([0.62, 0.6, 0.72], [0.84, 0.8, 0.92], luma),
    tint.map((channel) => 0.5 + channel * 0.38),
    saturation * 0.55,
  );
  return {
    dye: hex,
    shade: shade as Rgb,
    through: 0.08 + saturation * 0.34 * (1 - luma * 0.45),
    sheen: rgbToHex(lerpRgb(rgb, [1, 1, 1], 0.78)),
    sheenAmt: 0.24 + (1 - Math.abs(luma * 2 - 1)) * 0.1,
    outline: rgbToHex(
      lerpRgb(
        rgb.map((channel) => channel * 0.45),
        [0.08, 0.07, 0.09],
        luma < 0.15 ? 0.6 : 0,
      ),
    ),
    stripe: 1 - luma * 0.6,
  };
}

/** Palette entry for a color key, or a style derived from a custom "#rrggbb" color. */
export const resolveColor = (key: string): ColorStyle =>
  (COLORS as Partial<Record<string, ColorDef>>)[key] || deriveCustomColor(key);

export function accentDyeFor(key: string): string {
  const rgb = hexToRgb(resolveColor(key).dye);
  if (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.72) {
    return "#f29bb4";
  } else {
    return "#f6f3f4";
  }
}
