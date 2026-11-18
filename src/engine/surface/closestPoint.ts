/**
 * Closest point on a triangle (Ericson, Real-Time Collision Detection 5.1.5).
 */

export const closestPointOut = new Float64Array(6);

export function closestPointOnTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  const emit = (wa, wb, wc) => {
    out[0] = wa;
    out[1] = wb;
    out[2] = wc;
    out[3] = wa * ax + wb * bx + wc * cx;
    out[4] = wa * ay + wb * by + wc * cy;
    out[5] = wa * az + wb * bz + wc * cz;
  };
  if (d1 <= 0 && d2 <= 0) {
    return emit(1, 0, 0);
  }
  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    return emit(0, 1, 0);
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const tAB = d1 / (d1 - d3);
    return emit(1 - tAB, tAB, 0);
  }
  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    return emit(0, 0, 1);
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const tAC = d2 / (d2 - d6);
    return emit(1 - tAC, 0, tAC);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const tBC = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return emit(0, 1 - tBC, tBC);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return emit(1 - v - w, v, w);
}
