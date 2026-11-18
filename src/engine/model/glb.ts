/**
 * Minimal reader for the leg model glTF 2.0 binary: "stocking" and "skinTop" meshes plus the stocking's
 * wrapOffsets accessor referenced from meshes[0].extras.
 */

/** Raw leg model arrays, from either the binary model or the JSON model. */
export interface ModelData {
  stocking: {
    positions: ArrayLike<number>;
    uvs: ArrayLike<number>;
    indices: ArrayLike<number>;
  };
  skinTop: {
    positions: ArrayLike<number>;
    indices: ArrayLike<number>;
  };
  /** Int16 wrap offsets (binary model). */
  wrapData?: ArrayLike<number> | null;
  /** Base64 Int16 wrap offsets (JSON model). */
  wrap?: string;
}

type GlbArray = Int16Array | Uint16Array | Uint32Array | Float32Array;

type GlbArrayConstructor = new (buffer: ArrayBuffer, byteOffset: number, length: number) => GlbArray;

/** The subset of the glTF JSON chunk this reader uses. */
interface GltfJson {
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number }[];
  meshes: {
    name?: string;
    primitives: { attributes: Record<string, number>; indices: number }[];
    extras?: { wrapOffsets?: { accessor: number } };
  }[];
}

export function parseModelGlb(buffer: ArrayBuffer): ModelData {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error("not a glTF 2.0 binary");
  }
  const jsonLength = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))) as GltfJson;
  const binStart = 20 + jsonLength + 8;
  const TYPED_ARRAYS: Record<number, GlbArrayConstructor> = {
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array,
  };
  const COMPONENTS: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
  };
  const readAccessor = (index: number): GlbArray => {
    const accessor = gltf.accessors[index];
    const bufferView = gltf.bufferViews[accessor.bufferView];
    const Type = TYPED_ARRAYS[accessor.componentType];
    const offset = binStart + (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    return new Type(buffer, offset, accessor.count * COMPONENTS[accessor.type]);
  };
  const meshByName = (name: string) => gltf.meshes.find((mesh) => mesh.name === name);
  const stockingMesh = meshByName("stocking")!;
  const stockingPrim = stockingMesh.primitives[0];
  const skinPrim = meshByName("skinTop")!.primitives[0];
  const wrap = stockingMesh.extras?.wrapOffsets;
  return {
    stocking: {
      positions: readAccessor(stockingPrim.attributes.POSITION),
      uvs: readAccessor(stockingPrim.attributes.TEXCOORD_0),
      indices: readAccessor(stockingPrim.indices),
    },
    skinTop: {
      positions: readAccessor(skinPrim.attributes.POSITION),
      indices: readAccessor(skinPrim.indices),
    },
    wrapData: wrap ? readAccessor(wrap.accessor) : null,
  };
}
