import { useState, type CSSProperties, type ReactNode } from "react";
import { THUMB_SIZE } from "../../engine/app/thumbnails";
import { hideScrollbar } from "./styles";

export interface ChipOption {
  value: string;
  label: string;
  /** Renders the chip as a color swatch. */
  swatch?: { color: string; title: string };
}

interface ChipGroupProps {
  group: string;
  options: ChipOption[];
  selected: string | undefined;
  onPick: (value: string) => void;
  swatches?: boolean;
  /** Dims the chips that are not selected (the setting currently has no effect). */
  idle?: boolean;
  children?: ReactNode;
}

const chipBase = "text-[12.5px] [transition:background_0.2s,color_0.2s,border-color_0.2s]";
const swatchShape = "h-[30px] w-[30px] rounded-[50%] border-2 border-on-ink p-0";
const swatchRing = "shadow-[0_0_0_1px_var(--hairline)]";
const swatchRingOn = "shadow-[0_0_0_2px_var(--ink)]";

function chipClass(on: boolean, swatch: boolean, idle: boolean) {
  const look = swatch
    ? `${swatchShape} [background:var(--c)] ${on ? `text-on-ink ${swatchRingOn}` : swatchRing}`
    : `rounded-[999px] border px-[11px] py-1.5 ${on ? "border-ink bg-ink text-on-ink" : "border-hairline bg-chip"}`;
  return `${chipBase} ${look}${idle && !on ? " opacity-45" : ""}`;
}

/** A row of toggle chips; `selected` is the data-v of the active chip. */
export function ChipGroup({ group, options, selected, onPick, swatches, idle, children }: ChipGroupProps) {
  return (
    <div className={swatches ? "flex flex-wrap gap-[9px]" : "flex flex-wrap gap-1.5"} data-key={group}>
      {options.map(({ value, label, swatch }) => {
        const on = selected !== undefined && value === selected;
        return (
          <button
            key={value}
            data-v={value}
            className={chipClass(on, !!swatch, !!idle)}
            style={swatch ? ({ "--c": swatch.color } as CSSProperties) : undefined}
            aria-label={swatch?.title}
            title={swatch?.title}
            onClick={() => onPick(value)}
          >
            {label}
          </button>
        );
      })}
      {children}
    </div>
  );
}

export function LabeledRow({ label, hidden, children }: { label: string; hidden?: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[38px_minmax(0,1fr)] items-center gap-2 hidden-attr:hidden" hidden={hidden}>
      <span className="text-[12px] tracking-[0.06em] text-ink-soft">{label}</span>
      {children}
    </div>
  );
}

interface CardGridProps {
  group: string;
  items: { value: string; label: string }[];
  /** "row" scrolls horizontally (a 4-column grid in the roomy layout); "grid" is always 4 columns. */
  layout: "row" | "grid";
  selected?: string;
  onPick: (value: string) => void;
  /** Receives each card's thumbnail canvas (null on unmount). */
  canvasRef: (value: string, canvas: HTMLCanvasElement | null) => void;
  onCardHover?: (value: string) => void;
  onLeave?: () => void;
}

// In the roomy layout the row is a plain grid inside the wardrobe's scroll area, which keeps the 3px of room for the
// selection ring instead (a ring margin here would stick out of the scroll area and make it scroll both ways).
const cardsRow = `flex gap-2 overflow-x-auto overscroll-contain ${hideScrollbar} -m-[3px] p-[3px] roomy:m-0 roomy:grid roomy:grid-cols-4 roomy:overflow-visible roomy:p-0`;
const cardsGrid = `grid grid-cols-4 gap-2 overflow-visible overscroll-contain ${hideScrollbar} -m-[3px] p-[3px]`;
const canvasBase =
  "block aspect-[3/4] rounded-xl bg-well [transition:box-shadow_0.2s,transform_0.12s] group-active:[transform:scale(0.96)]";
const canvasRow = "w-[78px] short:w-[66px] roomy:w-full";

/** Cards with an offscreen-rendered thumbnail and a caption. */
export function CardGrid({ group, items, layout, selected, onPick, canvasRef, onCardHover, onLeave }: CardGridProps) {
  return (
    <div
      className={layout === "row" ? cardsRow : cardsGrid}
      data-key={group}
      onPointerOver={(ev) => {
        const card = (ev.target as Element).closest<HTMLElement>(".card");
        if (card && ev.pointerType === "mouse" && onCardHover) {
          onCardHover(card.dataset.v!);
        }
      }}
      onPointerLeave={(ev) => {
        if (ev.pointerType === "mouse" && onLeave) {
          onLeave();
        }
      }}
    >
      {items.map(({ value, label }) => {
        const on = value === selected;
        return (
          <button
            key={value}
            className={`card group grid flex-none justify-items-center gap-[5px] p-0 text-[11.5px] whitespace-nowrap ${on ? "font-semibold text-ink-strong" : "text-ink-soft"}`}
            data-v={value}
            onClick={() => onPick(value)}
          >
            <canvas
              className={`${canvasBase} ${layout === "row" ? canvasRow : "w-full"} ${on ? "shadow-[0_0_0_2px_var(--accent)]" : "shadow-[0_0_0_1px_var(--hairline)]"}`}
              width={THUMB_SIZE.w}
              height={THUMB_SIZE.h}
              aria-hidden="true"
              ref={(canvas) => canvasRef(value, canvas)}
            />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface CustomColorSwatchProps {
  label: string;
  /** The current color when it is not one of the palette swatches, otherwise null. */
  custom: string | null;
  onInput: (color: string) => void;
}

/** A color input styled as a swatch. It keeps showing the last custom color after a palette pick. */
export function CustomColorSwatch({ label, custom, onInput }: CustomColorSwatchProps) {
  const [last, setLast] = useState<string | null>(null);
  if (custom !== null && custom !== last) {
    setLast(custom);
  }
  const on = custom !== null;
  return (
    <label
      className={`relative inline-block cursor-pointer ${swatchShape} ${on ? `[background:var(--c)] ${swatchRingOn}` : `[background:var(--c,conic-gradient(#ff8fa8,#ffd38a,#9be0a8,#8fc4ff,#c9a3ff,#ff8fa8))] ${swatchRing}`}`}
      title={label}
      aria-label={label}
      style={last !== null ? ({ "--c": last } as CSSProperties) : undefined}
    >
      <input
        className="absolute inset-0 h-full w-full cursor-pointer p-0 opacity-0 [border:0]"
        type="color"
        defaultValue="#7fb9c9"
        onInput={(ev) => onInput(ev.currentTarget.value)}
      />
    </label>
  );
}
