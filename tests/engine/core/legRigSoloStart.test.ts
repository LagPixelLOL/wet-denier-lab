import { describe, expect, it, vi } from "vitest";
import { LegRig } from "../../../src/engine/rig/LegRig";
import { legModel } from "../../helpers/model";

// Start the rig in the solo pose to cover the constructor's single-leg setup.
vi.mock("../../../src/engine/rig/poses", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/engine/rig/poses")>()),
  DEFAULT_POSE: "single",
}));

describe("LegRig starting in a solo pose", () => {
  it("hides the second leg and indexes only the first one", () => {
    const opacity = [NaN, NaN];
    const rig = new LegRig(legModel().collision, {
      setLegPose: () => {},
      setLegOpacity: (index, value) => {
        opacity[index] = value;
      },
      setCastPoints: () => {},
    });
    expect(rig.name).toBe("single");
    expect(rig.solo).toBe(true);
    expect(rig.shown).toEqual([1, 0]);
    expect(rig.presence).toEqual([1, 0]);
    expect(opacity).toEqual([1, 0]);
    expect(rig.visibleLegs).toEqual([0]);
    expect(rig.surface.active).toBe(rig.legTris);
    expect(rig.footprint).toEqual({ x: 0, z: 0.04, w: 0.3, d: 0.3 });
    expect(rig.update(1 / 60)).toBeNull();
  });
});
