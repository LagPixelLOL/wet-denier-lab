import { useState, type CSSProperties, type ReactNode } from "react";
import { THUMB_SIZE } from "../../engine/app/thumbnails";

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
  idle?: boolean;
  children?: ReactNode;
}

/** A row of toggle chips; `selected` is the data-v of the active chip. */
export function ChipGroup({ group, options, selected, onPick, swatches, idle, children }: ChipGroupProps) {
  const className = ["chips", swatches && "swatches", idle && "idle"].filter(Boolean).join(" ");
  return (
    <div className={className} data-key={group}>
      {options.map(({ value, label, swatch }) => {
        const on = selected !== undefined && value === selected;
        const classes = [swatch && "swatch", on && "on"].filter(Boolean).join(" ") || undefined;
        return (
          <button
            key={value}
            data-v={value}
            className={classes}
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
    <div className="row" hidden={hidden}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

interface CardGridProps {
  group: string;
  items: { value: string; label: string }[];
  selected?: string;
  onPick: (value: string) => void;
  /** Receives each card's thumbnail canvas (null on unmount). */
  canvasRef: (value: string, canvas: HTMLCanvasElement | null) => void;
  onCardHover?: (value: string) => void;
  onLeave?: () => void;
}

/** Cards with an offscreen-rendered thumbnail and a caption. */
export function CardGrid({ group, items, selected, onPick, canvasRef, onCardHover, onLeave }: CardGridProps) {
  return (
    <div
      className="cards"
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
      {items.map(({ value, label }) => (
        <button
          key={value}
          className={value === selected ? "card on" : "card"}
          data-v={value}
          onClick={() => onPick(value)}
        >
          <canvas
            width={THUMB_SIZE.w}
            height={THUMB_SIZE.h}
            aria-hidden="true"
            ref={(canvas) => canvasRef(value, canvas)}
          />
          <span>{label}</span>
        </button>
      ))}
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
  return (
    <label
      className={custom !== null ? "swatch custom on" : "swatch custom"}
      title={label}
      aria-label={label}
      style={last !== null ? ({ "--c": last } as CSSProperties) : undefined}
    >
      <input type="color" defaultValue="#7fb9c9" onInput={(ev) => onInput(ev.currentTarget.value)} />
    </label>
  );
}
