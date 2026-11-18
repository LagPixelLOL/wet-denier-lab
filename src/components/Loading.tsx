import { useStore } from "../state/useStore";
import { ui } from "../state/ui";
import { useT } from "../i18n";

export function Loading() {
  const error = useStore(ui, (s) => s.bootError);
  const t = useT();
  return (
    <div
      id="loading"
      className="pointer-events-none fixed inset-0 grid place-content-center justify-items-center gap-3.5 px-6 text-center text-[13px] text-ink-soft transition-opacity duration-600 ease-[ease] motion-reduce:[transition:none] ready:opacity-0 dim:text-[#fffc]"
    >
      {error === null ? (
        <>
          <span className="size-7.5 animate-spin rounded-[50%] border-2 border-accent-soft border-t-accent motion-reduce:[animation-duration:2.4s]"></span>
          {t("loading.text")}
        </>
      ) : (
        <>
          {t("loading.failed", { error })}
          <br />
          {t("loading.browsers")}
        </>
      )}
    </div>
  );
}
