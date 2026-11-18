import { actions } from "../../engine/app/actions";
import { thumbCanvases } from "../../engine/app/thumbnails";
import { BACKDROPS, BACKDROP_ORDER, SCENES, SCENE_ORDER, type SceneId } from "../../engine/stage/scenes";
import { useT } from "../../i18n";
import { useStore } from "../../state/useStore";
import { ui } from "../../state/ui";
import { CardGrid, ChipGroup, CustomColorSwatch, LabeledRow } from "./primitives";
import { paneHintClass, sceneSheetClass } from "./styles";

const registerCanvas = (id: string, canvas: HTMLCanvasElement | null) => {
  if (canvas) {
    thumbCanvases.scenes[id] = canvas;
  }
};

/** Scene cards and, in the studio, the backdrop color row. */
export function SceneSheet() {
  const { scene, backdrop } = useStore(ui, (s) => s.scenes);
  const t = useT();
  const customBackdrop = BACKDROPS[backdrop] ? null : backdrop;
  const sceneItems = SCENE_ORDER.map((id) => ({ value: id, label: t(`scene.${id}`) }));
  const backdropOptions = BACKDROP_ORDER.map((id) => ({
    value: id,
    label: "",
    swatch: { color: BACKDROPS[id].bottom, title: t(`backdrop.${id}`) },
  }));
  return (
    <section id="scenes" className={sceneSheetClass} aria-label={t("scenes.label")}>
      <CardGrid
        group="scene"
        layout="grid"
        items={sceneItems}
        selected={scene}
        onPick={actions.scene}
        canvasRef={registerCanvas}
      />
      <LabeledRow label={t("scenes.backdrop")} hidden={scene !== "studio"}>
        <ChipGroup group="backdrop" options={backdropOptions} selected={backdrop} onPick={actions.backdrop} swatches>
          <CustomColorSwatch label={t("scenes.customBackdrop")} custom={customBackdrop} onInput={actions.backdrop} />
        </ChipGroup>
      </LabeledRow>
      <p className={paneHintClass}>{SCENES[scene] ? t(`scene.${scene as SceneId}.hint`) : ""}</p>
    </section>
  );
}
