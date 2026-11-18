import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MATERIALS } from "../../../src/engine/catalog/garments";
import { SCENES } from "../../../src/engine/stage/scenes";
import type { SurfaceHit } from "../../../src/engine/surface/SurfaceGrid";
import type { Bead, FreeDrop, ThrownDrop, WaterSim } from "../../../src/engine/water/WaterSim";
import { digest, digestRounded } from "../../helpers/digest";
import { seedRandom } from "../../helpers/random";
import { waterWorld } from "../../helpers/waterWorld";
import type { WaterWorld } from "../../helpers/waterWorld";

const DT = 1 / 60;
const EYE = { x: 0, y: 0.5, z: 1.6 };

let restoreRandom: () => void;
beforeEach(() => {
  restoreRandom = seedRandom(3);
});
afterEach(() => {
  restoreRandom();
});

/** A point on a leg's surface, copied out of the reused hit object. */
function surfacePoint(world: WaterWorld, leg = 0, y = 0.33, z = 0.06): SurfaceHit {
  const [x, py, pz] = world.rig.point(leg, 0, y, z);
  const hit = world.rig.surface.closest(x, py, pz, 0.08);
  if (!hit) {
    throw new Error("no surface near the leg point");
  }
  return { ...hit };
}

function bead(
  hit: Pick<SurfaceHit, "x" | "y" | "z" | "nx" | "ny" | "nz" | "leg">,
  r: number,
  extra: Partial<Bead> = {},
): Bead {
  return {
    x: hit.x,
    y: hit.y,
    z: hit.z,
    nx: hit.nx,
    ny: hit.ny,
    nz: hit.nz,
    leg: hit.leg,
    vx: 0,
    vy: 0,
    vz: 0,
    r,
    age: 0,
    lx: hit.x,
    ly: hit.y,
    lz: hit.z,
    wob: 0,
    soakT: 0,
    ...extra,
  };
}

function freeDrop(
  kind: FreeDrop["kind"],
  x: number,
  y: number,
  z: number,
  r: number,
  v: [number, number, number] = [0, 0, 0],
): FreeDrop {
  return { kind, t: 0, r, x, y, z, vx: v[0], vy: v[1], vz: v[2] };
}

const kindCounts = (water: WaterSim) => [0, 1, 2, 3].map((kind) => water.drops.filter((d) => d.kind === kind).length);
const puddleSum = (water: WaterSim) => water.puddle.reduce((sum, v) => sum + v, 0);

describe("WaterSim construction", () => {
  it("sizes buffers for desktop and mobile", () => {
    const desktop = waterWorld().water;
    expect(desktop.caps).toEqual({ drops: [1100, 1600], beads: [520, 820], glints: 9, keep: 3 });
    // the constructor drops to the single-leg tier
    expect([desktop.maxDrops, desktop.maxBeads]).toEqual([1100, 520]);
    expect(desktop.beadMesh.instanceMatrix.count).toBe(820);
    expect(desktop.dropMesh.instanceMatrix.count).toBe(1600);
    expect(desktop.beadMesh.geometry.parameters.detail).toBe(3);
    expect(desktop.dropMesh.geometry.parameters.detail).toBe(2);
    expect(desktop.glintPos.count).toBe(18);
    const mobile = waterWorld({ mobile: true }).water;
    expect(mobile.caps).toEqual({ drops: [560, 820], beads: [300, 470], glints: 6, keep: 2 });
    expect(mobile.beadMesh.geometry.parameters.detail).toBe(2);
    expect(mobile.glintPhase.count).toBe(12);
  });

  it("draws decals, beads, drops and glints from one scene", () => {
    const { water } = waterWorld();
    expect(water.scene.children).toEqual([water.decalMesh, water.beadMesh, water.dropMesh, water.glintMesh]);
    expect(water.beadMesh.material).toBe(water.material);
    expect(water.dropMesh.material).toBe(water.material);
    expect(water.glintMat.uniforms.uResolution).toBe(water.material.uniforms.uResolution);
    expect(water.decalMat.uniforms.uDecalLightDir.value).toBe(water.keyWorld);
    expect([water.decalMesh.renderOrder, water.glintMesh.renderOrder]).toEqual([-1, 5]);
    expect(water.beadMesh.geometry.getAttribute("aR").count).toBe(820);
  });

  it("covers an 80 cm floor square with a 96x96 puddle grid and keeps 16 ripples", () => {
    const { water } = waterWorld();
    expect(water.puddle).toHaveLength(96 * 96);
    expect(water.puddleTex.image.width).toBe(96);
    expect(water.puddleRect.toArray()).toEqual([-0.4, -0.37, 0.8, 0.8]);
    expect(water.ripples).toHaveLength(16);
    expect(water.ripples[0].toArray()).toEqual([0, 0, -10, 0]);
  });
});

