/**
 * Cuts a triangle mesh along horizontal planes, so it has rings of vertices at given heights.
 */

/** A vertex attribute: `itemSize` numbers per vertex. */
export interface SliceAttribute {
  array: ArrayLike<number>;
  itemSize: number;
}

export interface SlicedMesh {
  /** The attributes with the new vertices appended; the vertices that were there keep their indices. */
  attributes: Record<string, Float32Array>;
  idx: Uint32Array;
}

/**
 * Cuts every triangle that reaches across one of `heights` (y values) along it. The surface keeps its shape:
 * a new vertex lies on the edge it cuts, with every attribute interpolated along that edge (those named in
 * `unit` are brought back to unit length). An edge is cut the same way from both of its sides, also where its
 * vertices are doubled along a seam, so no cracks open. Triangles keep their order and winding.
 */
export function sliceAtHeights(
  attributes: Record<string, SliceAttribute>,
  indices: ArrayLike<number>,
  heights: readonly number[],
  unit: readonly string[] = [],
): SlicedMesh {
  // Heights are compared as the 32-bit floats positions are stored in, so a vertex put on a plane is on it.
  const planes = Float32Array.from(new Set(heights.map(Math.fround))).sort();
  const names = Object.keys(attributes);
  const position = attributes.position;
  const baseCount = position.array.length / position.itemSize;
  const added: Record<string, number[]> = Object.fromEntries(names.map((name) => [name, []]));
  const addedY: number[] = [];
  let count = baseCount;
  const heightOf = (v: number): number => (v < baseCount ? position.array[v * 3 + 1] : addedY[v - baseCount]);
  /** The first plane above a height. */
  const planeAbove = (height: number): number => {
    let from = 0;
    let to = planes.length;
    while (from < to) {
      const mid = (from + to) >> 1;
      if (planes[mid] > height) {
        to = mid;
      } else {
        from = mid + 1;
      }
    }
    return from;
  };
  const cuts = new Map<number, number>();
  /** The vertex where plane `plane` cuts the edge from `low` up to `high`, which lie on either side of it. */
  const cutEdge = (low: number, high: number, plane: number): number => {
    // Always worked out from the lower end up, so both sides of the edge get the very same vertex.
    const key = (low * 2097152 + high) * 1024 + plane;
    const cached = cuts.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const y = planes[plane];
    const t = (y - heightOf(low)) / (heightOf(high) - heightOf(low));
    for (const name of names) {
      const size = attributes[name].itemSize;
      const out = added[name];
      const start = out.length;
      for (let k = 0; k < size; k++) {
        const from = attributes[name].array[low * size + k];
        out.push(from + t * (attributes[name].array[high * size + k] - from));
      }
      if (unit.includes(name)) {
        const length = Math.hypot(...out.slice(start)) || 1;
        for (let k = start; k < out.length; k++) {
          out[k] /= length;
        }
      }
    }
    added.position[(count - baseCount) * 3 + 1] = y;
    addedY.push(y);
    cuts.set(key, count);
    return count++;
  };
  const out: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]];
    // Bottom, middle and top corner (equal heights stay in the triangle's order).
    const order = [0, 1, 2].sort((i, j) => heightOf(corners[i]) - heightOf(corners[j]) || i - j);
    const [low, mid, high] = order.map((i) => corners[i]);
    const midY = heightOf(mid);
    const first = planeAbove(heightOf(low));
    if (first >= planes.length || planes[first] >= heightOf(high)) {
      out.push(...corners);
      continue;
    }
    // Each plane cuts the long edge (bottom to top) and one of the two short ones, or meets the middle corner.
    // The pieces fill in between the two chains of vertices that go up the triangle's sides.
    const long = [low];
    const short = [low];
    let pastMid = false;
    for (let plane = first; plane < planes.length && planes[plane] < heightOf(high); plane++) {
      long.push(cutEdge(low, high, plane));
      if (!pastMid && planes[plane] >= midY) {
        short.push(mid);
        pastMid = true;
        if (planes[plane] === midY) {
          continue;
        }
      }
      short.push(pastMid ? cutEdge(mid, high, plane) : cutEdge(low, mid, plane));
    }
    if (!pastMid) {
      short.push(mid);
    }
    long.push(high);
    short.push(high);
    // Whether going bottom, middle, top turns the way the triangle's corners do.
    const turns = (order[1] - order[0] + 3) % 3 === 1;
    for (let l = 0, s = 0; l < long.length - 1 || s < short.length - 1;) {
      const stepShort =
        l === long.length - 1 || (s < short.length - 1 && heightOf(short[s + 1]) <= heightOf(long[l + 1]));
      const next = stepShort ? short[s + 1] : long[l + 1];
      if (long[l] !== short[s] && next !== long[l] && next !== short[s]) {
        out.push(long[l], turns ? short[s] : next, turns ? next : short[s]);
      }
      if (stepShort) {
        s++;
      } else {
        l++;
      }
    }
  }
  const result: Record<string, Float32Array> = {};
  for (const name of names) {
    const array = new Float32Array(count * attributes[name].itemSize);
    array.set(attributes[name].array);
    array.set(added[name], baseCount * attributes[name].itemSize);
    result[name] = array;
  }
  return { attributes: result, idx: Uint32Array.from(out) };
}
