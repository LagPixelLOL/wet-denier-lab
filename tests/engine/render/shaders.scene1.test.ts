import { describe, expect, it } from "vitest";
import { defineProgramSuite, unusedUniformsByProgram } from "../../helpers/shaderCatalog";

// Backdrop and floor programs compiled with SCENE=1 (one file per scene so the slow parses run in parallel).
const inScene = (label: string) => label.endsWith(" SCENE=1");

describe("scene 1 backdrop and floor shaders", () => {
  defineProgramSuite(inScene);

  it("pins the uniforms the shared backdrop/floor objects carry beyond what SCENE=1 reads", () => {
    expect(unusedUniformsByProgram(inScene)).toMatchInlineSnapshot(`{}`);
  });
});