describe("WaterSim settings", () => {
  it("switches drop and bead budgets with the leg count", () => {
    const { water } = waterWorld();
    water.setLegCount(2);
    expect([water.maxDrops, water.maxBeads]).toEqual([1600, 820]);
    water.setLegCount(1);
    expect([water.maxDrops, water.maxBeads]).toEqual([1100, 520]);
  });

  it("takes the scene's droplet look", () => {
    const { water } = waterWorld();
    water.setLook(SCENES.street.water);
    const u = water.material.uniforms;
    expect(u.uEnvLo.value.toArray()).toEqual(SCENES.street.water.envLo);
    expect(u.uEnvHi.value.toArray()).toEqual(SCENES.street.water.envHi);
    expect(u.uRainTint.value.toArray()).toEqual(SCENES.street.water.rain);
  });

  it("stores per-leg bead behavior and the rain footprint", () => {
    const { water } = waterWorld();
    water.setLegWater(1, MATERIALS.latex.water);
    expect(water.legWater).toEqual([
      { bead: 1, slip: 1 },
      { bead: 2.6, slip: 2.2 },
    ]);
    water.setFootprint(0.1, 0.05, 0.6, 0.6);
    expect(water.rainOver).toEqual({ x: 0.1, z: 0.05, w: 0.6, d: 0.6, rate: 2 });
    water.setRainStyle("shower");
    water.setRain(true);
    expect([water.rainStyle, water.rain]).toEqual(["shower", true]);
  });
});

describe("throwAt", () => {
  it("launches a volley of drops on ballistic arcs that end on the surface", () => {
    const world = waterWorld();
    const { water } = world;
    const hit = surfacePoint(world);
    water.throwAt(hit, EYE);
    expect(water.drops).toHaveLength(30);
    for (const drop of water.drops as ThrownDrop[]) {
      expect(drop.kind).toBe(0);
      expect(drop.t).toBeLessThanOrEqual(0);
      expect(drop.t).toBeGreaterThanOrEqual(-0.045);
      expect(drop.T).toBeGreaterThanOrEqual(0.17 * 0.82);
      expect(drop.T).toBeLessThanOrEqual(0.17 * 1.22);
      expect(drop.r).toBeGreaterThanOrEqual(0.0007);
      expect(drop.r).toBeLessThanOrEqual(0.0045);
      // the arc lands exactly on the target
      expect(drop.sx + drop.vx * drop.T).toBeCloseTo(drop.tx, 12);
      expect(drop.sy + drop.vy * drop.T - 0.5 * 9.81 * drop.T ** 2).toBeCloseTo(drop.ty, 12);
      expect(world.rig.surface.closest(drop.tx, drop.ty, drop.tz, 0.001)?.dist).toBeLessThan(1e-6);
      // launched from the viewer's side of the leg
      expect(drop.sz).toBeGreaterThan(hit.z);
    }
    expect(
      digestRounded(
        (water.drops as ThrownDrop[]).flatMap((d) => [d.t, d.T, d.r, d.sx, d.sy, d.sz, d.tx, d.ty, d.tz]),
        9,
      ),
    ).toMatchInlineSnapshot(`"df0b86df"`);
  });

  it("honors count, size, wait and the drop budget", () => {
    const world = waterWorld();
    const { water } = world;
    const hit = surfacePoint(world);
    water.throwAt(hit, EYE, { count: 5, size: 2, wait: 0.5, delay: 0 });
    expect(water.drops).toHaveLength(5);
    expect(water.drops.every((d) => d.t === -0.5 && d.r >= 0.0014)).toBe(true);
    water.maxDrops = 8;
    water.throwAt(hit, EYE, { count: 30 });
    expect(water.drops).toHaveLength(8);
  });

  it("moves the launch point off the normal, then closer, when the legs block the line of flight", () => {
    const world = waterWorld();
    const { water, rig } = world;
    // vertices found by scanning the step pose: from the viewer, 17094 is blocked only when launching off the
    // normal; 1141 is blocked both ways and launches from just short of the blocker
    const launches = [17094, 1141].map((vertex) => {
      const hit = {
        ...rig.surface.closest(rig.pos[vertex * 3], rig.pos[vertex * 3 + 1], rig.pos[vertex * 3 + 2], 0.01)!,
      };
      water.drops.length = 0;
      water.throwAt(hit, EYE, { count: 4 });
      expect(water.drops.length).toBeGreaterThan(0);
      const drop = water.drops[0] as ThrownDrop;
      return Math.hypot(drop.sx - hit.x, drop.sy - hit.y, drop.sz - hit.z);
    });
    expect(launches[0]).toBeGreaterThan(0.35);
    expect(launches[1]).toBeLessThan(0.35);
    expect(digestRounded(launches, 9)).toMatchInlineSnapshot(`"aae0cd3e"`);
  });

  it("aims along x on horizontal targets and drops nothing when nothing is near", () => {
    const world = waterWorld();
    const { water } = world;
    const top = surfacePoint(world, 0, 0.05, 0.1);
    water.throwAt({ ...top, nx: 0, ny: 1, nz: 0 }, EYE, { count: 3 });
    expect(water.drops).toHaveLength(3);
    water.throwAt({ x: 2, y: 0.5, z: 0, nx: 0, ny: 0, nz: 1 }, EYE, { count: 5 });
    expect(water.drops).toHaveLength(3);
  });

  it("flies drops along their arc while airborne", () => {
    const world = waterWorld();
    const { water } = world;
    water.throwAt(surfacePoint(world), EYE, { count: 1, delay: 0 });
    const drop = water.drops[0] as ThrownDrop;
    water.update(0.05);
    expect(drop.t).toBe(0.05);
    expect(drop.x).toBeCloseTo(drop.sx + drop.vx * 0.05, 12);
    expect(drop.y).toBeCloseTo(drop.sy + drop.vy * 0.05 - 0.5 * 9.81 * 0.05 ** 2, 12);
    expect(water.events.impacts).toBe(0);
  });
});

