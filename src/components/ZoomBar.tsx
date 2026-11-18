import { actions } from "../engine/app/actions";
import { RoundButton } from "./RoundButton";

export function ZoomBar() {
  return (
    <div
      id="zoombar"
      className="invisible fixed top-1/2 right-(--gutter-r) grid [transform:translate(12px,-50%)] gap-2.5 opacity-0 [transition:opacity_0.25s,transform_0.25s,visibility_0s_0.25s] motion-reduce:[transition:none] view-mode:visible view-mode:[transform:translateY(-50%)] view-mode:opacity-100 view-mode:[transition:opacity_0.25s,transform_0.25s] wide:right-auto wide:left-[calc(var(--inset-l,104px)+2px)]"
    >
      <RoundButton id="zoomIn" aria-label="放大" onClick={actions.zoomIn}>
        ＋
      </RoundButton>
      <RoundButton id="zoomOut" aria-label="缩小" onClick={actions.zoomOut}>
        −
      </RoundButton>
      <RoundButton small id="viewReset" aria-label="复位" onClick={actions.resetView}>
        复位
      </RoundButton>
    </div>
  );
}
