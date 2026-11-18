/** Tailwind class lists shared by the two sheets. Class names must stay literal so Tailwind can find them. */

const sheetBase = [
  "sheet fixed bottom-[calc(98px+var(--safe-b))] left-1/2 grid w-[min(430px,calc(100vw-var(--gutter-l)-var(--gutter-r)))]",
  "rounded-[20px] border border-line bg-glass-strong px-3.5 py-3 opacity-0 shadow-panel backdrop-blur-[18px] invisible",
  "[transform:translate(-50%,12px)] [transition:opacity_0.25s_ease,transform_0.25s_ease,visibility_0s_0.25s]",
  "motion-reduce:[transition:none]",
  "wide:top-[calc(68px+var(--safe-t))] wide:right-(--gutter-r) wide:bottom-auto wide:left-auto wide:w-[min(336px,46vw)]",
  "wide:max-h-[calc(100dvh-80px-var(--safe-t))] wide:overflow-y-auto wide:overscroll-contain wide:[transform:translate(14px)]",
  "short:top-[calc(60px+var(--safe-t))] short:max-h-[calc(100dvh-68px-var(--safe-t))]",
  "roomy:pointer-events-auto roomy:static roomy:hidden roomy:max-h-none roomy:w-auto roomy:overflow-visible roomy:opacity-100",
  "roomy:visible roomy:[transform:none] roomy:[transition:none]",
].join(" ");

export const sceneSheetClass = [
  sheetBase,
  "gap-2.5",
  "scene-open:opacity-100 scene-open:visible scene-open:[transform:translate(-50%)] scene-open:[transition:opacity_0.25s_ease,transform_0.25s_ease]",
  "wide-scene-open:[transform:none]",
  "roomy-scene-open:grid roomy-scene-open:flex-none roomy-scene-open:[transition:opacity_0.25s_ease,transform_0.25s_ease]",
].join(" ");

export const wardrobeSheetClass = [
  sheetBase,
  "gap-2",
  "mat-open:opacity-100 mat-open:visible mat-open:[transform:translate(-50%)] mat-open:[transition:opacity_0.25s_ease,transform_0.25s_ease]",
  "wide-mat-open:[transform:none]",
  "roomy-mat-open:grid roomy-mat-open:min-h-0 roomy-mat-open:flex-[0_1_auto] roomy-mat-open:grid-rows-[auto_minmax(0,1fr)_auto]",
  "roomy-mat-open:[transition:opacity_0.25s_ease,transform_0.25s_ease]",
].join(" ");

export const paneHintClass = "m-0 text-[12px] leading-[1.5] text-pretty text-ink-soft";

export const hideScrollbar = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
