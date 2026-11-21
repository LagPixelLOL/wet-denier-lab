import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { LEG_JOINTS } from "../../../src/engine/rig/joints";
import { legLid } from "../../../src/engine/stage/lid";
import {
  ANKLE,
  ANKLE_BAND,
  ANKLE_FADE_GLSL,
  fadeHeight,
  LEG_DEPTH_FRAGMENT_SHADER,
  LEG_FRAGMENT_SHADER,
  LEG_VERTEX_SHADER,
  LID_BINS,
  LID_GLSL,
  LID_NEAR,
  LID_REACH,
  LID_STEP,
} from "../../../src/engine/stage/shaders/leg";
import { OUTLINE_FRAGMENT_SHADER } from "../../../src/engine/stage/shaders/outline";
import {
  CASTER_COVER_FRAGMENT_SHADER,
  CASTER_FRAGMENT_SHADER,
  CASTER_VERTEX_SHADER,
} from "../../../src/engine/stage/shaders/post";
import { legModel } from "../../helpers/model";

/** The shader's test (LID_GLSL), in the leg's own space at rest. */
function seenThroughTop(lid: ReturnType<typeof legLid>, eye: number[], at: number[], fadeStart: number): boolean {
  const eyeHeight = fadeHeight(eye[0], eye[1], eye[2]);
  const atHeight = fadeHeight(at[0], at[1], at[2]);
  const lidHeight = Math.max(fadeStart, atHeight + LID_STEP);
  if (eyeHeight <= lidHeight) {
    return false;
  }
  const t = (eyeHeight - lidHeight) / (eyeHeight - atHeight);
  const across = [eye[0] + (at[0] - eye[0]) * t - lid.center[0], eye[2] + (at[2] - eye[2]) * t - lid.center[1]];
  const turn = (Math.atan2(across[1], across[0]) / (2 * Math.PI) + 0.5) * LID_BINS;
  const bin = Math.floor(turn) % LID_BINS;
  const reach = lid.radii[bin] + (lid.radii[(bin + 1) % LID_BINS] - lid.radii[bin]) * (turn - Math.floor(turn));
  const under = THREE.MathUtils.smoothstep(lidHeight - atHeight, LID_NEAR[0], LID_NEAR[1]);
  return Math.hypot(across[0], across[1]) < reach * (LID_REACH + (1 - LID_REACH) * under);
}

