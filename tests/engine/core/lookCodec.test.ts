import { describe, expect, it } from "vitest";
import { PRESETS, withLegDefaults } from "../../../src/engine/catalog/presets";
import type { LegSpec } from "../../../src/engine/catalog/presets";
import { POSE_ORDER } from "../../../src/engine/rig/poses";
import { lookUrl, unpackLook } from "../../../src/engine/share/lookCodec";
import type { Look } from "../../../src/engine/share/lookCodec";
import { BACKDROPS, SCENES } from "../../../src/engine/stage/scenes";

const PAGE = "https://example.test/lab/";

const hashOf = (url: string): string => url.slice(url.indexOf("#"));

const roundTrip = (look: Look) => unpackLook(hashOf(lookUrl(look, PAGE)));

const DEFAULT_LEGS: [LegSpec, LegSpec] = [withLegDefaults(), withLegDefaults()];

describe("lookUrl", () => {
  it("writes a versioned, tilde-separated look hash", () => {
    const url = lookUrl(
      {
        pose: "step",
        scene: "bath",
        backdrop: "lilac",
        legs: [
          withLegDefaults(),
          withLegDefaults({ color: "#12AB56", wetColor: "sakura", garter: true, secret: "stars" }),
        ],
      },
      PAGE,
    );
    expect(url.slice(0, url.indexOf("#"))).toBe(PAGE);
    expect(hashOf(url)).toMatchInlineSnapshot(
      `"#look=1~step~bath~lilac~thigh.lace.0.sheer.40.none.ink.none.-~thigh.lace.1.sheer.40.none.x12ab56.stars.sakura"`,
    );
  });

  it("writes a toe without reinforcement as a tenth field, and reads a missing one as reinforced", () => {
    const plain = withLegDefaults({ toe: false });
    const url = lookUrl({ pose: "step", scene: "bath", backdrop: "lilac", legs: [plain, withLegDefaults()] }, PAGE);
    expect(hashOf(url)).toBe(
      "#look=1~step~bath~lilac~thigh.lace.0.sheer.40.none.ink.none.-.0~thigh.lace.0.sheer.40.none.ink.none.-",
    );
    expect(unpackLook(hashOf(url))?.legs).toEqual([plain, withLegDefaults()]);
    expect(unpackLook("#look=1~step~bath~lilac~thigh.lace.0.sheer.40.none.ink.none.-.1")?.legs[0].toe).toBe(true);
    expect(unpackLook("#look=1~step~bath~lilac~thigh.lace.0.sheer.40.none.ink.none.-.x")?.legs[0].toe).toBe(true);
  });

  it("packs custom backdrop and wet colors as x + lowercase hex", () => {
    const url = lookUrl(
      {
        pose: "single",
        scene: "pool",
        backdrop: "#ABCDEF",
        legs: [withLegDefaults({ wetColor: "#00FF00" }), withLegDefaults()],
      },
      PAGE,
    );
    expect(hashOf(url)).toBe(
      "#look=1~single~pool~xabcdef~thigh.lace.0.sheer.40.none.ink.none.x00ff00~thigh.lace.0.sheer.40.none.ink.none.-",
    );
  });
});

describe("lookUrl page and camera view", () => {
  const look: Look = { pose: "pair", scene: "studio", backdrop: "mint", legs: DEFAULT_LEGS };

  it("links to the page it was given, replacing any hash already on it", () => {
    expect(lookUrl(look, "http://localhost:12345/").startsWith("http://localhost:12345/#look=1~")).toBe(true);
    expect(
      lookUrl(look, "https://example.test/a/?q=1#look=1~old").startsWith("https://example.test/a/?q=1#look=1~pair~"),
    ).toBe(true);
  });

  it("appends the camera view, rounded to 3 decimals with the yaw wrapped into [-pi, pi)", () => {
    const view = { yaw: 0.62 + Math.PI * 4, pitch: -0.12345, dist: 1.95, target: [0, 0.43, -0.0004] as const };
    const hash = hashOf(lookUrl({ ...look, view }, PAGE));
    expect(hash.split("~").at(-1)).toBe("0.62,-0.123,1.95,0,0.43,0");
    expect(unpackLook(hash)?.view).toEqual({ yaw: 0.62, pitch: -0.123, dist: 1.95, target: [0, 0.43, 0] });
    expect(
      hashOf(lookUrl({ ...look, view: { ...view, yaw: -Math.PI } }, PAGE))
        .split("~")
        .at(-1),
    ).toMatch(/^-3.142,/);
    expect(
      hashOf(lookUrl({ ...look, view: { ...view, yaw: Math.PI } }, PAGE))
        .split("~")
        .at(-1),
    ).toMatch(/^-3.142,/);
  });

  it("leaves the view out when the look has none, and old links decode without one", () => {
    const hash = hashOf(lookUrl(look, PAGE));
    expect(hash.split("~")).toHaveLength(6);
    expect(unpackLook(hash)).not.toHaveProperty("view");
  });

  it("ignores a view that is not exactly six finite numbers", () => {
    const base = hashOf(lookUrl(look, PAGE));
    for (const bad of [
      "",
      "1,2,3,4,5",
      "1,2,3,4,5,6,7",
      "1,2,x,4,5,6",
      "1,2,,4,5,6",
      "1,2,Infinity,4,5,6",
      "1,2, ,4,5,6",
    ]) {
      expect(unpackLook(base + "~" + bad)).not.toHaveProperty("view");
    }
    expect(unpackLook(base + "~1e-1,2,3,4,5,6")?.view?.yaw).toBe(0.1);
  });
});