describe("a splash on the leg", () => {
  function splash() {
    const world = waterWorld();
    const { water, wetmap, renderer } = world;
    water.setLegCount(2);
    water.throwAt(surfacePoint(world), EYE);
    renderer.reset();
    const timeline: string[] = [];
    for (let step = 1; step <= 60; step++) {
      water.update(DT);
      wetmap.update(DT);
      if (step % 15 === 0) {
        const e = water.events;
        timeline.push(
          `${step}: drops ${kindCounts(water).join("/")} beads ${water.beads.length} impacts ${e.impacts} floor ${e.floor}`,
        );
      }
    }
    return { ...world, timeline };
  }

  it("turns impacts into beads, spray, wet stamps and floor water (pinned run)", () => {
    const { water, renderer, wetmap, timeline } = splash();
    expect(timeline).toMatchInlineSnapshot(`
      [
        "15: drops 0/128/0/0 beads 90 impacts 30 floor 0",
        "30: drops 0/98/0/0 beads 92 impacts 45 floor 98",
        "45: drops 0/5/0/0 beads 94 impacts 45 floor 207",
        "60: drops 0/0/0/0 beads 92 impacts 45 floor 212",
      ]
    `);
    expect(water.time).toBeCloseTo(1, 12);
    const stampPasses = renderer.ops("render").filter((call) => call.scene === wetmap.stampScene);
    expect(stampPasses.length).toBeGreaterThan(10);
    expect(water.events.energy).toBeGreaterThan(0);
    expect(puddleSum(water)).toBeGreaterThan(0);
    expect(water.ripples.some((ripple) => ripple.z > 0)).toBe(true);
    expect(
      digestRounded(
        water.beads.flatMap((b) => [b.x, b.y, b.z, b.r]),
        7,
      ),
    ).toMatchInlineSnapshot(`"1496fc2d"`);
    expect(digest(water.puddleBytes)).toMatchInlineSnapshot(`"0e001606"`);
    expect(
      digestRounded(
        water.ripples.flatMap((r) => r.toArray()),
        7,
      ),
    ).toMatchInlineSnapshot(`"5b0c5276"`);
  });

  it("centers the impact energy on the hit point", () => {
    const world = waterWorld();
    const hit = surfacePoint(world);
    world.water.throwAt(hit, EYE);
    for (let step = 0; step < 15; step++) {
      world.water.update(DT);
    }
    const e = world.water.events;
    expect(e.impacts).toBeGreaterThan(20);
    expect(Math.hypot(e.ex / e.energy - hit.x, e.ey / e.energy - hit.y, e.ez / e.energy - hit.z)).toBeLessThan(0.03);
  });

  it("lets the beads slide, merge and drain over the next seconds", () => {
    const { water } = splash();
    const before = water.beads.length;
    const lowest = Math.min(...water.beads.map((b) => b.y));
    for (let step = 0; step < 120; step++) {
      water.update(DT);
    }
    expect(water.beads.length).toBeLessThan(before);
    expect(Math.min(...water.beads.map((b) => b.y))).toBeLessThanOrEqual(lowest);
    expect(water.sliding).toBe(false);
  });
});

