import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Program } from "@shaderfrog/glsl-parser/ast";
import { LegRig } from "../../src/engine/rig/LegRig";
import { SCENE_ORDER } from "../../src/engine/stage/scenes";
import * as backdropShaders from "../../src/engine/stage/shaders/backdrop";
import * as bowShaders from "../../src/engine/stage/shaders/bow";
import * as floorShaders from "../../src/engine/stage/shaders/floor";
import * as legShaders from "../../src/engine/stage/shaders/leg";
import * as outlineShaders from "../../src/engine/stage/shaders/outline";
import * as postShaders from "../../src/engine/stage/shaders/post";
import * as dropShaders from "../../src/engine/water/shaders/drops";
import * as wetShaders from "../../src/engine/water/shaders/wet";
import { WaterSim } from "../../src/engine/water/WaterSim";
import { WetMap } from "../../src/engine/water/WetMap";
import { BUILTIN_UNIFORMS, assignedNames, inputsOf, outputsOf, parseShader, uniformsOf } from "./glsl";
import { legModel } from "./model";
import { buildStage } from "./stageFixture";

const SHADER_NAMES = new Map<string, string>();
for (const module of [
  backdropShaders,
  bowShaders,
  floorShaders,
  legShaders,
  outlineShaders,
  postShaders,
  dropShaders,
  wetShaders,
]) {
  for (const [name, value] of Object.entries(module)) {
    if (name.endsWith("_SHADER") && typeof value === "string") {
      // Identical sources exported under two names (the fullscreen and wet-map quads) get both names.
      const short = name.replace(/_SHADER$/, "");
      const known = SHADER_NAMES.get(value);
      SHADER_NAMES.set(value, known ? `${known}=${short}` : short);
    }
  }
}

/** Fragment shader name of a catalog label. */
export const fragmentName = (label: string): string => label.split(" ")[1];

/** A ShaderMaterial found in one of the engine's scenes, with how it is drawn. */
export interface MaterialUse {
  /** "VERTEX_NAME FRAGMENT_NAME [DEFINE=value]" from the exported shader constant names. */
  label: string;
  material: THREE.ShaderMaterial;
  /** Drawn by an InstancedMesh (three adds USE_INSTANCING). */
  instancing: boolean;
  geometries: Set<THREE.BufferGeometry>;
}

function labelOf(material: THREE.ShaderMaterial): string {
  const vs = SHADER_NAMES.get(material.vertexShader) ?? "?";
  const fs = SHADER_NAMES.get(material.fragmentShader) ?? "?";
  const defines = Object.entries(material.defines ?? {}).map(([key, value]) => `${key}=${String(value)}`);
  return [vs, fs, ...defines].join(" ");
}

let catalog: MaterialUse[] | undefined;

/**
 * Every ShaderMaterial the stage, wet map and water simulation draw, gathered from their real scenes
 * (including the private blur and composite scenes, picked up from the fake renderer's render calls).
 */
export function shaderCatalog(): MaterialUse[] {
  if (catalog) {
    return catalog;
  }
  const uses = new Map<THREE.ShaderMaterial, MaterialUse>();
  const collect = (root: THREE.Object3D): void => {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.ShaderMaterial)) {
        return;
      }
      const material = object.material;
      let use = uses.get(material);
      if (!use) {
        use = { label: labelOf(material), material, instancing: false, geometries: new Set() };
        uses.set(material, use);
      }
      use.instancing ||= object instanceof THREE.InstancedMesh;
      use.geometries.add(object.geometry);
    });
  };
  const model = legModel();
  const { renderer, stage } = buildStage();
  const rig = new LegRig(model.collision, stage);
  for (const key of SCENE_ORDER) {
    stage.setScene(key);
    collect(stage.scene);
  }
  collect(stage.shadowScene);
  for (const leg of stage.legs) {
    collect(leg.castScene);
    collect(leg.mirror);
  }
  renderer.reset();
  stage.bakeShadow(true);
  stage.blit(new THREE.Texture(), null);
  for (const call of renderer.ops("render")) {
    collect(call.scene);
  }
  const wetmap = new WetMap(renderer.asRenderer, model.stockingLow, rig.surface, 256, stage.legs);
  collect(wetmap.bakeScene);
  collect(wetmap.quadScene);
  collect(wetmap.stampScene);
  const water = new WaterSim({ surface: rig.surface, wetmap, mobile: false });
  collect(water.scene);
  return (catalog = [...uses.values()]);
}

