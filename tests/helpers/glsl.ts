import * as THREE from "three";
import { parse } from "@shaderfrog/glsl-parser";
import { visit } from "@shaderfrog/glsl-parser/ast";
import type { AstNode, Program, TypeSpecifierNode } from "@shaderfrog/glsl-parser/ast";
import preprocess from "@shaderfrog/glsl-parser/preprocessor";

export type ShaderStage = "vertex" | "fragment";

/** What three's WebGLProgram needs to know to build the prefix of a ShaderMaterial. */
export interface PreludeOptions {
  defines?: Record<string, unknown>;
  /** InstancedMesh draws get `#define USE_INSTANCING` (and the instanceMatrix attribute). */
  instancing?: boolean;
}

const PRECISION = [
  "float",
  "int",
  "sampler2D",
  "samplerCube",
  "sampler3D",
  "sampler2DArray",
  "sampler2DShadow",
  "samplerCubeShadow",
  "sampler2DArrayShadow",
  "isampler2D",
  "isampler3D",
  "isamplerCube",
  "isampler2DArray",
  "usampler2D",
  "usampler3D",
  "usamplerCube",
  "usampler2DArray",
]
  .map((type) => `precision highp ${type};`)
  .join("\n");

/** Uniforms and attributes three declares in front of every ShaderMaterial (not part of material.uniforms). */
export const BUILTIN_UNIFORMS = new Set([
  "modelMatrix",
  "modelViewMatrix",
  "projectionMatrix",
  "viewMatrix",
  "normalMatrix",
  "cameraPosition",
  "isOrthographic",
]);

function customDefines(defines: Record<string, unknown> = {}): string {
  return Object.entries(defines)
    .filter(([, value]) => value !== false)
    .map(([name, value]) => `#define ${name} ${String(value)}`)
    .join("\n");
}

/** Equivalent of the WebGL2 prefix three r187 prepends to ShaderMaterial sources. */
export function prelude(stage: ShaderStage, options: PreludeOptions = {}): string {
  const common = [
    PRECISION,
    "#define HIGH_PRECISION",
    "#define SHADER_TYPE ShaderMaterial",
    "#define SHADER_NAME test",
  ];
  if (stage === "vertex") {
    return [
      "#version 300 es",
      "#define attribute in",
      "#define varying out",
      "#define texture2D texture",
      ...common,
      customDefines(options.defines),
      options.instancing ? "#define USE_INSTANCING" : "",
      "uniform mat4 modelMatrix;",
      "uniform mat4 modelViewMatrix;",
      "uniform mat4 projectionMatrix;",
      "uniform mat4 viewMatrix;",
      "uniform mat3 normalMatrix;",
      "uniform vec3 cameraPosition;",
      "uniform bool isOrthographic;",
      "#ifdef USE_INSTANCING",
      "attribute mat4 instanceMatrix;",
      "#endif",
      "attribute vec3 position;",
      "attribute vec3 normal;",
      "attribute vec2 uv;",
      "",
    ].join("\n");
  }
  return [
    "#version 300 es",
    "#define varying in",
    "layout(location = 0) out highp vec4 pc_fragColor;",
    "#define gl_FragColor pc_fragColor",
    "#define gl_FragDepthEXT gl_FragDepth",
    "#define texture2D texture",
    "#define textureCube texture",
    "#define texture2DProj textureProj",
    "#define texture2DLodEXT textureLod",
    "#define texture2DGradEXT textureGrad",
    ...common,
    customDefines(options.defines),
    "uniform mat4 viewMatrix;",
    "uniform vec3 cameraPosition;",
    "uniform bool isOrthographic;",
    "",
  ].join("\n");
}

/** Resolves `#include <chunk>` the way three does (recursively, from THREE.ShaderChunk). */
export function resolveIncludes(source: string): string {
  return source.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_match, name: string) => {
    const chunk = (THREE.ShaderChunk as Record<string, string | undefined>)[name];
    if (chunk === undefined) {
      throw new Error(`Can not resolve #include <${name}>`);
    }
    return resolveIncludes(chunk);
  });
}