describe("beads", () => {
  it("slide down a steep face, laying a trail and shrinking", () => {
    const world = waterWorld();
    const { water, wetmap } = world;
    const side = surfacePoint(world, 0, 0.4, 0.06);
    expect(Math.abs(side.ny)).toBeLessThan(0.3);
    const b = bead(side, 0.004);
    water.beads.push(b);
    for (let step = 0; step < 30; step++) {
      water.update(DT);
    }
    expect(water.sliding).toBe(true);
    expect(b.y).toBeLessThan(side.y - 0.005);
    expect(b.r).toBeLessThan(0.004);
    expect(wetmap.count).toBeGreaterThan(0);
    // trail stamps are capsules from the last laid point to the bead
    const a = wetmap.attr.aA.array;
    const e = wetmap.attr.aB.array;
    expect([a[0], a[1], a[2]]).not.toEqual([e[0], e[1], e[2]]);
    expect(digestRounded([b.x, b.y, b.z, b.r, b.vx, b.vy, b.vz], 9)).toMatchInlineSnapshot(`"e788851e"`);
  });

  it("stay pinned when small, and soak in a little every 0.6 s", () => {
    const world = waterWorld();
    const { water, wetmap } = world;
    const side = surfacePoint(world, 0, 0.4, 0.06);
    const b = bead(side, 0.001);
    water.beads.push(b);
    water.update(0.5);
    expect(wetmap.count).toBe(0);
    water.update(0.2);
    expect(wetmap.count).toBeGreaterThan(0);
    expect([b.x, b.y, b.z]).toEqual([side.x, side.y, side.z]);
    expect(water.sliding).toBe(false);
    expect(b.r).toBeCloseTo(0.001 - 0.7 * 0.000035, 12);
  });

  it("slip more on slippery fabric and evaporate faster on thirsty fabric", () => {
    const world = waterWorld();
    const { water } = world;
    const side = surfacePoint(world, 0, 0.4, 0.06);
    // 1.4 mm is pinned on plain fabric but slides on latex
    const pinned = bead(side, 0.0014);
    water.beads.push(pinned);
    water.update(DT);
    expect(pinned.y).toBe(side.y);
    water.setLegWater(0, MATERIALS.latex.water);
    water.update(DT);
    expect(pinned.y).toBeLessThan(side.y);
    water.beads.length = 0;
    water.setLegWater(0, MATERIALS.cotton.water);
    const thirsty = bead(side, 0.001);
    water.beads.push(thirsty);
    water.update(0.1);
    expect(thirsty.r).toBeCloseTo(0.001 - (0.1 * 0.000035) / 0.16 ** 2, 12);
  });

  it("drip off overhangs", () => {
    const world = waterWorld();
    world.rig.setPose("tiptoe", { instant: true });
    const { water, rig } = world;
    let best = -1;
    for (let i = 0; i < rig.pos.length / 3; i++) {
      if (
        rig.nrm[i * 3 + 1] < -0.6 &&
        rig.pos[i * 3 + 1] > 0.03 &&
        (best < 0 || rig.pos[i * 3 + 1] > rig.pos[best * 3 + 1])
      ) {
        best = i;
      }
    }
    expect(best).toBeGreaterThanOrEqual(0);
    const p = [rig.pos[best * 3], rig.pos[best * 3 + 1], rig.pos[best * 3 + 2]];
    const hit = { ...rig.surface.closest(p[0], p[1], p[2], 0.01)! };
    const b = bead(hit, 0.003, { vx: 0.2, vy: -0.2, vz: 0.2 });
    water.beads.push(b);
    water.update(DT);
    expect(water.beads).toHaveLength(0);
    expect(kindCounts(water)).toEqual([0, 0, 1, 0]);
    const drip = water.drops[0];
    // the drip carries 95% of the bead (which still evaporates a hair in the same step)
    expect(drip.r).toBeCloseTo(b.r * 0.95, 5);
    expect(drip.y).toBeLessThan(hit.y);
  });

  it("drip when they slide off the mesh and run into the floor at the bottom", () => {
    const { water } = waterWorld();
    water.beads.push(bead({ x: 3, y: 0.5, z: 0, nx: 1, ny: 0, nz: 0, leg: 0 }, 0.002, { vy: -0.1 }));
    water.beads.push(bead({ x: 0, y: 0.001, z: 0.03, nx: 0, ny: 1, nz: 0, leg: 0 }, 0.002));
    water.update(DT);
    expect(water.beads).toHaveLength(0);
    expect(kindCounts(water)).toEqual([0, 0, 1, 0]);
    expect(water.events.floor).toBe(1);
    expect(puddleSum(water)).toBeGreaterThan(0);
  });

  it("never slide faster than 55 cm/s", () => {
    const world = waterWorld();
    const { water } = world;
    const side = surfacePoint(world, 0, 0.4, 0.06);
    const b = bead(side, 0.004, { vy: -3 });
    water.beads.push(b);
    water.update(DT);
    expect(Math.hypot(b.vx, b.vy, b.vz)).toBeLessThanOrEqual(0.55 + 1e-12);
    expect(Math.hypot(b.x - side.x, b.y - side.y, b.z - side.z)).toBeLessThan(0.55 * DT + 0.001);
  });

  it("disappear once evaporated below 0.45 mm", () => {
    const world = waterWorld();
    const { water } = world;
    water.beads.push(bead(surfacePoint(world), 0.00046));
    water.update(1);
    expect(water.beads).toHaveLength(0);
  });

  it("merge when they touch, conserving volume", () => {
    const world = waterWorld();
    const { water } = world;
    const hit = surfacePoint(world);
    const a = bead(hit, 0.001, { age: 2 });
    const b = bead({ ...hit, x: hit.x + 0.0005 }, 0.0012, { age: 1, ny: 0.5 });
    water.beads.push(a, b);
    water._updateBeads(0);
    expect(water.beads).toEqual([a]);
    expect(a.r ** 3).toBeCloseTo(0.001 ** 3 + 0.0012 ** 3, 18);
    expect(a.ny).toBe(0.5);
    expect(a.age).toBeCloseTo(1.05, 12);
  });

  it("grow the nearest bead instead of adding one past the budget", () => {
    const world = waterWorld();
    const { water } = world;
    const hit = surfacePoint(world);
    water.maxBeads = 1;
    water._addBead(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 0.001, 0);
    water._addBead(hit.x + 0.01, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 0.001, 0);
    expect(water.beads).toHaveLength(1);
    expect(water.beads[0].r).toBeCloseTo(Math.cbrt(0.001 ** 3 * 1.8), 12);
    water._addBead(hit.x + 0.5, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 0.001, 0);
    expect(water.beads[0].r).toBeCloseTo(Math.cbrt(0.001 ** 3 * 1.8), 12);
  });

  it("all fall off on shakeOff, except the tiny ones", () => {
    const world = waterWorld();
    const { water } = world;
    const hit = surfacePoint(world);
    water.beads.push(bead(hit, 0.002), bead(hit, 0.0007), bead(hit, 0.0012));
    water.shakeOff();
    expect(water.beads).toHaveLength(0);
    expect(kindCounts(water)).toEqual([0, 0, 2, 0]);
    water.maxDrops = 2;
    water.beads.push(bead(hit, 0.002));
    water.shakeOff();
    expect(water.drops).toHaveLength(2);
  });
});

