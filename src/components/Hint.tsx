import { useStore } from "../state/useStore";
import { ui } from "../state/ui";

export function Hint() {
  const hint = useStore(ui, (s) => s.hint);
  return (
    <div id="hint" className={hint.hidden ? "hint hide" : "hint"}>
      {hint.text}
    </div>
  );
}
