import * as THREE from "three";
import type { Vec3 } from "../../src/engine/rig/joints";
import { LegRig } from "../../src/engine/rig/LegRig";
import type { LegRigTarget } from "../../src/engine/rig/LegRig";
import type { LegPose } from "../../src/engine/rig/skinning";
import { WaterSim } from "../../src/engine/water/WaterSim";
import { WetMap } from "../../src/engine/water/WetMap";
import type { WetMapLeg } from "../../src/engine/water/WetMap";
import { FakeRenderer } from "./fakeRenderer";
import { legModel } from "./model";

/** Leg target with the same skinning uniforms and matrix the stage keeps, without any rendering. */
export class RigUniformLegs implements LegRigTarget {
  legs: WetMapLeg[] = [0, 1].map(() => ({
    rig: {
      uToeRot: { value: new THREE.Matrix3() },
      uAnkleRot: { value: new THREE.Matrix3() },
      uKneeRot: { value: new THREE.Matrix3() },
      uRigOn: { value: 0 },
    },
    matrix: new THREE.Matrix4(),
  }));
  opacity = [1, 1];
  castPoints: Vec3[] = [];
  setLegPose(index: number, pose: LegPose, matrix: Float64Array): void {
    const rig = this.legs[index].rig;
    rig.uToeRot.value.set(...pose.T);
    rig.uAnkleRot.value.set(...pose.A);
    rig.uKneeRot.value.set(...pose.K);
    rig.uRigOn.value = pose.on;
    this.legs[index].matrix.fromArray(matrix);
  }
  setLegOpacity(index: number, opacity: number): void {
    this.opacity[index] = opacity;
  }
  setCastPoints(points: Vec3[], _radii?: number[]): void {
    this.castPoints = points;
  }
}

export interface WaterWorld {
  renderer: FakeRenderer;
  target: RigUniformLegs;
  rig: LegRig;
  wetmap: WetMap;
  water: WaterSim;
}

/** A fresh rig (default "step" pose, both legs), wet map and water simulation on a fake renderer. */
export function waterWorld({ mobile = false, size = 1024 } = {}): WaterWorld {
  const renderer = new FakeRenderer();
  const target = new RigUniformLegs();
  const model = legModel();
  const rig = new LegRig(model.collision, target, model.forefootCollision);
  const wetmap = new WetMap(renderer.asRenderer, model.stockingLow, rig.surface, size, target.legs);
  const water = new WaterSim({ surface: rig.surface, wetmap, mobile });
  return { renderer, target, rig, wetmap, water };
}
