import { describe, expect, it } from "vitest";
import { defineProgramSuite, fragmentName, unusedUniformsByProgram } from "../../helpers/shaderCatalog";

const isWaterProgram = (label: string) => /^(WET_|DROPLET_|BEAD_|GLINT_)/.test(fragmentName(label));

describe("wet map and droplet shaders", () => {
  defineProgramSuite(isWaterProgram);

  it("carry no uniforms their shaders do not declare", () => {
    expect(unusedUniformsByProgram(isWaterProgram)).toEqual({});
  });
});
