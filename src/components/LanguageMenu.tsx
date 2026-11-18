import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LOCALES, useT, type Locale } from "../i18n";
import { useStore } from "../state/useStore";
import { ui } from "../state/ui";
import { GlobeIcon } from "./icons";
import { RoundButton } from "./RoundButton";

/** Globe button with a dropdown of the supported languages, each named in its own language. */
export function LanguageMenu() {
  const locale = useStore(ui, (s) => s.locale);
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];

  useEffect(() => {
    if (!open) {
      return;
    }
    items()
      .find((item) => item.getAttribute("aria-checked") === "true")
      ?.focus();
    const closeOutside = (ev: PointerEvent) => {
      if (!root.current?.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const choose = (id: Locale) => {
    ui.set({ locale: id });
    close();
  };
  // Handled here so Escape and the arrow keys do not also reach the app's own shortcuts.
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      ev.stopPropagation();
      const list = items();
      const index = list.indexOf(document.activeElement as HTMLElement);
      const step = ev.key === "ArrowDown" ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
    }
  };

  return (
    <div ref={root} className="relative" onKeyDown={open ? onKeyDown : undefined}>
      <RoundButton
        ref={button}
        id="langBtn"
        aria-label={t("language.menu")}
        title={t("language.menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="langMenu"
        onClick={() => setOpen(!open)}
      >
        <GlobeIcon />
      </RoundButton>
      <div
        id="langMenu"
        className="absolute top-[calc(100%+8px)] right-0 z-8 grid min-w-[136px] gap-0.5 rounded-2xl border border-line bg-paper p-1.5 shadow-panel backdrop-blur-[20px] hidden-attr:hidden"
        role="menu"
        aria-label={t("language.menu")}
        hidden={!open}
      >
        {LOCALES.map(({ id, name }) => {
          const on = id === locale;
          return (
            <button
              key={id}
              role="menuitemradio"
              aria-checked={on}
              lang={id}
              data-locale={id}
              className={`rounded-[10px] px-3 py-2 text-left text-[13px] whitespace-nowrap [transition:background_0.2s] ${on ? "bg-accent-soft font-semibold text-accent-deep" : "text-ink hover:bg-well"}`}
              onClick={() => choose(id)}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
