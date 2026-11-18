import type { MouseEvent } from "react";
import { actions } from "../engine/app/actions";
import { useStore } from "../state/useStore";
import { ui } from "../state/ui";
import { Pill, PillLink } from "./Pill";

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
      className="invisible fixed inset-0 z-20 grid grid-rows-[minmax(0,1fr)_auto] justify-items-center gap-3.5 bg-[#3a304a80] px-[18px] pt-[calc(18px+var(--safe-t))] pb-[calc(20px+var(--safe-b))] opacity-0 backdrop-blur-[10px] [transition:opacity_0.25s_ease,visibility_0s_0.25s] motion-reduce:[transition:none] photo-open:visible photo-open:opacity-100 photo-open:[transition:opacity_0.25s_ease]"
      role="dialog"
      aria-label="照片"
      aria-hidden={!photo.open}
      onClick={closeOnBackdrop}
    >
      <figure className="m-0 grid min-h-0 grid-rows-[minmax(0,1fr)_auto] justify-items-center gap-2">
        <img
          id="photoImg"
          className="max-h-full min-h-0 max-w-full rounded-2xl bg-stage shadow-[0_18px_50px_#281c3c66] select-auto [-webkit-touch-callout:default]"
          alt="雨丝截图"
          src={photo.src ?? undefined}
        />
        <figcaption id="photoTip" className="text-[12px] tracking-[0.08em] text-[#ffffffdb]">
          {photo.tip}
        </figcaption>
      </figure>
      <div className="flex gap-2.5">
        <PillLink
          id="photoSave"
          solid
          large
          download="yusi.jpg"
          href={photo.src ?? undefined}
          hidden={photo.saveHidden}
        >
          保存图片
        </PillLink>
        <Pill id="photoShare" large onClick={actions.share}>
          复制这一双的链接
        </Pill>
        <Pill id="photoClose" large onClick={actions.closePhoto}>
          关闭
        </Pill>
      </div>
    </div>
  );
}
