import { useEffect, useRef } from "react";
import { actions } from "../engine/app/actions";
import { useStore } from "../state/useStore";
import { ui } from "../state/ui";

/** Shown when the clipboard API is unavailable, so the share link can be copied by hand. */
export function CopyBox() {
  const box = useStore(ui, (s) => s.copyBox);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box?.open && field.current) {
      field.current.focus();
      field.current.select();
    }
  }, [box]);
  if (!box) {
    return null;
  }
  return (
    <div id="copybox" className="copybox" hidden={!box.open}>
      <span>复制下面的链接，别人打开就是这一双、这个姿势和场景：</span>
      <input ref={field} readOnly value={box.url} />
      <button className="pill" onClick={actions.closeCopyBox}>
        好
      </button>
    </div>
  );
}