describe("unpackLook round trips", () => {
  it("restores the default look exactly", () => {
    expect(roundTrip({ pose: "step", scene: "studio", backdrop: "lilac", legs: DEFAULT_LEGS })).toEqual({
      pose: "step",
      scene: "studio",
      backdrop: "lilac",
      legs: DEFAULT_LEGS,
    });
  });

  it("restores every preset", () => {
    for (const preset of PRESETS) {
      const legs = (preset.legs ?? [preset.both!, preset.both!]).map(withLegDefaults);
      expect(roundTrip({ pose: "together", scene: "street", backdrop: "mint", legs })?.legs).toEqual(legs);
    }
  });

  it("restores every pose, scene and backdrop", () => {
    for (const pose of POSE_ORDER) {
      expect(roundTrip({ pose, scene: "studio", backdrop: "sky", legs: DEFAULT_LEGS })?.pose).toBe(pose);
    }
    for (const scene of Object.keys(SCENES)) {
      expect(roundTrip({ pose: "step", scene, backdrop: "sky", legs: DEFAULT_LEGS })?.scene).toBe(scene);
    }
    for (const backdrop of Object.keys(BACKDROPS)) {
      expect(roundTrip({ pose: "step", scene: "studio", backdrop, legs: DEFAULT_LEGS })?.backdrop).toBe(backdrop);
    }
  });

  it("restores bare legs next to a stocking", () => {
    const legs = [withLegDefaults({ length: "bare", color: "mist" }), withLegDefaults({ length: "knee" })];
    expect(roundTrip({ pose: "step", scene: "pool", backdrop: "lilac", legs })?.legs).toEqual(legs);
  });

  it("restores custom colors in lowercase", () => {
    const legs = [
      withLegDefaults({ color: "#A1B2C3", wetColor: "#FFFFFF" }),
      withLegDefaults({ color: "#000000", wetColor: "taro" }),
    ];
    const back = roundTrip({ pose: "step", scene: "bath", backdrop: "#FfEeDd", legs });
    expect(back?.backdrop).toBe("#ffeedd");
    expect(back?.legs.map((leg) => [leg.color, leg.wetColor])).toEqual([
      ["#a1b2c3", "#ffffff"],
      ["#000000", "taro"],
    ]);
  });

  it("accepts percent-encoded payloads and the look key after other hash parameters", () => {
    const hash = hashOf(lookUrl({ pose: "point", scene: "bath", backdrop: "dusk", legs: DEFAULT_LEGS }, PAGE));
    const encoded = "#look=" + hash.slice("#look=".length).replaceAll("~", "%7E").replaceAll(".", "%2E");
    expect(unpackLook(encoded)?.pose).toBe("point");
    expect(unpackLook("#tab=2&look=1~tiptoe~pool~cream&x=1")).toMatchObject({
      pose: "tiptoe",
      scene: "pool",
      backdrop: "cream",
    });
    expect(unpackLook("look=1~crossed")?.pose).toBe("crossed");
  });
});

describe("unpackLook validation", () => {
  it("ignores names every object has, like constructor or toString", () => {
    const names = ["constructor", "toString", "__proto__", "hasOwnProperty"];
    for (const name of names) {
      const leg = [name, name, "0", name, "40", name, name, name, name].join(".");
      const look = unpackLook(`#look=1~${name}~${name}~${name}~${leg}~${leg}`);
      expect(look).toEqual({ legs: [withLegDefaults({}), withLegDefaults({})] });
    }
  });

  it.each([null, undefined, "", "#", "#nolook", "#xlook=1~step", "#look=2~step~bath~lilac", "#look="])(
    "returns null for %j",
    (hash) => {
      expect(unpackLook(hash)).toBeNull();
    },
  );

  it("fills a bare version with default legs and no scene keys", () => {
    expect(unpackLook("#look=1")).toEqual({ legs: DEFAULT_LEGS });
  });

  it("copies the left leg when the right one is missing", () => {
    const back = unpackLook("#look=1~step~bath~lilac~knee.rib.1.cotton.70.hoops.navy.paws.mist");
    const leg = withLegDefaults({
      length: "knee",
      cuff: "rib",
      garter: true,
      material: "cotton",
      denier: 70,
      pattern: "hoops",
      color: "navy",
      secret: "paws",
      wetColor: "mist",
    });
    expect(back?.legs).toEqual([leg, leg]);
  });

  it("drops unknown pose, scene and backdrop keys", () => {
    expect(unpackLook("#look=1~moonwalk~mars~xzzzzzz")).toEqual({ legs: DEFAULT_LEGS });
    expect(unpackLook("#look=1~step~bath~ink")?.backdrop).toBeUndefined();
  });

  it("replaces every invalid leg field with its default", () => {
    const back = unpackLook("#look=1~step~bath~lilac~shin.frill.yes.silk.41.plaid.x12345.ghost.xnothex~");
    expect(back?.legs[0]).toEqual(withLegDefaults());
    expect(back?.legs[1]).toEqual(withLegDefaults());
  });

  it("ignores palette names that are not stocking colors and missing trailing fields", () => {
    const back = unpackLook("#look=1~step~bath~lilac~over.plain.0.gloss.15.dots.lilac.none.lilac~over.plain");
    expect(back?.legs[0]).toEqual(
      withLegDefaults({ length: "over", cuff: "plain", material: "gloss", denier: 15, pattern: "dots" }),
    );
    expect(back?.legs[1]).toEqual(withLegDefaults({ length: "over", cuff: "plain" }));
  });

  it("keeps the raw payload when percent decoding fails", () => {
    const back = unpackLook("#look=1~step~bath~lilac~thigh.lace.0.sheer.40.none.%E0%A4%A");
    expect(back?.pose).toBe("step");
    expect(back?.legs[0].color).toBe("ink");
  });
});