describe("the leg's lid", () => {
  it("measures an outline's middle and its reach around it", () => {
    // A ring twice as far across x as across z, around (0.3, -0.1), at the fade height 0.5.
    const positions: number[] = [];
    for (let i = 0; i < 1440; i++) {
      const angle = (i / 1440) * 2 * Math.PI;
      const [x, z] = [0.3 + Math.cos(angle) * 0.08, -0.1 + Math.sin(angle) * 0.04];
      // The height that puts the point on the slanted plane of that fade height.
      positions.push(x, 0.5 + 0.3346 * (x - 0.066) - 0.0157 * (z - 0.04), z);
    }
    // Vertices elsewhere on the leg do not count.
    positions.push(0.9, 0.2, 0.9, 0.9, 0.8, 0.9);
    const lid = legLid(positions, 0.5, 64);
    expect(lid.center[0]).toBeCloseTo(0.3, 6);
    expect(lid.center[1]).toBeCloseTo(-0.1, 6);
    expect(lid.radii).toHaveLength(64);
    // The first direction points along -x, and they go on around from x toward z.
    expect(lid.radii[0]).toBeCloseTo(0.08, 3);
    expect(lid.radii[16]).toBeCloseTo(0.04, 3);
    expect(lid.radii[32]).toBeCloseTo(0.08, 3);
    expect(lid.radii[48]).toBeCloseTo(0.04, 3);
    lid.radii.forEach((reach) => {
      expect(reach).toBeGreaterThan(0.039);
      expect(reach).toBeLessThan(0.081);
    });
  });

  it("gives directions no vertex lies in the reach of their neighbors, and an empty outline none", () => {
    // Four vertices only, on the plane of fade height 0.5 around (0.066, 0.04).
    const lid = legLid(
      [0.166, 0.53346, 0.04, -0.034, 0.46654, 0.04, 0.066, 0.49843, 0.14, 0.066, 0.50157, -0.06],
      0.5,
      16,
    );
    lid.radii.forEach((reach) => expect(reach).toBeCloseTo(0.1, 6));
    expect(legLid([0, 5, 0], 0.5, 8)).toEqual({ center: [0, 0], radii: Array(8).fill(0) });
  });

  it("fits the leg where its top begins to fade, for stockings and for tights", () => {
    const positions = legModel().stocking.attributes.position.array;
    for (const fadeStart of [0.79, 0.7]) {
      const lid = legLid(positions, fadeStart, LID_BINS);
      // A thigh: some 6 to 14 cm from its middle to its surface, all the way around.
      lid.radii.forEach((reach) => {
        expect(reach).toBeGreaterThan(0.06);
        expect(reach).toBeLessThan(0.14);
      });
      lid.radii.forEach((reach, i) => expect(Math.abs(reach - lid.radii[(i + 1) % LID_BINS])).toBeLessThan(0.012));

      const [cx, cz] = lid.center;
      const onPlane = (x: number, z: number, below = 0) => [
        x,
        fadeStart - below + 0.3346 * (x - 0.066) - 0.0157 * (z - 0.04),
        z,
      ];
      const [toward, away] = [lid.radii[(3 * LID_BINS) / 4], lid.radii[LID_BINS / 4]];
      const eye = [cx, 1.4, cz + 0.1];
      // Looking down into the leg: the far wall and the shin, seen over the near rim, are seen through the top.
      expect(seenThroughTop(lid, eye, onPlane(cx, cz - away * 0.8, 0.05), fadeStart)).toBe(true);
      expect(seenThroughTop(lid, eye, [cx, 0.3, cz], fadeStart)).toBe(true);
      // The near wall's outside right under where the fade begins is seen from outside: its line of sight
      // passes the rim by next to nothing, and counts as outside the lid...
      expect(seenThroughTop(lid, eye, onPlane(cx, cz + toward * 0.99, 0.005), fadeStart)).toBe(false);
      // ...while further down a line of sight that close to the rim is through the lid: no sliver of the leg
      // shows along the rim of its own top.
      const along = (below: number) => {
        // The point that far below the lid whose line of sight crosses the lid 1% short of its rim.
        const t = (1.4 - fadeStart) / (1.4 - fadeStart + below);
        return onPlane(cx, cz + 0.1 + (toward * 0.99 - 0.1) / t, below);
      };
      expect(seenThroughTop(lid, eye, along(0.006), fadeStart)).toBe(false);
      expect(seenThroughTop(lid, eye, along(0.2), fadeStart)).toBe(true);
      // Nothing is seen through the top from below it.
      expect(seenThroughTop(lid, [cx, fadeStart - 0.2, cz + 1], [cx, 0.3, cz], fadeStart)).toBe(false);
      // A point of the fading top itself: its lid lies just above it. From above, through that; from the side, not.
      expect(seenThroughTop(lid, eye, onPlane(cx, cz - away * 0.5, -0.03), fadeStart)).toBe(true);
      expect(seenThroughTop(lid, [cx, fadeStart + 0.031, cz + 1], onPlane(cx, cz, -0.03), fadeStart)).toBe(false);
    }
    expect(LID_REACH).toBeGreaterThan(0.9);
    expect(LID_REACH).toBeLessThan(1);
    expect(LID_NEAR[0]).toBeLessThan(LID_NEAR[1]);
    expect(LID_NEAR[1]).toBeLessThan(0.09);
    expect(LID_STEP).toBeLessThan(LID_NEAR[0]);
  });

  it("is tested in the shaders that draw the leg's outside, and by the line around it", () => {
    for (const shader of [LEG_DEPTH_FRAGMENT_SHADER, LEG_FRAGMENT_SHADER, OUTLINE_FRAGMENT_SHADER]) {
      expect(shader).toContain(LID_GLSL);
    }
    expect(LID_GLSL).toContain(`uniform float uLidR[${LID_BINS}];`);
    expect(LID_GLSL).toContain(`float lid = max(fadeStart, atHeight + ${LID_STEP.toFixed(4)});`);
    expect(LID_GLSL).toContain(
      `float under = smoothstep(${LID_NEAR[0].toFixed(3)}, ${LID_NEAR[1].toFixed(3)}, lid - atHeight);`,
    );
    expect(LID_GLSL).toContain(`return length(across) < reach * mix(${LID_REACH.toFixed(3)}, 1.0, under);`);
    // What is past the band above the ankle and seen through the top lays down no depth, and is not drawn...
    expect(LEG_DEPTH_FRAGMENT_SHADER).toContain(
      "if (aboveAnkle && (!gl_FrontFacing || (uMirrorFlipY > 0.0 && seenThroughTop(vWorldPos, uFadeStart)))) discard;",
    );
    // ...and across the band it fades out, as does the line around it.
    expect(LEG_FRAGMENT_SHADER).toContain(
      "else if (ankleFade > 0.0 && uMirrorFlipY > 0.0 && seenThroughTop(vWorldPos, uFadeStart)) fade = max(fade, ankleFade);",
    );
    expect(OUTLINE_FRAGMENT_SHADER).toContain(
      `if (seenThroughTop(vWorldPos, uFadeStart)) alpha *= 1.0 - ${ANKLE_FADE_GLSL};`,
    );
    // Nor is the fading top where it is seen through the top: a fold of it behind another part of it.
    expect(LEG_FRAGMENT_SHADER).toMatch(
      /#ifdef FADE_ZONE\s+if \(!gl_FrontFacing \|\| vFadeHeight <= uFadeStart\) discard;\s+\/\/[^\n]*\n\s+if \(uMirrorFlipY > 0\.0 && seenThroughTop\(vWorldPos, uFadeStart\)\) discard;\s+#endif/,
    );
  });
});

