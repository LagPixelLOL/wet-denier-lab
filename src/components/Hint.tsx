import { useStore } from "../state/useStore";
import { ui } from "../state/ui";

export function Hint() {
  const hint = useStore(ui, (s) => s.hint);
  return (
    <div
      id="hint"
      className={
        "pointer-events-none fixed bottom-[calc(124px+var(--safe-b))] left-[var(--stage-x,50%)] w-max max-w-[calc(100vw-32px)] rounded-[999px] bg-glass-strong px-4 py-[9px] text-center text-[13px] shadow-panel [transition:opacity_.6s_ease,transform_.6s_ease] wide:bottom-[calc(22px+var(--safe-b))] motion-reduce:[transition:none] " +
        (hint.hidden ? "opacity-0 transform-[translate(-50%,8px)]" : "transform-[translate(-50%)]")
      }
    >
      {hint.text}
    </div>
  );
}
