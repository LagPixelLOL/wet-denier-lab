export function ZoomBar() {
  return (
    <div id="zoombar" className="zoombar">
      <button className="round" id="zoomIn" aria-label="放大">
        ＋
      </button>
      <button className="round" id="zoomOut" aria-label="缩小">
        −
      </button>
      <button className="round small" id="viewReset" aria-label="复位">
        复位
      </button>
    </div>
  );
}
