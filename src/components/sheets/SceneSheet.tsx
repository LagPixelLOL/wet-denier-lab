import { actions } from "../../engine/app/actions";
import { thumbCanvases } from "../../engine/app/thumbnails";
import { BACKDROPS, BACKDROP_ORDER, SCENES, SCENE_ORDER } from "../../engine/stage/scenes";
import { useStore } from "../../state/useStore";
import { ui } from "../../state/ui";
import { CardGrid, ChipGroup, CustomColorSwatch, LabeledRow } from "./primitives";

const SCENE_HINTS: Record<string, string> = {
  studio: "影棚：干净的纸背景，底色可以换，适合拍照。",
  bath: "浴室：「细雨」在这里是头顶的花洒，湿地砖会映出腿的倒影。",
  street: "夜雨街头：这里一直下着雨，霓虹的光勾在丝袜上，也映在路面上。",
  pool: "泳池边：太阳底下，水面的波光会晃到腿上。",
};

const sceneItems = SCENE_ORDER.map((id) => ({ value: id, label: SCENES[id].label }));
const backdropOptions = BACKDROP_ORDER.map((id) => ({
  value: id,
  label: "",
  swatch: { color: BACKDROPS[id].bottom, title: BACKDROPS[id].label },
}));

const registerCanvas = (id: string, canvas: HTMLCanvasElement | null) => {
  if (canvas) {
    thumbCanvases.scenes[id] = canvas;
  }
};

/** Scene cards and, in the studio, the backdrop color row. */
export function SceneSheet() {
  const { scene, backdrop } = useStore(ui, (s) => s.scenes);
  const customBackdrop = BACKDROPS[backdrop] ? null : backdrop;
  return (
    <section id="scenes" className="sheet scenes" aria-label="场景">
      <CardGrid group="scene" items={sceneItems} selected={scene} onPick={actions.scene} canvasRef={registerCanvas} />
      <LabeledRow label="底色" hidden={scene !== "studio"}>
        <ChipGroup group="backdrop" options={backdropOptions} selected={backdrop} onPick={actions.backdrop} swatches>
          <CustomColorSwatch label="自选底色" custom={customBackdrop} onInput={actions.backdrop} />
        </ChipGroup>
      </LabeledRow>
      <p className="pane-hint">{SCENE_HINTS[scene] || ""}</p>
    </section>
  );
}
