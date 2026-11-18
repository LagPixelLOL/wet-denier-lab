export function PhotoDialog() {
  return (
    <div id="photo" className="photo" role="dialog" aria-label="照片" aria-hidden="true">
      <figure>
        <img id="photoImg" alt="雨丝截图" />
        <figcaption id="photoTip">长按图片可以保存</figcaption>
      </figure>
      <div className="photo-actions">
        <a id="photoSave" className="pill solid" download="yusi.jpg">
          保存图片
        </a>
        <button id="photoShare" className="pill">
          复制这一双的链接
        </button>
        <button id="photoClose" className="pill">
          关闭
        </button>
      </div>
    </div>
  );
}
