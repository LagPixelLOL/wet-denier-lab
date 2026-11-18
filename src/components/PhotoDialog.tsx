import type { MouseEvent } from "react";
import { actions } from "../engine/app/actions";
import { useStore } from "../state/useStore";
import { ui } from "../state/ui";

const closeOnBackdrop = (ev: MouseEvent) => {
  if (ev.target === ev.currentTarget) {
    actions.closePhoto();
  }
};

export function PhotoDialog() {
  const photo = useStore(ui, (s) => s.photo);
  return (
    <div
      id="photo"
      className="photo"
      role="dialog"
      aria-label="照片"
      aria-hidden={!photo.open}
      onClick={closeOnBackdrop}
    >
      <figure>
        <img id="photoImg" alt="雨丝截图" src={photo.src ?? undefined} />
        <figcaption id="photoTip">{photo.tip}</figcaption>
      </figure>
      <div className="photo-actions">
        <a
          id="photoSave"
          className="pill solid"
          download="yusi.jpg"
          href={photo.src ?? undefined}
          hidden={photo.saveHidden}
        >
          保存图片
        </a>
        <button id="photoShare" className="pill" onClick={actions.share}>
          复制这一双的链接
        </button>
        <button id="photoClose" className="pill" onClick={actions.closePhoto}>
          关闭
        </button>
      </div>
    </div>
  );
}
