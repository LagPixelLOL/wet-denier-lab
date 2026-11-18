/** FNV-1a hash of the raw bytes of a typed array, as 8 hex digits. Used to pin exact numeric output. */
export function digest(array: ArrayBufferView): string {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Hash of numbers rounded to a number of decimals; for values computed in float64 that may vary in the last bits. */
export function digestRounded(values: ArrayLike<number>, decimals = 6): string {
  const scale = 10 ** decimals;
  const rounded = Float64Array.from(values as ArrayLike<number>, (v) => Math.round(v * scale) / scale);
  return digest(rounded);
}
