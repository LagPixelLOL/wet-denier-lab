import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dock } from "../../../src/components/Dock";
import { actions } from "../../../src/engine/app/actions";
import { resetUiTest, setUi } from "./harness";

vi.mock("../../../src/engine/app/actions", async () => (await import("./harness")).mockActionsModule());

afterEach(resetUiTest);

const button = (name: string) => screen.getByRole("button", { name });

describe("Dock touch mode switch", () => {
  it("is a radio group whose checked radio follows the store mode", () => {
    render(<Dock />);
    const group = screen.getByRole("radiogroup", { name: "触控方式" });
    const water = screen.getByRole("radio", { name: "泼水" });
    const view = screen.getByRole("radio", { name: "视角" });
    expect(group).toContainElement(water);
    expect(water).toHaveAttribute("aria-checked", "true");
    expect(view).toHaveAttribute("aria-checked", "false");
    setUi({ mode: "view" });
    expect(water).toHaveAttribute("aria-checked", "false");
    expect(view).toHaveAttribute("aria-checked", "true");
  });

  it("asks for the clicked mode", async () => {
    render(<Dock />);
    await userEvent.click(screen.getByRole("radio", { name: "视角" }));
    expect(actions.setMode).toHaveBeenLastCalledWith("view");
    await userEvent.click(screen.getByRole("radio", { name: "泼水" }));
    expect(actions.setMode).toHaveBeenLastCalledWith("water");
    expect(actions.setMode).toHaveBeenCalledTimes(2);
  });
});

describe("Dock tools", () => {
  it("is labeled as the action bar", () => {
    render(<Dock />);
    expect(screen.getByRole("navigation", { name: "操作" })).toBeInTheDocument();
  });

  it.each([
    ["一捧水", "bucket"],
    ["细雨", "toggleRain"],
    ["慢动作", "toggleSlow"],
    ["擦干", "dry"],
    ["场景", "toggleScenes"],
    ["衣橱", "toggleWardrobe"],
  ] as const)("wires %s to actions.%s", async (name, action) => {
    render(<Dock />);
    await userEvent.click(button(name));
    expect(actions[action]).toHaveBeenCalledTimes(1);
  });

  it("carries the keyboard shortcut badges", () => {
    render(<Dock />);
    expect(["一捧水", "细雨", "慢动作", "擦干", "场景", "衣橱"].map((name) => button(name).dataset.key)).toEqual([
      "空格",
      "R",
      "S",
      "D",
      "C",
      "W",
    ]);
  });

  it("shows the rain label from the store and reflects rain in aria-pressed", () => {
    render(<Dock />);
    const rain = document.querySelector("#rainBtn")!;
    expect(rain).toHaveAttribute("aria-pressed", "false");
    setUi({ rain: true, rainLabel: "花洒" });
    expect(rain).toHaveAttribute("aria-pressed", "true");
    expect(rain).toHaveTextContent("花洒");
  });

  it("reflects slow motion and the open sheets in aria-pressed", () => {
    render(<Dock />);
    const pressed = () => ["慢动作", "场景", "衣橱"].map((name) => button(name).getAttribute("aria-pressed"));
    expect(pressed()).toEqual(["false", "false", "false"]);
    setUi({ slow: true });
    expect(pressed()).toEqual(["true", "false", "false"]);
    setUi({ slow: false, panels: { mat: false, scene: true, about: false } });
    expect(pressed()).toEqual(["false", "true", "false"]);
    setUi({ panels: { mat: true, scene: false, about: false } });
    expect(pressed()).toEqual(["false", "false", "true"]);
  });

  it("leaves the one-shot tools without a pressed state", () => {
    render(<Dock />);
    expect(button("一捧水")).not.toHaveAttribute("aria-pressed");
    expect(button("擦干")).not.toHaveAttribute("aria-pressed");
  });
});