describe("impacts", () => {
  it("splash beads around the hit, two per splash on mobile, and skip spots off the mesh", () => {
    const desktop = waterWorld();
    const hit = surfacePoint(desktop);
    desktop.water._impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 0, 0, -0.5, 0.0005, true, 0);
    expect(desktop.water.beads.length).toBeLessThanOrEqual(3);
    expect(desktop.water.beads.length).toBeGreaterThan(0);
    const mobile = waterWorld({ mobile: true });
    const mobileHit = surfacePoint(mobile);
    mobile.water._impact(mobileHit.x, mobileHit.y, mobileHit.z, 0, 1, 0, 0, -0.5, 0, 0.0005, true, 0);
    expect(mobile.water.beads.length).toBeLessThanOrEqual(2);
    const far = waterWorld().water;
    far._impact(3, 0.5, 0, 0, 0, 1, 0, 0, -0.5, 0.0005, true, 0);
    expect(far.beads).toHaveLength(0);
    expect(far.events.impacts).toBe(1);
  });

  it("skip splash beads when the bead budget is nearly used up", () => {
    const world = waterWorld();
    const hit = surfacePoint(world);
    world.water.maxBeads = 40;
    world.water._impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 0, 0, -0.5, 0.0005, true, 0);
    expect(world.water.beads).toHaveLength(0);
  });
});

