import { SceneSheet } from "./sheets/SceneSheet";
import { WardrobeSheet } from "./sheets/WardrobeSheet";

export function SidePanels() {
  return (
    <aside className="side">
      <SceneSheet />
      <WardrobeSheet />
    </aside>
  );
}
