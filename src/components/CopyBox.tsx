import { useEffect, useRef } from "react";
import { actions } from "../engine/app/actions";
import { useStore } from "../state/useStore";
import { ui } from "../state/ui";
import { Pill } from "./Pill";

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
    <div
      id="copybox"
      className="fixed top-1/2 left-1/2 z-30 grid w-[min(420px,calc(100vw-32px))] [transform:translate(-50%,-50%)] gap-2.5 rounded-[18px] border border-line bg-paper p-4 text-[13px] shadow-panel"
      hidden={!box.open}
    >
      <span>复制下面的链接，别人打开就是这一双、这个姿势和场景：</span>
      <input
        ref={field}
        className="w-full rounded-[10px] border border-hairline bg-on-ink px-2.5 py-[9px] text-ink [font:12px/1.3_ui-monospace,Menlo,Consolas,monospace]"
        readOnly
        value={box.url}
      />
      <Pill className="[justify-self:end]" onClick={actions.closeCopyBox}>
        好
      </Pill>
    </div>
  );
}