describe("free drops", () => {
  it("bead or splash on the fabric depending on speed", () => {
    const world = waterWorld();
    const { water, wetmap } = world;
    const hit = surfacePoint(world);
    const n = [hit.nx, hit.ny, hit.nz];
    const at = (offset: number) => [hit.x + n[0] * offset, hit.y + n[1] * offset, hit.z + n[2] * offset] as const;
    const slow = freeDrop(1, ...at(0.003), 0.0015, [-n[0] * 0.5, -n[1] * 0.5, -n[2] * 0.5]);
    slow.t = 0.03;
    water.drops.push(slow);
    water.update(DT);
    expect(water.drops).toHaveLength(0);
    expect(water.beads).toHaveLength(1);
    expect(water.events.impacts).toBe(0);
    expect(wetmap.count).toBeGreaterThan(0);
    const fast = freeDrop(1, ...at(0.004), 0.0015, [-n[0] * 3, -n[1] * 3, -n[2] * 3]);
    fast.t = 0.03;
    water.drops.push(fast);
    water.update(DT);
    expect(water.events.impacts).toBe(1);
    // a non-splash impact throws at most two spray drops
    expect(kindCounts(water)[1]).toBeLessThanOrEqual(2);
  });

  it("ignore the fabric in their first 25 ms (they start on it)", () => {
    const world = waterWorld();
    const { water } = world;
    const hit = surfacePoint(world);
    water.drops.push(freeDrop(1, hit.x, hit.y, hit.z, 0.0015, [hit.nx, hit.ny, hit.nz]));
    water.update(DT);
    expect(water.drops).toHaveLength(1);
    expect(water.beads).toHaveLength(0);
  });

  it("hit the floor: puddle, ripple and, when big and fast, a splash", () => {
    const { water } = waterWorld();
    water.drops.push(freeDrop(1, 0, 0.0021, 0.03, 0.002, [0, -3, 0]));
    water.update(DT);
    expect(water.events.floor).toBe(1);
    expect([water.events.fx, water.events.fz]).toEqual([0, expect.closeTo(0.03, 1)]);
    expect(water.ripples[0].toArray()).toEqual([0, expect.closeTo(0.03, 1), DT, 1]);
    expect(kindCounts(water)).toEqual([0, 2, 0, 0]);
    // the puddle peaks under the drop, in the middle of the grid
    let peak = 0;
    water.puddle.forEach((v, i) => {
      if (v > water.puddle[peak]) {
        peak = i;
      }
    });
    expect([peak % 96, Math.floor(peak / 96)]).toEqual([48, 48]);
    expect(water.puddle[peak]).toBeCloseTo(0.16, 2);
  });

  it("make faint ripples only sometimes when small, and no splash when slow", () => {
    const { water } = waterWorld();
    for (let i = 0; i < 8; i++) {
      water.drops.push(freeDrop(3, -0.2 + i * 0.05, 0.0004, 0, 0.0005, [0, -0.5, 0]));
    }
    water.update(DT);
    expect(water.events.floor).toBe(8);
    expect(water.rippleIdx).toBeLessThan(8);
    expect(water.drops).toHaveLength(0);
  });

  it("time out after four seconds in the air", () => {
    const { water } = waterWorld();
    const drop = freeDrop(1, 5, 50, 5, 0.001, [0, 0, 0]);
    drop.t = 3.99;
    water.drops.push(drop);
    water.update(DT);
    expect(water.drops).toHaveLength(0);
  });

  it("use substeps when fast", () => {
    const { water } = waterWorld();
    const slow = freeDrop(2, 5, 1, 5, 0.001, [0, 0.1, 0]);
    const fast = freeDrop(2, 6, 1, 5, 0.001, [0, 1, 0]);
    water.drops.push(slow, fast);
    water.update(DT);
    expect(slow.vy).toBeCloseTo((0.1 - 9.81 * DT) * (1 - DT * 0.8), 12);
    const h = DT / 3;
    let vy = 1;
    for (let s = 0; s < 3; s++) {
      vy = (vy - 9.81 * h) * (1 - h * 0.8);
    }
    expect(fast.vy).toBeCloseTo(vy, 12);
  });
});

describe("puddle", () => {
  it("updates at 20 Hz, spreading and drying out", () => {
    const { water } = waterWorld();
    water._floorHit(0, 0.03, 0.002, 0.5);
    const version = water.puddleTex.version;
    const peak = water.puddle[48 * 96 + 48];
    water._updatePuddle(0.02);
    expect(water.puddleTex.version).toBe(version);
    water._updatePuddle(0.04);
    expect(water.puddleTex.version).toBe(version + 1);
    expect(water.puddle[48 * 96 + 48]).toBeLessThan(peak);
    expect(water.puddleBytes[48 * 96 + 48]).toBe(Math.floor(Math.min(255, water.puddle[48 * 96 + 48] * 255)));
    expect(water._pudWasWet).toBe(true);
    for (let i = 0; i < 40; i++) {
      water._updatePuddle(0.5);
    }
    expect(puddleSum(water)).toBe(0);
    expect(water._pudWasWet).toBe(false);
    const dryVersion = water.puddleTex.version;
    water._updatePuddle(0.5);
    expect(water.puddleTex.version).toBe(dryVersion);
  });

  it("only fills cells inside the grid", () => {
    const { water } = waterWorld();
    water._floorHit(0.39, 0.42, 0.003, 0);
    expect(puddleSum(water)).toBeGreaterThan(0);
    expect(water.puddle[95 * 96 + 95]).toBeGreaterThan(0);
  });
});