/** Catalog entries grouped by program label. */
export function programGroups(filter: (label: string) => boolean = () => true): [string, MaterialUse[]][] {
  const groups = new Map<string, MaterialUse[]>();
  for (const use of shaderCatalog()) {
    if (filter(use.label)) {
      groups.set(use.label, [...(groups.get(use.label) ?? []), use]);
    }
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export interface ParsedProgram {
  vertex: Program;
  fragment: Program;
}

const parsed = new Map<string, ParsedProgram>();

/** Both stages parsed with the prefix three would use for this material (memoized per program). */
export function parseUse(use: MaterialUse): ParsedProgram {
  const key = `${use.label} ${use.instancing}`;
  let program = parsed.get(key);
  if (!program) {
    const options = { defines: use.material.defines, instancing: use.instancing };
    program = {
      vertex: parseShader(use.material.vertexShader, "vertex", options),
      fragment: parseShader(use.material.fragmentShader, "fragment", options),
    };
    parsed.set(key, program);
  }
  return program;
}

/** Whether a uniform value can feed a GLSL uniform of this type. */
export function valueFits(type: string, value: unknown): boolean {
  if (type.endsWith("[]")) {
    return Array.isArray(value) && value.every((item) => valueFits(type.slice(0, -2), item));
  }
  switch (type) {
    case "float":
      return typeof value === "number";
    case "vec2":
      return value instanceof THREE.Vector2;
    case "vec3":
      return value instanceof THREE.Vector3 || value instanceof THREE.Color;
    case "vec4":
      return value instanceof THREE.Vector4;
    case "mat3":
      return value instanceof THREE.Matrix3;
    case "mat4":
      return value instanceof THREE.Matrix4;
    case "sampler2D":
      return value === null || value instanceof THREE.Texture;
    case "sampler2DShadow":
      return value === null || value instanceof THREE.DepthTexture;
    default:
      return false;
  }
}

/** Every uniform the shaders declare is in material.uniforms with a value of a fitting type. */
export function expectUniformsWired(use: MaterialUse): void {
  const { vertex, fragment } = parseUse(use);
  const declared = [...uniformsOf(vertex), ...uniformsOf(fragment)].filter((u) => !BUILTIN_UNIFORMS.has(u.name));
  for (const uniform of declared) {
    const entry = use.material.uniforms[uniform.name];
    expect(entry, `${use.label}: uniform ${uniform.name}`).toBeDefined();
    expect(valueFits(uniform.type, entry.value), `${use.label}: ${uniform.type} ${uniform.name}`).toBe(true);
  }
  const vertexTypes = new Map(uniformsOf(vertex).map((u) => [u.name, u.type]));
  for (const uniform of uniformsOf(fragment)) {
    if (vertexTypes.has(uniform.name)) {
      expect(vertexTypes.get(uniform.name), `${use.label}: ${uniform.name} type`).toBe(uniform.type);
    }
  }
}

/** material.uniforms keys no shader stage declares. */
export function unusedUniforms(use: MaterialUse): string[] {
  const { vertex, fragment } = parseUse(use);
  const declared = new Set([...uniformsOf(vertex), ...uniformsOf(fragment)].map((u) => u.name));
  return Object.keys(use.material.uniforms)
    .filter((name) => !declared.has(name))
    .sort();
}

/** Fragment inputs are vertex outputs of the same type; every vertex output and the final color are written. */
export function expectVaryingsMatch(use: MaterialUse): void {
  const { vertex, fragment } = parseUse(use);
  const outs = new Map(outputsOf(vertex).map((v) => [v.name, v.type]));
  for (const input of inputsOf(fragment)) {
    expect(outs.get(input.name), `${use.label}: varying ${input.name}`).toBe(input.type);
  }
  const written = assignedNames(vertex);
  for (const name of outs.keys()) {
    expect(written.has(name), `${use.label}: ${name} is never written`).toBe(true);
  }
  expect(written.has("gl_Position"), `${use.label}: gl_Position`).toBe(true);
  expect(assignedNames(fragment).has("pc_fragColor"), `${use.label}: gl_FragColor`).toBe(true);
}

/** Every vertex attribute the shader actually reads exists on each geometry drawn with the material. */
export function expectAttributesPresent(use: MaterialUse): void {
  const { vertex } = parseUse(use);
  const globals = vertex.scopes[0].bindings;
  // The prefix declares position/normal/uv for every program; a reference beyond the declaration means use.
  const read = inputsOf(vertex)
    .map((v) => v.name)
    .filter((name) => name !== "instanceMatrix" && (globals[name]?.references.length ?? 0) > 1);
  for (const geometry of use.geometries) {
    for (const name of read) {
      expect(geometry.getAttribute(name), `${use.label}: attribute ${name}`).toBeDefined();
    }
  }
}

/**
 * Registers the per-program checks for the catalog entries whose label passes `filter`. Parsing large
 * programs takes about a second each, so callers split the catalog over several files that run in parallel.
 */
export function defineProgramSuite(filter: (label: string) => boolean): void {
  const groups = programGroups(filter);
  it("selects at least one program", () => {
    expect(groups.length).toBeGreaterThan(0);
  });
  describe.each(groups)("%s", (_label, uses) => {
    it("parses as GLSL ES 3.00 with three's ShaderMaterial prefix (no undeclared names)", () => {
      expect(() => parseUse(uses[0])).not.toThrow();
    });
    it("has every declared uniform wired with a fitting value, in every material", () => {
      uses.forEach(expectUniformsWired);
    });
    it("passes varyings from the vertex to the fragment stage", () => {
      expectVaryingsMatch(uses[0]);
    });
    it("reads only attributes the drawn geometries have", () => {
      uses.forEach(expectAttributesPresent);
    });
  });
}

/** Unused uniform keys per program label (one entry per distinct key set). */
export function unusedUniformsByProgram(filter: (label: string) => boolean): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [label, uses] of programGroups(filter)) {
    const sets = new Set(uses.map((use) => unusedUniforms(use).join(",")));
    expect(sets.size, `${label}: materials differ in uniform keys`).toBe(1);
    const unused = unusedUniforms(uses[0]);
    if (unused.length) {
      result[label] = unused;
    }
  }
  return result;
}
