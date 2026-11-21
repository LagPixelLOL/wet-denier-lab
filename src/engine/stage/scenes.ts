/**
 * Scenes (studio, bath, street, pool) and studio backdrops.
 */
import type { Vec3 } from "../rig/joints";

export type SceneId = "studio" | "bath" | "street" | "pool";

/** Light rig and environment colors of a scene (colors as hex strings or linear rgb). */
export interface SceneLight {
  key: string;
  rim: string;
  fillTop: Vec3;
  fillBottom: Vec3;
  rim2: string;
  rim2Dir: Vec3;
  envLo: Vec3;
  envHi: Vec3;
  envA: Vec3;
  envADir: Vec3;
  envB: Vec3;
  envBDir: Vec3;
  caustic: number;
}

export interface SceneFloor {
  shadow: string;
  mark: string;
  markAmt: number;
  mirror: number;
  /** Mirror falloff (default 1.6). */
  mirrorFall?: number;
  /** Puddle lighting (default 1). */
  puddleLight?: number;
}

export interface SceneWater {
  envLo: Vec3;
  envHi: Vec3;
  /** Rain streak rgb + alpha. */
  rain: [number, number, number, number];
}

/** A scene; its name, rain button label and hint are the "scene.<key>" messages. */
export interface SceneDef {
  /** Value of the SCENE shader define. */
  id: number;
  rainOn?: boolean;
  dark?: boolean;
  light: SceneLight;
  floor: SceneFloor;
  water: SceneWater;
  /** Page background color behind the canvas. */
  fade: string;
}

/** Known keys map to defs; any other string yields undefined. */
export type SceneTable = { readonly [K in SceneId]: SceneDef } & { readonly [key: string]: SceneDef | undefined };

export const SCENE_ORDER: SceneId[] = ["studio", "bath", "street", "pool"];

export const SCENES: SceneTable = {
  studio: {
    id: 0,
    light: {
      key: "#fffaf4",
      rim: "#d8e4ff",
      fillTop: [1, 0.99, 1],
      fillBottom: [0.8, 0.76, 0.86],
      rim2: "#000000",
      rim2Dir: [0, 0, 1],
      envLo: [0.55, 0.53, 0.62],
      envHi: [1.5, 1.48, 1.55],
      envA: [0, 0, 0],
      envADir: [0, 1, 0],
      envB: [0, 0, 0],
      envBDir: [0, 1, 0],
      caustic: 0,
    },
    floor: {
      shadow: "#b7a6c4",
      mark: "#b7a6c4",
      markAmt: 0.5,
      mirror: 0,
    },
    water: {
      envLo: [0.2, 0.19, 0.25],
      envHi: [1.45, 1.43, 1.5],
      rain: [0.42, 0.5, 0.66, 0.42],
    },
    fade: "#efe9f1",
  },
  bath: {
    id: 1,
    light: {
      key: "#fff3e2",
      rim: "#e6f2ff",
      fillTop: [1, 0.985, 0.96],
      fillBottom: [0.84, 0.82, 0.86],
      rim2: "#000000",
      rim2Dir: [0, 0, 1],
      envLo: [0.62, 0.66, 0.7],
      envHi: [1.45, 1.42, 1.36],
      envA: [0, 0, 0],
      envADir: [0, 1, 0],
      envB: [0, 0, 0],
      envBDir: [0, 1, 0],
      caustic: 0,
    },
    floor: {
      shadow: "#8f97a8",
      mark: "#9aa3b2",
      markAmt: 0.42,
      mirror: 0.62,
      mirrorFall: 1,
      puddleLight: 0.6,
    },
    water: {
      envLo: [0.3, 0.32, 0.36],
      envHi: [1.45, 1.42, 1.36],
      rain: [0.52, 0.6, 0.7, 0.36],
    },
    fade: "#eef1f2",
  },
  street: {
    id: 2,
    rainOn: true,
    dark: true,
    light: {
      key: "#f1f0ff",
      rim: "#ff5aa8",
      fillTop: [0.94, 0.92, 1],
      fillBottom: [0.8, 0.74, 0.93],
      rim2: "#3fd6ff",
      rim2Dir: [0.72, 0.18, -0.67],
      envLo: [0.16, 0.14, 0.26],
      envHi: [0.62, 0.6, 0.86],
      envA: [2.6, 0.55, 1.35],
      envADir: [-0.8, 0.22, -0.55],
      envB: [0.35, 1.9, 2.5],
      envBDir: [0.78, 0.2, -0.59],
      caustic: 0,
    },
    floor: {
      shadow: "#04040a",
      mark: "#8c8fa6",
      markAmt: 0.3,
      mirror: 0.85,
      mirrorFall: 1.3,
      puddleLight: 0.22,
    },
    water: {
      envLo: [0.1, 0.09, 0.18],
      envHi: [0.85, 0.8, 1.15],
      rain: [0.78, 0.84, 1, 0.55],
    },
    fade: "#141224",
  },
  pool: {
    id: 3,
    light: {
      key: "#fffdf6",
      rim: "#dff6ff",
      fillTop: [1, 1, 1],
      fillBottom: [0.8, 0.9, 0.93],
      rim2: "#000000",
      rim2Dir: [0, 0, 1],
      envLo: [0.5, 0.7, 0.78],
      envHi: [1.35, 1.55, 1.75],
      envA: [0, 0, 0],
      envADir: [0, 1, 0],
      envB: [0, 0, 0],
      envBDir: [0, 1, 0],
      caustic: 0.16,
    },
    floor: {
      shadow: "#8f8a86",
      mark: "#a59c8e",
      markAmt: 0.45,
      mirror: 0.26,
      mirrorFall: 2.6,
      puddleLight: 0.8,
    },
    water: {
      envLo: [0.22, 0.36, 0.42],
      envHi: [1.35, 1.55, 1.75],
      rain: [0.4, 0.56, 0.7, 0.4],
    },
    fade: "#e6f3f6",
  },
};