describe("rain", () => {
  it("only falls while enabled", () => {
    const { water } = waterWorld();
    water.update(DT);
    expect(water.drops).toHaveLength(0);
    water.setRain(true);
    water.update(DT);
    expect(kindCounts(water)).toEqual([0, 0, 0, 2]);
    water.setRain(false);
    water.update(DT);
    expect(kindCounts(water)[3]).toBe(2);
  });

  it("spawns drops over the footprint at a rate scaled by its area", () => {
    const { water } = waterWorld();
    water._spawnRain(0.1);
    // 170 drops/s over the default 30 x 30 cm footprint; the fraction carries over
    expect(water.drops).toHaveLength(16);
    expect(water.rainAcc).toBeCloseTo(1, 9);
    for (const drop of water.drops as FreeDrop[]) {
      expect(drop.kind).toBe(3);
      expect(drop.y).toBeGreaterThanOrEqual(1);
      expect(drop.y).toBeLessThanOrEqual(1.35);
      expect(Math.abs(drop.x)).toBeLessThanOrEqual(0.15 + 0.325);
      expect([drop.vx, drop.vy, drop.vz]).toEqual([0.1, -3.8, 0.05]);
    }
    water.drops.length = 0;
    water.rainAcc = 0;
    water.setFootprint(0, 0.04, 0.6, 0.6);
    water._spawnRain(0.1);
    expect(water.drops).toHaveLength(33);
  });

  it("falls as a shower cone in the bath style, and thinner on mobile", () => {
    const desktop = waterWorld().water;
    desktop.setRainStyle("shower");
    desktop._spawnRain(0.1);
    expect(desktop.drops).toHaveLength(25);
    for (const drop of desktop.drops as FreeDrop[]) {
      expect(drop.vy).toBe(-4.3);
      expect(drop.y).toBeGreaterThanOrEqual(1.02);
      expect(Math.hypot(drop.x / 0.26, (drop.z - 0.04) / 0.26)).toBeLessThanOrEqual(1);
    }
    const mobile = waterWorld({ mobile: true }).water;
    mobile._spawnRain(0.1);
    expect(mobile.drops).toHaveLength(10);
  });

  it("stops spawning at the drop budget and wets the legs and the floor", () => {
    const { water, wetmap } = waterWorld();
    water.maxDrops = 40;
    water.setRain(true);
    for (let step = 0; step < 30; step++) {
      water.update(DT);
      expect(water.drops.length).toBeLessThanOrEqual(40);
    }
    expect(water.events.floor).toBeGreaterThan(0);
    expect(water.events.impacts + wetmap.count).toBeGreaterThan(0);
  });
});

describe("dryAll", () => {
  it("removes all water and clears the wet map", () => {
    const world = waterWorld();
    const { water, renderer, wetmap } = world;
    water.throwAt(surfacePoint(world), EYE);
    for (let step = 0; step < 30; step++) {
      water.update(DT);
    }
    renderer.reset();
    water.dryAll();
    expect([water.drops.length, water.beads.length, puddleSum(water), wetmap.wetBound]).toEqual([0, 0, 0, 0]);
    expect(renderer.ops("clear").map((call) => call.target)).toEqual([wetmap.a, wetmap.b]);
  });
});

