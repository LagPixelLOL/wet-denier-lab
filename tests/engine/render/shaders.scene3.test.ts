import { describe, expect, it } from "vitest";
import { defineProgramSuite, unusedUniformsByProgram } from "../../helpers/shaderCatalog";

// Backdrop and floor programs compiled with SCENE=3 (one file per scene so the slow parses run in parallel).
const inScene = (label: string) => label.endsWith(" SCENE=3");

describe("scene 3 backdrop and floor shaders", () => {
  defineProgramSuite(inScene);

  it("pins the uniforms the shared backdrop/floor objects carry beyond what SCENE=3 reads", () => {
    expect(unusedUniformsByProgram(inScene)).toMatchInlineSnapshot(`{}`);
  });
});