/** Full source as the GPU would receive it, with the preprocessor applied (defines and #if resolved). */
export function expandShader(source: string, stage: ShaderStage, options: PreludeOptions = {}): string {
  const full = prelude(stage, options) + resolveIncludes(source);
  // The preprocessor keeps #version / precision / layout lines and evaluates #define and #if.
  return preprocess(full, { preserve: { version: () => true } });
}

const LOCAL_DECLARATION =
  /^(\s*)((?:const\s+)?(?:(?:highp|mediump|lowp)\s+)?(?:float|int|uint|bool|[biu]?vec[234]|mat[234]))\s+([A-Za-z_]\w*\s*(?:[=,[;]).*);\s*$/;

/** Splits at commas that are not nested in parentheses or brackets. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "(" || c === "[") {
      depth++;
    } else if (c === ")" || c === "]") {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

/**
 * Rewrites `float a = 1.0, b = 2.0, c = a * b;` into one declaration per statement. Same meaning in GLSL;
 * works around the parser putting only the first declarator of a list in scope for later initializers.
 * Qualified globals (uniform/in/out) are left alone.
 */
export function splitDeclaratorLists(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const match = LOCAL_DECLARATION.exec(line);
      if (!match) {
        return line;
      }
      const [, indent, type, list] = match;
      const parts = splitTopLevel(list);
      return parts.length > 1 ? parts.map((part) => `${indent}${type} ${part};`).join("\n") : line;
    })
    .join("\n");
}

/** Parses an expanded shader as GLSL ES 3.00; throws on undeclared variables or functions and other warnings. */
export function parseShader(source: string, stage: ShaderStage, options: PreludeOptions = {}): Program {
  return parse(splitDeclaratorLists(expandShader(source, stage, options)), { stage, failOnWarn: true, quiet: true });
}

export interface GlobalVar {
  name: string;
  type: string;
  qualifiers: string[];
}

function typeName(node: TypeSpecifierNode): string {
  const specifier = node.specifier;
  const base =
    specifier.type === "keyword"
      ? specifier.token
      : specifier.type === "identifier" || specifier.type === "type_name"
        ? specifier.identifier
        : "struct";
  return base + (node.quantifier?.length ? "[]" : "");
}

/** Global declarations with a storage qualifier (uniform, in, out, varying, attribute). */
export function globalVars(program: Program): GlobalVar[] {
  const vars: GlobalVar[] = [];
  for (const statement of program.program) {
    if (statement.type !== "declaration_statement") {
      continue;
    }
    const declaration = statement.declaration;
    if (declaration.type !== "declarator_list") {
      continue;
    }
    const qualifiers = (declaration.specified_type.qualifiers ?? []).map((q) =>
      q.type === "keyword" ? q.token : q.type,
    );
    const type = typeName(declaration.specified_type.specifier);
    for (const decl of declaration.declarations) {
      const isArray = decl.quantifier?.length > 0 && !type.endsWith("[]");
      vars.push({ name: decl.identifier.identifier, type: isArray ? type + "[]" : type, qualifiers });
    }
  }
  return vars;
}

export const uniformsOf = (program: Program): GlobalVar[] =>
  globalVars(program).filter((v) => v.qualifiers.includes("uniform"));

export const inputsOf = (program: Program): GlobalVar[] =>
  globalVars(program).filter((v) => v.qualifiers.includes("in"));

export const outputsOf = (program: Program): GlobalVar[] =>
  globalVars(program).filter((v) => v.qualifiers.includes("out"));

/** Names that appear as the target of an assignment (`x = ...`, `x.y += ...`, `x[i] = ...`). */
export function assignedNames(program: Program): Set<string> {
  const names = new Set<string>();
  const root = (node: AstNode): string | null => {
    if (node.type === "identifier") {
      return node.identifier;
    }
    if (node.type === "postfix") {
      return root(node.expression);
    }
    if (node.type === "group") {
      return root(node.expression);
    }
    return null;
  };
  visit(program, {
    assignment: {
      enter: (path) => {
        const name = root(path.node.left);
        if (name) {
          names.add(name);
        }
      },
    },
  });
  return names;
}