describe("sync", () => {
  const camera = () => {
    const cam = new THREE.PerspectiveCamera(30, 1, 0.02, 12);
    cam.position.set(EYE.x, EYE.y, EYE.z);
    cam.lookAt(0, 0.4, 0);
    cam.updateMatrixWorld();
    return cam;
  };
  const light = new THREE.Vector3(-0.5, 0.75, 0.45).normalize();

  it("writes bead, decal and drop instances and the view-space light", () => {
    const world = waterWorld();
    const { water } = world;
    const hit = surfacePoint(world);
    water.beads.push(bead(hit, 0.002, { age: 0.5 }), bead(hit, 0.001, { vy: -0.05, age: 0.02 }));
    water.drops.push(freeDrop(3, 0.1, 0.5, 0.1, 0.001, [0.1, -3.8, 0.05]), freeDrop(1, 0, 0.3, 0.2, 0.0008, [0, 1, 0]));
    const texture = new THREE.Texture();
    const cam = camera();
    water.sync(cam, texture, new THREE.Vector2(800, 600), light);
    const u = water.material.uniforms;
    expect(u.uSceneTex.value).toBe(texture);
    expect(u.uResolution.value.toArray()).toEqual([800, 600]);
    expect(u.uLightDirView.value.toArray()).toEqual(light.clone().transformDirection(cam.matrixWorldInverse).toArray());
    expect(water.keyWorld.toArray()).toEqual(light.toArray());
    expect([water.beadMesh.count, water.decalMesh.count, water.dropMesh.count]).toEqual([2, 2, 2]);
    expect(water.dropMesh.geometry.getAttribute("aKind").getX(0)).toBe(3);
    // rain is drawn fatter than other drops
    expect(water.dropMesh.geometry.getAttribute("aR").getX(0)).toBeCloseTo(0.00125, 9);
    expect(water.dropMesh.geometry.getAttribute("aR").getX(1)).toBeCloseTo(0.0008, 9);
    // a young bead is drawn smaller while it grows in
    expect(water.beadMesh.geometry.getAttribute("aR").getX(0)).toBeCloseTo(0.002, 9);
    expect(water.beadMesh.geometry.getAttribute("aR").getX(1)).toBeCloseTo(0.001 * (0.55 + 0.18), 9);
    const matrices = [
      ...water.beadMesh.instanceMatrix.array.subarray(0, 32),
      ...water.dropMesh.instanceMatrix.array.subarray(0, 32),
    ];
    expect(matrices.every(Number.isFinite)).toBe(true);
    expect(digestRounded(matrices, 6)).toMatchInlineSnapshot(`"bd80a248"`);
  });

  it("orients resting beads on flat ground with a fallback frame", () => {
    const { water } = waterWorld();
    water.beads.push(bead({ x: 0, y: 0.2, z: 0, nx: 0, ny: 1, nz: 0, leg: 0 }, 0.002, { age: 1 }));
    water.sync(camera(), null, new THREE.Vector2(1, 1), light);
    const m = new THREE.Matrix4().fromArray(water.beadMesh.instanceMatrix.array, 0);
    expect(m.elements.every(Number.isFinite)).toBe(true);
    // the bead's up axis (second column) is the surface normal scaled by 0.64 r
    expect(m.elements[5]).toBeCloseTo(0.002 * 0.64, 9);
  });

  it("picks glints from the biggest lit beads, at most a few per leg", () => {
    const world = waterWorld();
    const { water } = world;
    const hit = surfacePoint(world);
    const other = surfacePoint(world, 1);
    for (let i = 0; i < 12; i++) {
      water.beads.push(bead(hit, 0.0013 + i * 0.0001, { age: 0.5, wob: i }));
    }
    water.beads.push(bead(other, 0.002, { age: 0.5 }));
    // too young, too small, facing away from the light
    water.beads.push(bead(hit, 0.003, { age: 0.1 }), bead(hit, 0.001, { age: 1 }));
    water.beads.push(bead({ ...hit, nx: -light.x, ny: -light.y, nz: -light.z }, 0.003, { age: 1 }));
    water.sync(camera(), null, new THREE.Vector2(1, 1), light);
    expect(water.glintGeo.instanceCount).toBe(9 + 1);
    expect(water.glintPos.array[3]).toBeCloseTo(0.0024, 9);
    expect(water.glintPhase.array[1]).toBe(1);
  });

  it("keeps a dimmed glint on a few big old beads after the fresh ones fade", () => {
    const world = waterWorld();
    const { water } = world;
    const hit = surfacePoint(world);
    for (let i = 0; i < 5; i++) {
      water.beads.push(bead(hit, 0.002 + i * 0.0001, { age: 6 }));
    }
    water.beads.push(bead(hit, 0.0013, { age: 6 }));
    water.sync(camera(), null, new THREE.Vector2(1, 1), light);
    expect(water.glintGeo.instanceCount).toBe(3);
    expect([...water.glintPhase.array.subarray(0, 6)].filter((_, i) => i % 2 === 1)).toEqual([
      expect.closeTo(0.3, 6),
      expect.closeTo(0.3, 6),
      expect.closeTo(0.3, 6),
    ]);
    expect(water.beads.map((b) => b.glow)).toEqual([0, 0, 0.3, 0.3, 0.3, 0]);
  });

  it("skips drops waiting to launch; airborne thrown drops get NaN matrices (known bug, see below)", () => {
    const world = waterWorld();
    const { water } = world;
    water.throwAt(surfacePoint(world), EYE, { count: 2, delay: 0, wait: 0.1 });
    water.sync(camera(), null, new THREE.Vector2(1, 1), light);
    expect(water.dropMesh.count).toBe(0);
    water.update(0.15);
    water.sync(camera(), null, new THREE.Vector2(1, 1), light);
    expect(water.dropMesh.count).toBe(2);
    // sync() computes the in-flight velocity as `vy - glintPosArray * t` (NaN) instead of `vy - GRAVITY * t`,
    // so the stretched-drop matrix of every thrown drop in flight is NaN and the drop is not drawn.
    expect(water.dropMesh.instanceMatrix.array.subarray(0, 32).some(Number.isNaN)).toBe(true);
  });
});