export type BackdropId = "lilac" | "sakura" | "mint" | "cream" | "sky" | "dusk";

/** Studio backdrop and floor colors (hex strings). */
export interface BackdropDef {
  top: string;
  bottom: string;
  glow: string;
  floor: string;
  shadow: string;
  dark?: boolean;
}

/** Known keys map to defs; any other string yields undefined. */
export type BackdropTable = { readonly [K in BackdropId]: BackdropDef } & {
  readonly [key: string]: BackdropDef | undefined;
};

export const BACKDROP_ORDER: BackdropId[] = ["lilac", "sakura", "mint", "cream", "sky", "dusk"];

export const BACKDROPS: BackdropTable = {
  lilac: {
    top: "#f6f2f6",
    bottom: "#e4dce8",
    glow: "#3a3438",
    floor: "#ece4ee",
    shadow: "#b7a6c4",
  },
  sakura: {
    top: "#fbf1f3",
    bottom: "#f3d6dd",
    glow: "#3a3032",
    floor: "#f6e2e7",
    shadow: "#cf9fb0",
  },
  mint: {
    top: "#f1f8f5",
    bottom: "#cfe7df",
    glow: "#303a36",
    floor: "#dcefe8",
    shadow: "#8fb7ab",
  },
  cream: {
    top: "#fbf7ee",
    bottom: "#f0e3c8",
    glow: "#3a3628",
    floor: "#f5ecd8",
    shadow: "#c8ac80",
  },
  sky: {
    top: "#f0f6fc",
    bottom: "#cbdff3",
    glow: "#30363c",
    floor: "#dbe8f6",
    shadow: "#8fa9cc",
  },
  dusk: {
    top: "#4a4868",
    bottom: "#2a2944",
    glow: "#201c2c",
    floor: "#35334f",
    shadow: "#16152a",
    dark: true,
  },
};

/** Builds a backdrop from a single hex color (3 or 6 digits, "#" optional). */
export function makeCustomBackdrop(hex: string): BackdropDef {
  const digits = String(hex).replace("#", "");
  const value = parseInt(digits.length === 3 ? digits.replace(/./g, "$&$&") : digits, 16);
  const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const mixTo = (target: number, t: number): string =>
    "#" +
    rgb
      .map((c) =>
        Math.round(c + (target - c) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  const luma = (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255;
  return {
    top: mixTo(255, 0.55),
    bottom: mixTo(255, 0.12),
    glow: luma > 0.4 ? "#34323a" : "#1c1a24",
    floor: mixTo(255, 0.3),
    shadow: mixTo(0, 0.42),
    dark: luma < 0.3,
  };
}

const srgbToLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** A hex color as linear rgb, which is what the shaders work in. */
const linearRgb = (hex: string): Vec3 => {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => srgbToLinear(c / 255)) as Vec3;
};

/** The surroundings that shiny surfaces reflect: below and above the horizon, in linear light. */
export interface EnvColors {
  envLo: Vec3;
  envHi: Vec3;
}

/**
 * The surroundings a shiny surface reflects in the studio, for a backdrop. The studio's own colors (`env`) are
 * those of the lilac backdrop: for another one they change as the backdrop does, the lower part with its
 * bottom color and the upper part with its top color. So latex in front of a dark backdrop mirrors a dark
 * room, and in front of a pink one a pink room.
 */
export function studioEnv(env: EnvColors, backdrop: BackdropDef): EnvColors {
  const scaled = (color: Vec3, to: string, from: string): Vec3 => {
    const [target, reference] = [linearRgb(to), linearRgb(from)];
    return color.map((channel, i) => channel * (target[i] / reference[i])) as Vec3;
  };
  return {
    envLo: scaled(env.envLo, backdrop.bottom, BACKDROPS.lilac.bottom),
    envHi: scaled(env.envHi, backdrop.top, BACKDROPS.lilac.top),
  };
}
