import { describe, expect, it } from "vitest";
import { BACKDROPS, BACKDROP_ORDER, SCENES, SCENE_ORDER, makeCustomBackdrop } from "../../../src/engine/stage/scenes";

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
    expect(makeCustomBackdrop("#000000")).toMatchObject({ top: "#8c8c8c", bottom: "#1f1f1f", floor: "#4d4d4d" });
  });
});
