import { describe, expect, it } from "vitest";
import { defineProgramSuite, unusedUniformsByProgram } from "../../helpers/shaderCatalog";

// Backdrop and floor programs compiled with SCENE=0 (one file per scene so the slow parses run in parallel).
const inScene = (label: string) => label.endsWith(" SCENE=0");

describe("scene 0 backdrop and floor shaders", () => {
  defineProgramSuite(inScene);

  it("pins the uniforms the shared backdrop/floor objects carry beyond what SCENE=0 reads", () => {
    expect(unusedUniformsByProgram(inScene)).toMatchInlineSnapshot(`
      {
        "BACKDROP_VERTEX BACKDROP_FRAGMENT SCENE=0": [
          "uBackdropTime",
          "uFocusDist",
          "uPixelAngle",
          "uRain",
        ],
        "FLOOR_VERTEX FLOOR_FRAGMENT SCENE=0": [
          "uBackdropTime",
          "uFocusDist",
          "uMarkColor",
          "uMirror",
          "uMirrorStrength",
          "uPixelAngle",
          "uPuddleLight",
          "uRain",
        ],
      }
    `);
  });
});
