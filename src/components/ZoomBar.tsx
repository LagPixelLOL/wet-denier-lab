import { actions } from "../engine/app/actions";
import { RoundButton } from "./RoundButton";
import { useT } from "../i18n";

export function ZoomBar() {
  const t = useT();
  return (
    <div
      id="zoombar"
      className="invisible fixed top-1/2 right-(--gutter-r) grid [transform:translate(12px,-50%)] gap-2.5 opacity-0 [transition:opacity_0.25s,transform_0.25s,visibility_0s_0.25s] motion-reduce:[transition:none] view-mode:visible view-mode:[transform:translateY(-50%)] view-mode:opacity-100 view-mode:[transition:opacity_0.25s,transform_0.25s] wide:right-auto wide:left-[calc(var(--inset-l,104px)+2px)]"
    >
      <RoundButton id="zoomIn" aria-label={t("zoom.in")} onClick={actions.zoomIn}>
        +
      </RoundButton>
      <RoundButton id="zoomOut" aria-label={t("zoom.out")} onClick={actions.zoomOut}>
        -
      </RoundButton>
      <RoundButton small id="viewReset" onClick={actions.resetView}>
        {t("zoom.reset")}
      </RoundButton>
    </div>
  );
}
