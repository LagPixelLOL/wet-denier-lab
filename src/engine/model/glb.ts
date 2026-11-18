/**
 * Minimal reader for the leg model glTF 2.0 binary: "stocking" and "skinTop" meshes plus the stocking's
 * wrapOffsets accessor referenced from meshes[0].extras.
 */

export function parseModelGlb(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error("not a glTF 2.0 binary");
  }
  const jsonLength = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const binStart = 20 + jsonLength + 8;
  const TYPED_ARRAYS = {
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array,
  };
  const COMPONENTS = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
  };
  const readAccessor = (index) => {
    const accessor = gltf.accessors[index];
    const bufferView = gltf.bufferViews[accessor.bufferView];
    const Type = TYPED_ARRAYS[accessor.componentType];
    const offset = binStart + (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    return new Type(buffer, offset, accessor.count * COMPONENTS[accessor.type]);
  };
  const meshByName = (name) => gltf.meshes.find((mesh) => mesh.name === name);
  const stockingMesh = meshByName("stocking");
  const stockingPrim = stockingMesh.primitives[0];
  const skinPrim = meshByName("skinTop").primitives[0];
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
