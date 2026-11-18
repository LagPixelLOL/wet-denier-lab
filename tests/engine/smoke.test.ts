import { describe, expect, it } from "vitest";
import { lookUrl, unpackLook } from "../../src/engine/share/lookCodec";
import { withLegDefaults } from "../../src/engine/catalog/presets";

describe("smoke", () => {
  it("round-trips a look through a share link", () => {
    const legs = [withLegDefaults({}), withLegDefaults({ color: "#123456" })];
    const url = lookUrl({ pose: "step", scene: "bath", backdrop: "lilac", legs });
    const back = unpackLook(url.slice(url.indexOf("#")));
    expect(back?.scene).toBe("bath");
    expect(back?.legs[1].color).toBe("#123456");
  });
});
