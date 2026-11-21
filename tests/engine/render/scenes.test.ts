import { describe, expect, it } from "vitest";
import {
  BACKDROPS,
  BACKDROP_ORDER,
  SCENES,
  SCENE_ORDER,
  ROOM_LIGHT_MIN,
  makeCustomBackdrop,
  studioEnv,
  studioRimTint,
  studioRoomLight,
} from "../../../src/engine/stage/scenes";

const HEX = /^#[0-9a-f]{6}$/;

describe("scene table", () => {
  it("lists every scene once in order, with distinct shader ids", () => {
    expect(SCENE_ORDER).toEqual(Object.keys(SCENES));
    expect(SCENE_ORDER.map((key) => SCENES[key].id)).toEqual([0, 1, 2, 3]);
  });

  it("uses well-formed colors and normalizable directions in every scene", () => {
    for (const key of SCENE_ORDER) {
      const { light, floor, water, fade } = SCENES[key];
      for (const color of [light.key, light.rim, light.rim2, floor.shadow, floor.mark, fade]) {
        expect(color).toMatch(HEX);
      }
      for (const dir of [light.rim2Dir, light.envADir, light.envBDir]) {
        expect(Math.hypot(...dir)).toBeGreaterThan(0.5);
      }
      expect(water.rain).toHaveLength(4);
      expect(floor.mirror).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns undefined for unknown keys", () => {
    expect(SCENES["nope"]).toBeUndefined();
    expect(BACKDROPS["nope"]).toBeUndefined();
  });

  it("only the street scene starts with rain and a dark page", () => {
    expect(SCENE_ORDER.filter((key) => SCENES[key].rainOn)).toEqual(["street"]);
    expect(SCENE_ORDER.filter((key) => SCENES[key].dark)).toEqual(["street"]);
  });
});

describe("backdrops", () => {
  it("lists every backdrop with hex colors; only dusk is dark", () => {
    expect(BACKDROP_ORDER).toEqual(Object.keys(BACKDROPS));
    for (const key of BACKDROP_ORDER) {
      const def = BACKDROPS[key];
      for (const color of [def.top, def.bottom, def.glow, def.floor, def.shadow]) {
        expect(color).toMatch(HEX);
      }
    }
    expect(BACKDROP_ORDER.filter((key) => BACKDROPS[key].dark)).toEqual(["dusk"]);
  });
});

describe("makeCustomBackdrop", () => {
  it("mixes a light color toward white and black", () => {
    expect(makeCustomBackdrop("#ff8800")).toMatchInlineSnapshot(`
      {
        "bottom": "#ff961f",
        "dark": false,
        "floor": "#ffac4d",
        "glow": "#34323a",
        "shadow": "#944f00",
        "top": "#ffc98c",
      }
`);
  });

  it("accepts 3-digit hex without '#' and gives a dark color the dark glow", () => {
    const short = makeCustomBackdrop("123");
    expect(short).toEqual(makeCustomBackdrop("#112233"));
    expect(short.glow).toBe("#1c1a24");
    expect(short.dark).toBe(true);
    expect(short.shadow).toBe("#0a141e");
  });

  it("treats mid luma as neither light glow nor dark", () => {
    // luma of #808080 is about 0.5: light glow, not dark
    expect(makeCustomBackdrop("#808080")).toMatchObject({ glow: "#34323a", dark: false });
    // luma of #5a5a5a is about 0.35: dark glow, but the page is not dark
    expect(makeCustomBackdrop("#5a5a5a")).toMatchObject({ glow: "#1c1a24", dark: false });
  });

  it("maps white and black to the extremes", () => {
    expect(makeCustomBackdrop("#ffffff")).toMatchObject({ top: "#ffffff", bottom: "#ffffff", shadow: "#949494" });
    // Black stays black: its parts are lifted a tenth as far as a light color's, and its glow is dimmed.
    expect(makeCustomBackdrop("#000000")).toEqual({
      top: "#0e0e0e",
      bottom: "#030303",
      floor: "#080808",
      glow: "#0b0a0e",
      shadow: "#000000",
      dark: true,
    });
  });

  it("gives a dark color a dark backdrop, lifted about as little as dusk is", () => {
    const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
    const luma = (hex: string) => {
      const [r, g, b] = channels(hex);
      return (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
    };
    for (const color of ["#101830", "#7a1020", "#2a2944", "#203010"]) {
      const backdrop = makeCustomBackdrop(color);
      // Darkest at the bottom of the wall, lightest at its top, the floor in between.
      expect(luma(backdrop.bottom)).toBeGreaterThanOrEqual(luma(color));
      expect(luma(backdrop.floor)).toBeGreaterThan(luma(backdrop.bottom));
      expect(luma(backdrop.top)).toBeGreaterThan(luma(backdrop.floor));
      // The top is still a dark shade of the color, not a pastel of it.
      expect(luma(backdrop.top)).toBeLessThan(luma(color) + 0.16);
      expect(backdrop.dark).toBe(true);
    }
    // From dusk's own bottom color: a top close to the one dusk has.
    const fromDusk = channels(makeCustomBackdrop(BACKDROPS.dusk.bottom).top);
    channels(BACKDROPS.dusk.top).forEach((channel, i) => expect(Math.abs(fromDusk[i] - channel)).toBeLessThan(24));
  });

  it("lifts a color the further the lighter it is, and a light one as far as ever", () => {
    const top = (grey: number) =>
      parseInt(makeCustomBackdrop("#" + grey.toString(16).padStart(2, "0").repeat(3)).top.slice(1, 3), 16);
    // How far the wall's top goes toward white, of the way there.
    const lifted = [0, 32, 64, 96, 128, 160, 224].map((grey) => (top(grey) - grey) / (255 - grey));
    lifted.slice(1).forEach((amount, i) => expect(amount).toBeGreaterThanOrEqual(lifted[i] - 0.005));
    expect(lifted[0]).toBeCloseTo(0.055, 2);
    expect(lifted[1]).toBeLessThan(0.15);
    for (const amount of lifted.slice(5)) {
      expect(amount).toBeCloseTo(0.55, 1);
    }
  });
});

describe("studioEnv", () => {
  const studio = SCENES.studio.light;
  const luma = (rgb: readonly number[]) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;

  it("leaves the studio's own colors as they are for the lilac backdrop, which they are given for", () => {
    expect(studioEnv(studio, BACKDROPS.lilac)).toEqual({ envLo: studio.envLo, envHi: studio.envHi });
    expect(studioEnv(SCENES.studio.water, BACKDROPS.lilac)).toEqual({
      envLo: SCENES.studio.water.envLo,
      envHi: SCENES.studio.water.envHi,
    });
  });

  it("makes a dark backdrop a dark room, of the backdrop's hue", () => {
    const dusk = studioEnv(studio, BACKDROPS.dusk);
    // More than ten times darker than the bright studio, below and above.
    expect(luma(dusk.envLo)).toBeLessThan(luma(studio.envLo) / 10);
    expect(luma(dusk.envHi)).toBeLessThan(luma(studio.envHi) / 10);
    expect(luma(dusk.envHi)).toBeGreaterThan(luma(dusk.envLo));
    // Dusk is a blue violet: blue leads, red and green are close.
    for (const color of [dusk.envLo, dusk.envHi]) {
      expect(color[2]).toBeGreaterThan(color[0] * 1.8);
      expect(Math.abs(color[0] - color[1])).toBeLessThan(color[0] * 0.1);
    }
  });

  it("tints the room with a pale backdrop's color without making it much darker or brighter", () => {
    const hue = (key: "sakura" | "mint" | "cream" | "sky") => {
      const env = studioEnv(studio, BACKDROPS[key]);
      const ratio = luma(env.envLo) / luma(studio.envLo);
      expect(ratio).toBeGreaterThan(0.8);
      expect(ratio).toBeLessThan(1.2);
      // How each channel moved from the lilac room's.
      return env.envLo.map((channel, i) => channel / studio.envLo[i]);
    };
    const [sakura, mint, cream, sky] = [hue("sakura"), hue("mint"), hue("cream"), hue("sky")];
    expect(sakura[0]).toBeGreaterThan(Math.max(sakura[1], sakura[2]));
    expect(mint[1]).toBeGreaterThan(Math.max(mint[0], mint[2]));
    expect(cream[2]).toBeLessThan(Math.min(cream[0], cream[1]));
    expect(sky[0]).toBeLessThan(Math.min(sky[1], sky[2]));
  });

  it("scales each channel by the backdrop's bottom and top in linear light", () => {
    const linear = (hex: string) =>
      [1, 3, 5].map((at) => {
        const c = parseInt(hex.slice(at, at + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    const custom = makeCustomBackdrop("#7a1020");
    const env = studioEnv(studio, custom);
    const [bottom, top, lilacBottom, lilacTop] = [
      custom.bottom,
      custom.top,
      BACKDROPS.lilac.bottom,
      BACKDROPS.lilac.top,
    ].map(linear);
    for (let i = 0; i < 3; i++) {
      expect(env.envLo[i]).toBeCloseTo((studio.envLo[i] * bottom[i]) / lilacBottom[i], 12);
      expect(env.envHi[i]).toBeCloseTo((studio.envHi[i] * top[i]) / lilacTop[i], 12);
    }
    // A dark red: red leads below and above.
    expect(env.envLo[0]).toBeGreaterThan(env.envLo[1] * 3);
    expect(env.envHi[0]).toBeGreaterThan(env.envHi[2]);
  });
});

describe("studioRimTint", () => {
  it("leaves the rim light as it is in front of the lilac backdrop", () => {
    expect(studioRimTint(BACKDROPS.lilac)).toEqual([1, 1, 1]);
  });

  it("all but puts the rim light out in front of a dark backdrop, and gives what is left its hue", () => {
    const dusk = studioRimTint(BACKDROPS.dusk);
    expect(Math.max(...dusk)).toBeLessThan(0.15);
    expect(Math.min(...dusk)).toBeGreaterThan(0.02);
    expect(dusk[2]).toBeGreaterThan(dusk[0] * 1.8);
    const black = studioRimTint(makeCustomBackdrop("#000000"));
    expect(Math.max(...black)).toBeLessThan(0.2);
  });

  it("keeps it about as bright in front of the pale backdrops, tinted their way", () => {
    for (const key of ["sakura", "mint", "cream", "sky"] as const) {
      const tint = studioRimTint(BACKDROPS[key]);
      expect(Math.min(...tint)).toBeGreaterThan(0.7);
      expect(Math.max(...tint)).toBeLessThan(1.2);
    }
    const sakura = studioRimTint(BACKDROPS.sakura);
    expect(sakura[0]).toBeGreaterThan(Math.max(sakura[1], sakura[2]));
  });

  it("is the mean of what the backdrop does to the room below and above", () => {
    const backdrop = makeCustomBackdrop("#3366cc");
    const one = { envLo: [1, 1, 1] as [number, number, number], envHi: [1, 1, 1] as [number, number, number] };
    const env = studioEnv(one, backdrop);
    const tint = studioRimTint(backdrop);
    for (let i = 0; i < 3; i++) {
      expect(tint[i]).toBeCloseTo((env.envLo[i] + env.envHi[i]) / 2, 12);
    }
  });
});

describe("studioRoomLight", () => {
  it("leaves the side of the legs that the lamp does not reach as light as it is in the lilac room", () => {
    expect(studioRoomLight(BACKDROPS.lilac)).toEqual([1, 1, 1]);
    expect(SCENES.studio.light.room).toEqual([1, 1, 1]);
  });

  it("is never more than that, and about as much in front of the pale backdrops, tinted their way", () => {
    for (const key of ["sakura", "mint", "cream", "sky"] as const) {
      const room = studioRoomLight(BACKDROPS[key]);
      expect(Math.max(...room)).toBe(1);
      expect(Math.min(...room)).toBeGreaterThan(0.9);
    }
    expect(studioRoomLight(makeCustomBackdrop("#ffffff"))).toEqual([1, 1, 1]);
    const [red, , blue] = studioRoomLight(BACKDROPS.sakura);
    expect(red).toBeGreaterThan(blue);
  });

  it("makes it dark in a black room, but not black: the leg is still to be seen", () => {
    expect(ROOM_LIGHT_MIN).toBe(0.2);
    for (const channel of studioRoomLight(makeCustomBackdrop("#000000"))) {
      expect(channel).toBeGreaterThan(ROOM_LIGHT_MIN);
      expect(channel).toBeLessThan(ROOM_LIGHT_MIN + 0.07);
    }
  });

  it("goes by how light the room looks: dimmer in front of the dusk backdrop, the more the darker the room", () => {
    const dusk = studioRoomLight(BACKDROPS.dusk);
    // The dusk backdrop gives off a twentieth of the lilac one's light, and looks about a quarter as light.
    expect(Math.max(...studioRimTint(BACKDROPS.dusk))).toBeLessThan(0.12);
    expect(Math.min(...dusk)).toBeGreaterThan(0.38);
    expect(Math.max(...dusk)).toBeLessThan(0.55);
    // Bluish, like the room.
    expect(dusk[2]).toBeGreaterThan(dusk[0]);
    const greys = ["#000000", "#202020", "#404040", "#808080", "#c0c0c0"].map(
      (hex) => studioRoomLight(makeCustomBackdrop(hex))[1],
    );
    expect(greys).toEqual([...greys].sort((a, b) => a - b));
    expect(new Set(greys).size).toBe(greys.length);
  });

  it("gives the scenes a room of their own: light, but for the street at night", () => {
    for (const key of SCENE_ORDER) {
      const room = SCENES[key].light.room;
      expect(room).toHaveLength(3);
      if (key === "street") {
        expect(Math.max(...room)).toBeLessThan(0.7);
        expect(Math.min(...room)).toBeGreaterThan(0.5);
      } else {
        expect(room).toEqual([1, 1, 1]);
      }
    }
  });
});
