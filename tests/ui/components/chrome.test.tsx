import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutDialog } from "../../../src/components/AboutDialog";
import { Brand } from "../../../src/components/Brand";
import { CornerBar } from "../../../src/components/CornerBar";
import { Hint } from "../../../src/components/Hint";
import { Loading } from "../../../src/components/Loading";
import { Pill, PillLink } from "../../../src/components/Pill";
import { RoundButton } from "../../../src/components/RoundButton";
import { ZoomBar } from "../../../src/components/ZoomBar";
import { actions } from "../../../src/engine/app/actions";
import { resetUiTest, setUi } from "./harness";

vi.mock("../../../src/engine/app/actions", async () => (await import("./harness")).mockActionsModule());

afterEach(resetUiTest);

describe("Brand", () => {
  it("renders the logo and subtitle in a header", () => {
    render(<Brand />);
    const header = screen.getByRole("banner");
    expect(header).toHaveTextContent("雨丝");
    expect(header).toHaveTextContent("WET DENIER LAB");
  });
});

describe("CornerBar", () => {
  it("requests a photo from the camera button", async () => {
    render(<CornerBar />);
    await userEvent.click(screen.getByRole("button", { name: "拍照" }));
    expect(actions.requestPhoto).toHaveBeenCalledTimes(1);
  });

  it("toggles the about dialog and reflects it in aria-expanded", async () => {
    render(<CornerBar />);
    const about = screen.getByRole("button", { name: "制作说明" });
    expect(about).toHaveAttribute("aria-controls", "about");
    expect(about).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(about);
    expect(actions.toggleAbout).toHaveBeenCalledTimes(1);
    setUi({ panels: { mat: false, scene: false, about: true } });
    expect(about).toHaveAttribute("aria-expanded", "true");
  });

  it("toggles sound and reflects it in aria-pressed", async () => {
    render(<CornerBar />);
    const sound = screen.getByRole("button", { name: "声音" });
    expect(sound).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(sound);
    expect(actions.toggleSound).toHaveBeenCalledTimes(1);
    setUi({ soundOn: false });
    expect(sound).toHaveAttribute("aria-pressed", "false");
  });

  it("draws both the wave and the mute glyph so CSS can pick one", () => {
    render(<CornerBar />);
    const sound = screen.getByRole("button", { name: "声音" });
    expect(sound.querySelector(".wave")).not.toBeNull();
    expect(sound.querySelector(".mute")).not.toBeNull();
  });
});

describe("AboutDialog", () => {
  it("is aria-hidden while closed and visible to assistive tech when open", () => {
    render(<AboutDialog />);
    const dialog = document.querySelector("#about")!;
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-hidden", "true");
    setUi({ panels: { mat: false, scene: false, about: true } });
    expect(dialog).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByRole("dialog", { name: "制作说明" })).toBe(dialog);
  });

  it("closes through the close button", async () => {
    setUi({ panels: { mat: false, scene: false, about: true } });
    render(<AboutDialog />);
    await userEvent.click(screen.getByRole("button", { name: "关闭说明" }));
    expect(actions.closeAbout).toHaveBeenCalledTimes(1);
  });

  it("opens the license link in a new tab without an opener", () => {
    setUi({ panels: { mat: false, scene: false, about: true } });
    render(<AboutDialog />);
    const link = screen.getByRole("link", { name: "CC BY 3.0" });
    expect(link).toHaveAttribute("href", "https://creativecommons.org/licenses/by/3.0/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });
});

describe("Hint", () => {
  it("shows the hint text from the store and follows updates", () => {
    const { container } = render(<Hint />);
    const hint = container.querySelector("#hint")!;
    expect(hint).toHaveTextContent("点丝袜任意位置泼水");
    setUi({ hint: { text: "慢动作 0.2×", hidden: false } });
    expect(hint).toHaveTextContent("慢动作 0.2×");
  });

  it("fades out when hidden but keeps its text", () => {
    const { container } = render(<Hint />);
    const hint = container.querySelector("#hint")!;
    // The hidden state is only expressed through the fade classes.
    expect(hint).not.toHaveClass("opacity-0");
    setUi({ hint: { text: "bye", hidden: true } });
    expect(hint).toHaveClass("opacity-0");
    expect(hint).toHaveTextContent("bye");
    setUi({ hint: { text: "back", hidden: false } });
    expect(hint).not.toHaveClass("opacity-0");
  });
});

describe("Loading", () => {
  it("shows a spinner and the preparing message before any error", () => {
    const { container } = render(<Loading />);
    const loading = container.querySelector("#loading")!;
    expect(loading).toHaveTextContent("正在准备丝袜与水…");
    expect(loading.querySelector(".animate-spin")).not.toBeNull();
  });

  it("replaces the spinner with the boot error and a browser suggestion", () => {
    const { container } = render(<Loading />);
    setUi({ bootError: "WebGL is not available" });
    const loading = container.querySelector("#loading")!;
    expect(loading).toHaveTextContent("三维画面启动失败：WebGL is not available");
    expect(loading).toHaveTextContent("请用最新版 Chrome / Safari / Edge 打开");
    expect(loading).not.toHaveTextContent("正在准备丝袜与水");
    expect(loading.querySelector(".animate-spin")).toBeNull();
  });

  it("renders an empty error message as an error, not as loading", () => {
    const { container } = render(<Loading />);
    setUi({ bootError: "" });
    expect(container.querySelector("#loading")).toHaveTextContent("三维画面启动失败：");
  });
});

describe("ZoomBar", () => {
  it.each([
    ["放大", "zoomIn"],
    ["缩小", "zoomOut"],
    ["复位", "resetView"],
  ] as const)("wires %s to actions.%s", async (name, action) => {
    render(<ZoomBar />);
    await userEvent.click(screen.getByRole("button", { name }));
    expect(actions[action]).toHaveBeenCalledTimes(1);
  });
});

describe("Pill", () => {
  it("renders a button that forwards props and appends the class name", async () => {
    const onClick = vi.fn();
    render(
      <Pill id="p" className="extra" title="tip" onClick={onClick}>
        ok
      </Pill>,
    );
    const button = screen.getByRole("button", { name: "ok" });
    expect(button).toHaveAttribute("id", "p");
    expect(button).toHaveAttribute("title", "tip");
    expect(button).toHaveClass("extra");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not leak the style flags as DOM attributes", () => {
    render(
      <Pill solid large>
        big
      </Pill>,
    );
    const button = screen.getByRole("button", { name: "big" });
    expect(button).not.toHaveAttribute("solid");
    expect(button).not.toHaveAttribute("large");
    expect(button.className).not.toContain("undefined");
  });

  it("renders a link variant with the anchor attributes", () => {
    render(
      <PillLink href="blob:x" download="a.jpg" hidden>
        save
      </PillLink>,
    );
    const link = screen.getByText("save");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "blob:x");
    expect(link).toHaveAttribute("download", "a.jpg");
    expect(link).toHaveAttribute("hidden");
  });
});

describe("RoundButton", () => {
  it("forwards props and the click handler", async () => {
    const onClick = vi.fn();
    render(
      <RoundButton small aria-label="r" aria-pressed={false} onClick={onClick}>
        x
      </RoundButton>,
    );
    const button = screen.getByRole("button", { name: "r" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).not.toHaveAttribute("small");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
