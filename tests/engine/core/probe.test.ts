import { it } from "vitest";
import { modelData, legModel } from "../../helpers/model";
it("probe", () => {
  let t = performance.now();
  const d = modelData();
  console.log("parse", performance.now() - t);
  console.log(d.stocking.positions.length/3, d.stocking.indices.length/3, d.skinTop.positions.length/3, d.skinTop.indices.length/3, d.wrapData?.length, d.stocking.positions.constructor.name, d.stocking.indices.constructor.name, d.wrapData?.constructor.name);
  t = performance.now();
  const m = legModel();
  console.log("build", performance.now() - t);
  console.log(m.collision.pos.length/3, m.collision.idx.length/3, m.stocking.index!.count/3, m.stocking.attributes.position.count, m.stockingLow.index!.count/3, m.skin.attributes.position.count);
});
