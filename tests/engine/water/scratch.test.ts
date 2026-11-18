import { it } from "vitest";
import { waterWorld } from "../../helpers/waterWorld";
it("scratch", () => {
  const w = waterWorld();
  const s = w.rig.surface;
  const EYE = [0, 0.5, 1.6];
  const found: Record<string, number> = {};
  for (let i = 0; i < w.rig.pos.length / 3; i += 7) {
    const h = s.closest(w.rig.pos[i*3], w.rig.pos[i*3+1], w.rig.pos[i*3+2], 0.01); if (!h) continue;
    const hit = { ...h };
    if (hit.ry > 0.8 || hit.y < 0.2) continue;
    const n = [hit.nx, hit.ny, hit.nz]; let ts = [EYE[0]-hit.x, EYE[1]-hit.y, EYE[2]-hit.z]; const d = Math.hypot(...ts); ts = ts.map(c => c/d);
    const hp = [hit.x, hit.y, hit.z];
    const lp = (b: number, dist: number, rise: number) => [0,1,2].map(a => hp[a] + (ts[a]*(1-b)+n[a]*b)*dist + (a===1?rise:0));
    const blocked = (p: number[]) => { const dd = Math.hypot(p[0]-hp[0], p[1]-hp[1], p[2]-hp[2]); const r = s.raycast(hp[0]+n[0]*0.004, hp[1]+n[1]*0.004, hp[2]+n[2]*0.004, (p[0]-hp[0])/dd, (p[1]-hp[1])/dd, (p[2]-hp[2])/dd, dd); return r ? r.t : -1; };
    if (blocked(lp(0.3, 0.42, 0.1)) >= 0) {
      const t2 = blocked(lp(0, 0.42, 0.1));
      const key = t2 >= 0 ? "both" : "first";
      if (!(key in found)) found[key] = i;
    }
  }
  console.log("found", JSON.stringify(found));
  // seed search for SoundEngine _rand
  const rand = (st: {seed: number}) => { st.seed = (Math.imul(st.seed, 1664525) + 1013904223) | 0; return (st.seed >>> 8) / 16777216; };
  const st = { seed: 12345 }; const seq = []; for (let k = 0; k < 9; k++) seq.push(rand(st).toFixed(3)); console.log("seq", seq.join(" "));
});
