import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardGrid, ChipGroup, CustomColorSwatch, LabeledRow } from "../../../src/components/sheets/primitives";
import {
  hideScrollbar,
  paneHintClass,
  sceneSheetClass,
  wardrobeSheetClass,
} from "../../../src/components/sheets/styles";
import { chip, chips, isChipDimmed, selectedValues } from "./harness";

afterEach(() => cleanup());

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

describe("ChipGroup", () => {
  it("renders one chip per option and reports picks by value", async () => {
    const onPick = vi.fn();
    render(<ChipGroup group="g" options={OPTIONS} selected="b" onPick={onPick} />);
    expect(chips("g").map((el) => el.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(selectedValues("g")).toEqual(["b"]);
    await userEvent.click(screen.getByRole("button", { name: "Gamma" }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("selects nothing when selected is undefined, even for an empty value", () => {
    render(
      <ChipGroup
        group="g"
        options={[{ value: "", label: "none" }, ...OPTIONS]}
        selected={undefined}
        onPick={vi.fn()}
      />,
    );
    expect(selectedValues("g")).toEqual([]);
  });

  it("dims only the unselected chips when idle", () => {
    const { rerender } = render(<ChipGroup group="g" options={OPTIONS} selected="a" onPick={vi.fn()} idle />);
    expect(
      chips("g")
        .filter(isChipDimmed)
        .map((el) => el.dataset.v),
    ).toEqual(["b", "c"]);
    rerender(<ChipGroup group="g" options={OPTIONS} selected="a" onPick={vi.fn()} />);
    expect(chips("g").filter(isChipDimmed)).toEqual([]);
  });

  it("greys out a single disabled option and ignores clicks on it", async () => {
    const onPick = vi.fn();
    const options = OPTIONS.map((option) => (option.value === "b" ? { ...option, disabled: true } : option));
    render(<ChipGroup group="g" options={options} selected="b" onPick={onPick} />);
    const greyed = chips("g").filter((el) => (el as HTMLButtonElement).disabled);
    expect(greyed.map((el) => el.dataset.v)).toEqual(["b"]);
    expect(greyed[0]).toHaveClass("opacity-35");
    await userEvent.click(greyed[0]);
    expect(onPick).not.toHaveBeenCalled();
    await userEvent.click(chips("g")[2]);
    expect(onPick).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("renders swatch options with their color, title and accessible name", () => {
    render(
      <ChipGroup
        group="s"
        options={[{ value: "red", label: "", swatch: { color: "#ff0000", title: "Red" } }]}
        selected="red"
        onPick={vi.fn()}
        swatches
      />,
    );
    const swatch = screen.getByRole("button", { name: "Red" });
    expect(swatch).toHaveAttribute("title", "Red");
    expect(swatch.style.getPropertyValue("--c")).toBe("#ff0000");
    expect(selectedValues("s")).toEqual(["red"]);
  });

  it("gives plain chips no title, name override or color", () => {
    render(<ChipGroup group="g" options={OPTIONS} selected="a" onPick={vi.fn()} />);
    const plain = chip("g", "a");
    expect(plain).not.toHaveAttribute("title");
    expect(plain).not.toHaveAttribute("aria-label");
    expect(plain).not.toHaveAttribute("style");
  });

  it("appends children after the chips", () => {
    render(
      <ChipGroup group="g" options={OPTIONS} selected="a" onPick={vi.fn()}>
        <i data-testid="extra" />
      </ChipGroup>,
    );
    expect(screen.getByTestId("extra").previousElementSibling).toBe(chip("g", "c"));
  });
});

describe("LabeledRow", () => {
  it("shows the label next to its content and supports hidden", () => {
    const { rerender } = render(
      <LabeledRow label="Row">
        <b>content</b>
      </LabeledRow>,
    );
    const row = screen.getByText("Row").parentElement!;
    expect(row).toContainElement(screen.getByText("content"));
    expect(row).not.toHaveAttribute("hidden");
    rerender(
      <LabeledRow label="Row" hidden>
        <b>content</b>
      </LabeledRow>,
    );
    expect(row).toHaveAttribute("hidden");
  });
});

describe("CardGrid", () => {
  const ITEMS = [
    { value: "x", label: "X" },
    { value: "y", label: "Y" },
  ];

  it("hands each canvas to canvasRef on mount and null on unmount", () => {
    const canvasRef = vi.fn<(value: string, canvas: HTMLCanvasElement | null) => void>();
    const { unmount } = render(
      <CardGrid group="c" layout="grid" items={ITEMS} onPick={vi.fn()} canvasRef={canvasRef} />,
    );
    const canvases = chips("c").map((card) => card.querySelector("canvas"));
    expect(canvasRef.mock.calls).toEqual([
      ["x", canvases[0]],
      ["y", canvases[1]],
    ]);
    canvasRef.mockClear();
    unmount();
    expect(canvasRef.mock.calls).toEqual([
      ["x", null],
      ["y", null],
    ]);
  });

  it("selects nothing without a selected value and reports picks", async () => {
    const onPick = vi.fn();
    render(<CardGrid group="c" layout="row" items={ITEMS} onPick={onPick} canvasRef={vi.fn()} />);
    expect(chips("c").filter((card) => card.classList.contains("font-semibold"))).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Y" }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith("y");
  });

  it("tolerates mouse hover and leave without handlers", async () => {
    render(<CardGrid group="c" layout="grid" items={ITEMS} onPick={vi.fn()} canvasRef={vi.fn()} />);
    await userEvent.hover(chip("c", "x"));
    await userEvent.unhover(chip("c", "x"));
    expect(chip("c", "x")).toBeInTheDocument();
  });

  it("calls the hover and leave handlers for mouse pointers only", () => {
    const onCardHover = vi.fn();
    const onLeave = vi.fn();
    render(
      <CardGrid
        group="c"
        layout="grid"
        items={ITEMS}
        onPick={vi.fn()}
        canvasRef={vi.fn()}
        onCardHover={onCardHover}
        onLeave={onLeave}
      />,
    );
    const card = chip("c", "y");
    fireEvent.pointerOver(card.querySelector("span")!, { pointerType: "mouse" });
    fireEvent.pointerOut(card, { pointerType: "mouse", relatedTarget: document.body });
    fireEvent.pointerOver(card, { pointerType: "touch" });
    fireEvent.pointerOut(card, { pointerType: "touch", relatedTarget: document.body });
    expect(onCardHover.mock.calls).toEqual([["y"]]);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe("CustomColorSwatch", () => {
  const label = () => screen.getByLabelText("Pick", { selector: "label" });

  it("starts with the default input color and no custom color", () => {
    render(<CustomColorSwatch label="Pick" custom={null} onInput={vi.fn()} />);
    expect(label()).toHaveAttribute("title", "Pick");
    expect(label().style.getPropertyValue("--c")).toBe("");
    expect(label().querySelector("input")).toHaveValue("#7fb9c9");
  });

  it("starts showing a custom color passed on mount", () => {
    render(<CustomColorSwatch label="Pick" custom="#101010" onInput={vi.fn()} />);
    expect(label().style.getPropertyValue("--c")).toBe("#101010");
  });

  it("reports each input event value", () => {
    const onInput = vi.fn();
    render(<CustomColorSwatch label="Pick" custom={null} onInput={onInput} />);
    const input = label().querySelector("input")!;
    fireEvent.input(input, { target: { value: "#010203" } });
    fireEvent.input(input, { target: { value: "#040506" } });
    expect(onInput.mock.calls).toEqual([["#010203"], ["#040506"]]);
  });
});

describe("sheet styles", () => {
  // The engine opens sheets by toggling body classes, so each sheet must key off its own panel variant.
  it("build both sheet class lists on the shared base with their own open variant", () => {
    for (const cls of [sceneSheetClass, wardrobeSheetClass]) {
      expect(cls.startsWith("sheet ")).toBe(true);
      expect(cls).not.toMatch(/\s{2}/);
    }
    expect(sceneSheetClass).toContain("scene-open:visible");
    expect(sceneSheetClass).not.toContain("mat-open:");
    expect(wardrobeSheetClass).toContain("mat-open:visible");
    expect(wardrobeSheetClass).not.toContain("scene-open:");
    expect(paneHintClass).toContain("text-ink-soft");
    expect(hideScrollbar).toContain("[scrollbar-width:none]");
  });
});
