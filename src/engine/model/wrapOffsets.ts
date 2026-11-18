/**
 * Per-vertex fit data that pulls the stocking onto the leg: Int16 xyz offsets plus a packed gap/nail value.
 */

const WRAP_UNIT = 0.00001;

/** Node's Buffer, only reached when atob is missing (non-browser runtimes). */
declare const Buffer: {
  from(data: string, encoding: "base64"): { toString(encoding: "binary"): string };
};

export function decodeBase64Int16(b64: string): Int16Array {
  const binary = typeof atob == "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

/** Stocking positions moved onto the leg, plus per-vertex (gap, nail) pairs. */
export interface WrappedPositions {
  pos: Float32Array;
  gapNail: Float32Array;
}

export function applyWrapOffsets(positions: ArrayLike<number>, wrapData: ArrayLike<number> | null): WrappedPositions {
  const vertexCount = positions.length / 3;
  const gapNail = new Float32Array(vertexCount * 2);
  const pos = new Float32Array(positions);
  if (!wrapData) {
    return {
      pos: pos,
      gapNail: gapNail,
    };
  }
  const count = Math.min(vertexCount, wrapData.length / 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] += wrapData[i * 4] * WRAP_UNIT;
    pos[i * 3 + 1] += wrapData[i * 4 + 1] * WRAP_UNIT;
    pos[i * 3 + 2] += wrapData[i * 4 + 2] * WRAP_UNIT;
    const packed = wrapData[i * 4 + 3];
    gapNail[i * 2] = (packed >> 4) * 2 * WRAP_UNIT;
    gapNail[i * 2 + 1] = (packed & 15) / 15;
  }
  return {
    pos: pos,
    gapNail: gapNail,
  };
}
