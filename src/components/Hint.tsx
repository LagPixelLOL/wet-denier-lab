import { useStore } from "../state/useStore";
import { ui } from "../state/ui";
import { useT } from "../i18n";

export function Hint() {
  const hint = useStore(ui, (s) => s.hint);
  const t = useT();
  return (
    <div
      id="hint"
      className={
        "pointer-events-none fixed bottom-[calc(124px+var(--safe-b))] left-[var(--stage-x,50%)] w-max max-w-[calc(100vw-32px)] rounded-[999px] bg-glass-strong px-4 py-[9px] text-center text-[13px] shadow-panel [transition:opacity_.6s_ease,transform_.6s_ease] motion-reduce:[transition:none] wide:bottom-[calc(22px+var(--safe-b))] " +
        (hint.hidden ? "transform-[translate(-50%,8px)] opacity-0" : "transform-[translate(-50%)]")
      }
    >
      {t(hint.key)}
    </div>
  );
}
