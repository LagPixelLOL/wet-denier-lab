import { SceneSheet } from "./sheets/SceneSheet";
import { WardrobeSheet } from "./sheets/WardrobeSheet";

export function SidePanels() {
  return (
    <aside className="side contents roomy:pointer-events-none roomy:fixed roomy:top-[84px] roomy:right-[calc(14px+var(--gutter-r))] roomy:bottom-[22px] roomy:z-4 roomy:flex roomy:w-[344px] roomy:flex-col roomy:gap-3">
      <SceneSheet />
      <WardrobeSheet />
    </aside>
  );
}