describe("what of a leg is seen through", () => {
  it("begins at the ankle, across a band above it", () => {
    expect(ANKLE).toBe(LEG_JOINTS.ankle[1]);
    expect(ANKLE_BAND).toBeGreaterThan(0.02);
    expect(ANKLE_BAND).toBeLessThan(0.1);
    expect(ANKLE_FADE_GLSL).toBe(`smoothstep(${ANKLE.toFixed(4)}, ${(ANKLE + ANKLE_BAND).toFixed(4)}, vRestPos.y)`);
    // The inside: solid at the ankle, all but invisible above the band, gone by where the top begins to fade.
    expect(LEG_FRAGMENT_SHADER).toContain(
      "if (!gl_FrontFacing) fade = max(fade, ankleFade * mix(0.92, 1.0, smoothstep(uFadeStart - 0.10, uFadeStart, vFadeHeight)));",
    );
  });

  it("is drawn in passes of its own, which the shaders pick the surface's parts for", () => {
    const variant = (shader: string, define: string): string =>
      new RegExp(`#(?:ifdef|if defined\\(|elif defined\\()\\s*${define}\\)?\\n((?:(?!#).*\\n)+)`).exec(shader)![1];
    const lines = (text: string): string[] =>
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("//"));
    // With the leg: the depth of what is solid, and its color from the band above the ankle down and from
    // there up in passes of their own.
    expect(LEG_DEPTH_FRAGMENT_SHADER).toContain("if (vFadeHeight > uFadeStart) discard;");
    expect(lines(variant(LEG_FRAGMENT_SHADER, "LOW_PART"))).toEqual([`if (${ANKLE_FADE_GLSL} >= 1.0) discard;`]);
    // The color above the band is the leg's solid outside alone: nothing else whose depth is in place while it
    // is drawn.
    expect(lines(variant(LEG_FRAGMENT_SHADER, "HIGH_PART"))).toEqual([
      `if (${ANKLE_FADE_GLSL} < 1.0 || !gl_FrontFacing || vFadeHeight > uFadeStart) discard;`,
    ]);
    // The curtain: all of the leg but its solid outside...
    expect(lines(variant(LEG_DEPTH_FRAGMENT_SHADER, "CURTAIN"))).toEqual([
      "if (gl_FrontFacing && vFadeHeight <= uFadeStart) discard;",
    ]);
    // ...and how much of the solid leg behind it shows through each part of it: nothing through the leg's
    // inside below the fade, and as much as the part has faded out above that. Alpha alone.
    expect(lines(variant(LEG_DEPTH_FRAGMENT_SHADER, "VEIL"))).toEqual([
      "float shows = !gl_FrontFacing && vFadeHeight <= uFadeStart ? 0.0 : smoothstep(uFadeStart, uFadeEnd, vFadeHeight);",
      "gl_FragColor = vec4(0.0, 0.0, 0.0, shows * uOpacity);",
    ]);
    expect(LEG_DEPTH_FRAGMENT_SHADER).toContain("gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);");
    // What is taken out again is drawn at the far end of the depth range.
    expect(LEG_VERTEX_SHADER).toMatch(/#ifdef FAR_PLANE\s+[^#]*gl_Position\.z = gl_Position\.w;\s+#endif/);
    // After both legs: the inside, up to where the top begins to fade, in the color it has before anything
    // shines on it, and coming in as the eye begins to look down into the leg.
    const inside = lines(variant(LEG_FRAGMENT_SHADER, "LEG_INSIDE"));
    expect(inside).toEqual([`if (gl_FrontFacing || ${ANKLE_FADE_GLSL} < 1.0 || vFadeHeight > uFadeStart) discard;`]);
    const early = /#ifdef LEG_INSIDE\n((?:(?!#).*\n)+)#endif\n/g;
    const blocks = [...LEG_FRAGMENT_SHADER.matchAll(early)].map((match) => lines(match[1]));
    expect(blocks).toHaveLength(2);
    expect(LEG_FRAGMENT_SHADER).toMatch(
      /#ifdef LEG_INSIDE\n[^#]*float lit = 1\.0;\n#else\n\s*float lit = 1\.0 - castShadow\(\);\n#endif/,
    );
    expect(blocks[1]).toEqual([
      "float insideFade = mix(0.92, 1.0, smoothstep(uFadeStart - 0.10, uFadeStart, vFadeHeight));",
      "gl_FragColor = vec4(col / max(1.0 - through, 0.001), (1.0 - insideFade) * uOpacity * uInto * (1.0 - through));",
      "return;",
    ]);
  });

  it("casts a shadow on the other leg that fades out with the leg's top", () => {
    expect(CASTER_VERTEX_SHADER).toContain("varying float vFadeHeight;");
    // What has faded out altogether is not in the shadow map: neither its depth nor how solid it is.
    for (const shader of [CASTER_FRAGMENT_SHADER, CASTER_COVER_FRAGMENT_SHADER]) {
      expect(shader).toContain("if (vFadeHeight >= uFadeEnd) discard;");
    }
    // How solid the leg is (red) and that it is there (green): no pattern of holes, which showed in the shadow.
    expect(CASTER_COVER_FRAGMENT_SHADER).toContain(
      "gl_FragColor = vec4(1.0 - smoothstep(uFadeStart, uFadeEnd, vFadeHeight), 1.0, 0.0, 1.0);",
    );
    expect(CASTER_FRAGMENT_SHADER).not.toMatch(/gl_FragCoord|smoothstep/);
    // The other leg's shader takes the two together at every point of the map it reads, red over green: read
    // between texels at the leg's edge, where both thin out alike, that is still how solid the leg is there.
    const at = /float castShadowAt\(vec2 at, float ref\) \{([^}]*)\}/.exec(LEG_FRAGMENT_SHADER)![1];
    expect(at).toContain("vec2 cover = texture2D(uCastShadowCover, at).rg;");
    expect(at).toContain("return (1.0 - texture(uCastShadowMap, vec3(at, ref))) * cover.r / max(cover.g, 0.004);");
    const shadow = /float castShadow\(\) \{([^}]*)\}/.exec(LEG_FRAGMENT_SHADER)![1];
    expect(shadow.match(/castShadowAt\(/g)).toHaveLength(5);
    expect(shadow).not.toContain("texture(");
    expect(shadow).toContain("return shadow / 6.0 * uCastShadowStrength;");
    // Half solid at the leg's edge (half of the texels around are the leg's), and half as solid in its fade.
    const solid = (cover: [number, number]) => cover[0] / Math.max(cover[1], 0.004);
    expect(solid([0.5, 0.5])).toBe(1);
    expect(solid([0.25, 0.5])).toBe(0.5);
    expect(solid([0, 0])).toBe(0);
  });
});
