/**
 * Uniform spatial grid over the deformed collision mesh with closest-point, raycast (Moller-Trumbore)
 * and per-UV-island rectangle queries.
 */
import { closestPointOnTriangle, closestPointOut } from "./closestPoint";

export class SurfaceGrid {
  constructor({ pos: pos, nrm: nrm, uv: uv, idx: idx, ry: restY = null, legTris = Infinity }, cellSize = 0.012) {
    this.pos = pos;
    this.nrm = nrm;
    this.uv = uv;
    this.idx = idx;
    this.ry = restY;
    this.legTris = legTris;
    this.cell = cellSize;
    const triCount = (this.triCount = idx.length / 3);
    this.triC = new Float32Array(triCount * 4);
    this.triUV = new Float32Array(triCount * 4);
    for (let i = 0; i < triCount; i++) {
      const a = idx[i * 3] * 2;
      const b = idx[i * 3 + 1] * 2;
      const c = idx[i * 3 + 2] * 2;
      const o = i * 4;
      this.triUV[o] = Math.min(uv[a], uv[b], uv[c]);
      this.triUV[o + 1] = Math.min(uv[a + 1], uv[b + 1], uv[c + 1]);
      this.triUV[o + 2] = Math.max(uv[a], uv[b], uv[c]);
      this.triUV[o + 3] = Math.max(uv[a + 1], uv[b + 1], uv[c + 1]);
    }
    const parentOf = new Int32Array(pos.length / 3);
    for (let i = 0; i < parentOf.length; i++) {
      parentOf[i] = i;
    }
    const findRoot = (v) => {
      while (parentOf[v] !== v) {
        parentOf[v] = parentOf[parentOf[v]];
        v = parentOf[v];
      }
      return v;
    };
    for (let i = 0; i < triCount; i++) {
      const ra = findRoot(idx[i * 3]);
      const rb = findRoot(idx[i * 3 + 1]);
      const rc = findRoot(idx[i * 3 + 2]);
      parentOf[rb] = ra;
      parentOf[findRoot(rc)] = ra;
    }
    const islandIds = new Map();
    this.triIsland = new Int32Array(triCount);
    for (let i = 0; i < triCount; i++) {
      const root = findRoot(idx[i * 3]);
      if (!islandIds.has(root)) {
        islandIds.set(root, islandIds.size);
      }
      this.triIsland[i] = islandIds.get(root);
    }
    this.islandCount = islandIds.size;
    this.mark = new Int32Array(triCount);
    this.query = 0;
    this.min = [0, 0, 0];
    this.max = [0, 0, 0];
    this.dims = [1, 1, 1];
    this.cellStart = new Int32Array(2);
    this.cellTris = new Int32Array(0);
    this.hit = {
      x: 0,
      y: 0,
      z: 0,
      nx: 0,
      ny: 1,
      nz: 0,
      u: 0,
      v: 0,
      tri: -1,
      dist: Infinity,
      side: 1,
      leg: 0,
      ry: 0,
      t: 0,
    };
    this.rebuild();
  }
  rebuild(activeTris = this.triCount) {
    const pos = this.pos;
    const idx = this.idx;
    const triC = this.triC;
    const cellSize = this.cell;
    this.active = activeTris;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < activeTris; i++) {
      const a = idx[i * 3] * 3;
      const b = idx[i * 3 + 1] * 3;
      const c = idx[i * 3 + 2] * 3;
      const cx = (pos[a] + pos[b] + pos[c]) / 3;
      const cy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
      const cz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
      const radius = Math.sqrt(
        Math.max(
          (pos[a] - cx) ** 2 + (pos[a + 1] - cy) ** 2 + (pos[a + 2] - cz) ** 2,
          (pos[b] - cx) ** 2 + (pos[b + 1] - cy) ** 2 + (pos[b + 2] - cz) ** 2,
          (pos[c] - cx) ** 2 + (pos[c + 1] - cy) ** 2 + (pos[c + 2] - cz) ** 2,
        ),
      );
      const o = i * 4;
      triC[o] = cx;
      triC[o + 1] = cy;
      triC[o + 2] = cz;
      triC[o + 3] = radius;
      if (cx - radius < minX) {
        minX = cx - radius;
      }
      if (cx + radius > maxX) {
        maxX = cx + radius;
      }
      if (cy - radius < minY) {
        minY = cy - radius;
      }
      if (cy + radius > maxY) {
        maxY = cy + radius;
      }
      if (cz - radius < minZ) {
        minZ = cz - radius;
      }
      if (cz + radius > maxZ) {
        maxZ = cz + radius;
      }
    }
    const pad = 0.03;
    this.min[0] = minX - pad;
    this.min[1] = minY - pad;
    this.min[2] = minZ - pad;
    this.max[0] = maxX + pad;
    this.max[1] = maxY + pad;
    this.max[2] = maxZ + pad;
    for (let axis = 0; axis < 3; axis++) {
      this.dims[axis] = Math.max(1, Math.ceil((this.max[axis] - this.min[axis]) / cellSize));
    }
    const nx = this.dims[0];
    const ny = this.dims[1];
    const nz = this.dims[2];
    const cellCount = nx * ny * nz;
    const originX = this.min[0];
    const originY = this.min[1];
    const originZ = this.min[2];
    const invCell = 1 / cellSize;
    const cellCoord = (value, lo, count) => {
      const cell = Math.floor((value - lo) * invCell);
      if (cell < 0) {
        return 0;
      } else if (cell >= count) {
        return count - 1;
      } else {
        return cell;
      }
    };
    const cellStart = cellCount + 1 === this.cellStart.length ? this.cellStart.fill(0) : new Int32Array(cellCount + 1);
    const ranges =
      this._range && this._range.length >= activeTris * 6
        ? this._range
        : (this._range = new Int32Array(this.triCount * 6));
    let totalRefs = 0;
    for (let i = 0; i < activeTris; i++) {
      const a = idx[i * 3] * 3;
      const b = idx[i * 3 + 1] * 3;
      const c = idx[i * 3 + 2] * 3;
      const o = i * 6;
      const x0 = cellCoord(Math.min(pos[a], pos[b], pos[c]) - 0.002, originX, nx);
      const x1 = cellCoord(Math.max(pos[a], pos[b], pos[c]) + 0.002, originX, nx);
      const y0 = cellCoord(Math.min(pos[a + 1], pos[b + 1], pos[c + 1]) - 0.002, originY, ny);
      const y1 = cellCoord(Math.max(pos[a + 1], pos[b + 1], pos[c + 1]) + 0.002, originY, ny);
      const z0 = cellCoord(Math.min(pos[a + 2], pos[b + 2], pos[c + 2]) - 0.002, originZ, nz);
      const z1 = cellCoord(Math.max(pos[a + 2], pos[b + 2], pos[c + 2]) + 0.002, originZ, nz);
      ranges[o] = x0;
      ranges[o + 1] = x1;
      ranges[o + 2] = y0;
      ranges[o + 3] = y1;
      ranges[o + 4] = z0;
      ranges[o + 5] = z1;
      for (let iz = z0; iz <= z1; iz++) {
        for (let iy = y0; iy <= y1; iy++) {
          for (let ix = x0; ix <= x1; ix++) {
            cellStart[ix + nx * (iy + ny * iz) + 1]++;
          }
        }
      }
      totalRefs += (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    }
    for (let i = 0; i < cellCount; i++) {
      cellStart[i + 1] += cellStart[i];
    }
    this.cellStart = cellStart;
    if (this.cellTris.length < totalRefs) {
      this.cellTris = new Int32Array(Math.ceil(totalRefs * 1.2));
    }
    const cursor =
      this._fill2 && this._fill2.length >= cellCount ? this._fill2 : (this._fill2 = new Int32Array(cellCount));
    cursor.set(cellStart.subarray(0, cellCount));
    const cellTris = this.cellTris;
    for (let i = 0; i < activeTris; i++) {
      const o = i * 6;
      for (let iz = ranges[o + 4]; iz <= ranges[o + 5]; iz++) {
        for (let iy = ranges[o + 2]; iy <= ranges[o + 3]; iy++) {
          for (let ix = ranges[o]; ix <= ranges[o + 1]; ix++) {
            cellTris[cursor[ix + nx * (iy + ny * iz)]++] = i;
          }
        }
      }
    }
  }
  _cx(x) {
    const cell = Math.floor((x - this.min[0]) / this.cell);
    const count = this.dims[0];
    if (cell < 0) {
      return 0;
    } else if (cell >= count) {
      return count - 1;
    } else {
      return cell;
    }
  }
  _cy(y) {
    const cell = Math.floor((y - this.min[1]) / this.cell);
    const count = this.dims[1];
    if (cell < 0) {
      return 0;
    } else if (cell >= count) {
      return count - 1;
    } else {
      return cell;
    }
  }
  _cz(z) {
    const cell = Math.floor((z - this.min[2]) / this.cell);
    const count = this.dims[2];
    if (cell < 0) {
      return 0;
    } else if (cell >= count) {
      return count - 1;
    } else {
      return cell;
    }
  }
  inBounds(x, y, z, margin = 0) {
    return (
      x > this.min[0] - margin &&
      x < this.max[0] + margin &&
      y > this.min[1] - margin &&
      y < this.max[1] + margin &&
      z > this.min[2] - margin &&
      z < this.max[2] + margin
    );
  }
  closest(x, y, z, maxDist = 0.02) {
    if (!this.inBounds(x, y, z, maxDist)) {
      return null;
    }
    const queryId = ++this.query;
    const nx = this.dims[0];
    const ny = this.dims[1];
    const x0 = this._cx(x - maxDist);
    const x1 = this._cx(x + maxDist);
    const y0 = this._cy(y - maxDist);
    const y1 = this._cy(y + maxDist);
    const z0 = this._cz(z - maxDist);
    const z1 = this._cz(z + maxDist);
    let bestDistSq = maxDist * maxDist;
    let bestTri = -1;
    let bestWa = 0;
    let bestWb = 0;
    let bestWc = 0;
    const pos = this.pos;
    const idx = this.idx;
    for (let iz = z0; iz <= z1; iz++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let ix = x0; ix <= x1; ix++) {
          const cell = ix + nx * (iy + ny * iz);
          for (let k = this.cellStart[cell], end = this.cellStart[cell + 1]; k < end; k++) {
            const tri = this.cellTris[k];
            if (this.mark[tri] === queryId) {
              continue;
            }
            this.mark[tri] = queryId;
            const o = tri * 4;
            const dx = x - this.triC[o];
            const dy = y - this.triC[o + 1];
            const dz = z - this.triC[o + 2];
            const triRadius = this.triC[o + 3];
            const reach = Math.sqrt(bestDistSq) + triRadius;
            if (dx * dx + dy * dy + dz * dz > reach * reach) {
              continue;
            }
            const a = idx[tri * 3] * 3;
            const b = idx[tri * 3 + 1] * 3;
            const c = idx[tri * 3 + 2] * 3;
            closestPointOnTriangle(
              x,
              y,
              z,
              pos[a],
              pos[a + 1],
              pos[a + 2],
              pos[b],
              pos[b + 1],
              pos[b + 2],
              pos[c],
              pos[c + 1],
              pos[c + 2],
              closestPointOut,
            );
            const qx = closestPointOut[3];
            const qy = closestPointOut[4];
            const qz = closestPointOut[5];
            const distSq = (x - qx) ** 2 + (y - qy) ** 2 + (z - qz) ** 2;
            if (distSq < bestDistSq) {
              bestDistSq = distSq;
              bestTri = tri;
              bestWa = closestPointOut[0];
              bestWb = closestPointOut[1];
              bestWc = closestPointOut[2];
            }
          }
        }
      }
    }
    if (bestTri < 0) {
      return null;
    } else {
      return this._fill(bestTri, bestWa, bestWb, bestWc, x, y, z);
    }
  }
  _fill(tri, wa, wb, wc, px, py, pz) {
    const pos = this.pos;
    const nrm = this.nrm;
    const uv = this.uv;
    const idx = this.idx;
    const a = idx[tri * 3];
    const b = idx[tri * 3 + 1];
    const c = idx[tri * 3 + 2];
    const hit = this.hit;
    hit.x = wa * pos[a * 3] + wb * pos[b * 3] + wc * pos[c * 3];
    hit.y = wa * pos[a * 3 + 1] + wb * pos[b * 3 + 1] + wc * pos[c * 3 + 1];
    hit.z = wa * pos[a * 3 + 2] + wb * pos[b * 3 + 2] + wc * pos[c * 3 + 2];
    const nx = wa * nrm[a * 3] + wb * nrm[b * 3] + wc * nrm[c * 3];
    const ny = wa * nrm[a * 3 + 1] + wb * nrm[b * 3 + 1] + wc * nrm[c * 3 + 1];
    const nz = wa * nrm[a * 3 + 2] + wb * nrm[b * 3 + 2] + wc * nrm[c * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    hit.nx = nx / len;
    hit.ny = ny / len;
    hit.nz = nz / len;
    hit.u = wa * uv[a * 2] + wb * uv[b * 2] + wc * uv[c * 2];
    hit.v = wa * uv[a * 2 + 1] + wb * uv[b * 2 + 1] + wc * uv[c * 2 + 1];
    hit.tri = tri;
    hit.leg = tri < this.legTris ? 0 : 1;
    hit.ry = this.ry ? wa * this.ry[a] + wb * this.ry[b] + wc * this.ry[c] : hit.y;
    const dx = px - hit.x;
    const dy = py - hit.y;
    const dz = pz - hit.z;
    hit.dist = Math.hypot(dx, dy, dz);
    hit.side = dx * hit.nx + dy * hit.ny + dz * hit.nz >= 0 ? 1 : -1;
    return hit;
  }
  raycast(ox, oy, oz, dx, dy, dz, maxT = 10, skipLeg = -1) {
    let tNear = 0;
    let tFar = maxT;
    const rayOrigin = [ox, oy, oz];
    const rayDir = [dx, dy, dz];
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(rayDir[axis]) < 1e-9) {
        if (rayOrigin[axis] < this.min[axis] || rayOrigin[axis] > this.max[axis]) {
          return null;
        }
        continue;
      }
      let t0 = (this.min[axis] - rayOrigin[axis]) / rayDir[axis];
      let t1 = (this.max[axis] - rayOrigin[axis]) / rayDir[axis];
      if (t0 > t1) {
        [t0, t1] = [t1, t0];
      }
      tNear = Math.max(tNear, t0);
      tFar = Math.min(tFar, t1);
      if (tNear > tFar) {
        return null;
      }
    }
    const queryId = ++this.query;
    const stepLen = this.cell * 0.45;
    const pos = this.pos;
    const idx = this.idx;
    const legTris = this.legTris;
    let bestT = Infinity;
    let bestTri = -1;
    let bestU = 0;
    let bestV = 0;
    let lastCell = -1;
    for (let t = tNear; t <= tFar + stepLen && !(t > bestT + this.cell); t += stepLen) {
      const cell =
        this._cx(ox + dx * t) + this.dims[0] * (this._cy(oy + dy * t) + this.dims[1] * this._cz(oz + dz * t));
      if (cell !== lastCell) {
        lastCell = cell;
        for (let k = this.cellStart[cell], end = this.cellStart[cell + 1]; k < end; k++) {
          const tri = this.cellTris[k];
          if (
            this.mark[tri] === queryId ||
            ((this.mark[tri] = queryId), skipLeg >= 0 && (tri < legTris ? 0 : 1) === skipLeg)
          ) {
            continue;
          }
          const a = idx[tri * 3] * 3;
          const b = idx[tri * 3 + 1] * 3;
          const c = idx[tri * 3 + 2] * 3;
          const e1x = pos[b] - pos[a];
          const e1y = pos[b + 1] - pos[a + 1];
          const e1z = pos[b + 2] - pos[a + 2];
          const e2x = pos[c] - pos[a];
          const e2y = pos[c + 1] - pos[a + 1];
          const e2z = pos[c + 2] - pos[a + 2];
          const px = dy * e2z - dz * e2y;
          const py = dz * e2x - dx * e2z;
          const pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-12) {
            continue;
          }
          const invDet = 1 / det;
          const sx = ox - pos[a];
          const sy = oy - pos[a + 1];
          const sz = oz - pos[a + 2];
          const u = (sx * px + sy * py + sz * pz) * invDet;
          if (u < 0 || u > 1) {
            continue;
          }
          const qx = sy * e1z - sz * e1y;
          const qy = sz * e1x - sx * e1z;
          const qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * invDet;
          if (v < 0 || u + v > 1) {
            continue;
          }
          const tHit = (e2x * qx + e2y * qy + e2z * qz) * invDet;
          if (tHit > 0.00001 && tHit < bestT) {
            bestT = tHit;
            bestTri = tri;
            bestU = u;
            bestV = v;
          }
        }
      }
    }
    if (bestTri < 0) {
      return null;
    }
    const hit = this._fill(bestTri, 1 - bestU - bestV, bestU, bestV, ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);
    hit.t = bestT;
    return hit;
  }
  uvRects(x, y, z, radius, out) {
    out.length = 0;
    if (!this.inBounds(x, y, z, radius)) {
      return out;
    }
    const queryId = ++this.query;
    const rectsByIsland = new Map();
    const x0 = this._cx(x - radius);
    const x1 = this._cx(x + radius);
    const y0 = this._cy(y - radius);
    const y1 = this._cy(y + radius);
    const z0 = this._cz(z - radius);
    const z1 = this._cz(z + radius);
    for (let iz = z0; iz <= z1; iz++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let ix = x0; ix <= x1; ix++) {
          const cell = ix + this.dims[0] * (iy + this.dims[1] * iz);
          for (let k = this.cellStart[cell], end = this.cellStart[cell + 1]; k < end; k++) {
            const tri = this.cellTris[k];
            if (this.mark[tri] === queryId) {
              continue;
            }
            this.mark[tri] = queryId;
            const o = tri * 4;
            if (Math.hypot(x - this.triC[o], y - this.triC[o + 1], z - this.triC[o + 2]) > radius + this.triC[o + 3]) {
              continue;
            }
            const island = this.triIsland[tri];
            let rect = rectsByIsland.get(island);
            if (!rect) {
              rect = [Infinity, Infinity, -Infinity, -Infinity];
              rectsByIsland.set(island, rect);
            }
            rect[0] = Math.min(rect[0], this.triUV[o]);
            rect[1] = Math.min(rect[1], this.triUV[o + 1]);
            rect[2] = Math.max(rect[2], this.triUV[o + 2]);
            rect[3] = Math.max(rect[3], this.triUV[o + 3]);
          }
        }
      }
    }
    for (const rect of rectsByIsland.values()) {
      out.push(rect);
    }
    return out;
  }
}
