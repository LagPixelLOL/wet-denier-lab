import { actions } from "../engine/app/actions";

export function ZoomBar() {
  return (
    <div id="zoombar" className="zoombar">
      <button className="round" id="zoomIn" aria-label="放大" onClick={actions.zoomIn}>
        ＋
      </button>
      <button className="round" id="zoomOut" aria-label="缩小" onClick={actions.zoomOut}>
        −
      </button>
      <button className="round small" id="viewReset" aria-label="复位" onClick={actions.resetView}>
        复位
      </button>
    </div>
  );
}
