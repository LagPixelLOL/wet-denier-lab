import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyBox } from "../../../src/components/CopyBox";
import { PhotoDialog } from "../../../src/components/PhotoDialog";
import { actions } from "../../../src/engine/app/actions";
import { initialUiState } from "../../../src/state/ui";
import { resetUiTest, setUi } from "./harness";

vi.mock("../../../src/engine/app/actions", async () => (await import("./harness")).mockActionsModule());

afterEach(resetUiTest);

const PHOTO_URL = "blob:http://localhost/photo-1";
const openPhoto = (patch: Partial<typeof initialUiState.photo> = {}) =>
  setUi({ photo: { open: true, src: PHOTO_URL, tip: "长按图片可以保存", saveHidden: false, ...patch } });

// aria-hidden removes the name from the accessibility tree, so look the dialog up by id.
const dialog = () => document.querySelector<HTMLElement>("#photo")!;

describe("PhotoDialog", () => {
  it("is aria-hidden and has no image source while closed", () => {
    render(<PhotoDialog />);
    expect(dialog()).toHaveAttribute("role", "dialog");
    expect(dialog()).toHaveAttribute("aria-hidden", "true");
    const img = screen.getByAltText("雨丝截图");
    expect(img).not.toHaveAttribute("src");
    expect(document.querySelector("#photoSave")).not.toHaveAttribute("href");
  });

  it("shows the photo, its tip and a download link when open", () => {
    render(<PhotoDialog />);
    openPhoto({ tip: "点保存图片" });
    expect(dialog()).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByRole("dialog", { name: "照片" })).toBe(dialog());
    expect(screen.getByAltText("雨丝截图")).toHaveAttribute("src", PHOTO_URL);
    expect(screen.getByText("点保存图片")).toHaveAttribute("id", "photoTip");
    const save = screen.getByRole("link", { name: "保存图片" });
    expect(save).toHaveAttribute("href", PHOTO_URL);
    expect(save).toHaveAttribute("download", "yusi.jpg");
    expect(save).not.toHaveAttribute("hidden");
  });

  it("hides the save link when saveHidden is set", () => {
    render(<PhotoDialog />);
    openPhoto({ saveHidden: true });
    const save = document.querySelector("#photoSave")!;
    expect(save).toHaveAttribute("hidden");
    expect(screen.queryByRole("link", { name: "保存图片" })).toBeNull();
  });

  it("closes when the backdrop itself is clicked", () => {
    render(<PhotoDialog />);
    openPhoto();
    fireEvent.click(dialog());
    expect(actions.closePhoto).toHaveBeenCalledTimes(1);
  });

  it("does not close on clicks inside the dialog content", async () => {
    render(<PhotoDialog />);
    openPhoto();
    await userEvent.click(screen.getByAltText("雨丝截图"));
    await userEvent.click(screen.getByText("长按图片可以保存"));
    await userEvent.click(document.querySelector("#photoSave")!.parentElement!);
    expect(actions.closePhoto).not.toHaveBeenCalled();
  });

  it("shares the look from the share button without closing", async () => {
    render(<PhotoDialog />);
    openPhoto();
    await userEvent.click(screen.getByRole("button", { name: "复制这一双的链接" }));
    expect(actions.share).toHaveBeenCalledTimes(1);
    expect(actions.closePhoto).not.toHaveBeenCalled();
  });

  it("closes exactly once from the close button", async () => {
    render(<PhotoDialog />);
    openPhoto();
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(actions.closePhoto).toHaveBeenCalledTimes(1);
  });
});

describe("CopyBox", () => {
  const URL_TEXT = "https://example.test/#look=abc123";

  it("renders nothing until a copy box is requested", () => {
    const { container } = render(<CopyBox />);
    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector("#copybox")).toBeNull();
  });

  it("shows the url in a read-only field, focused and fully selected", () => {
    render(<CopyBox />);
    setUi({ copyBox: { url: URL_TEXT, open: true } });
    const field = screen.getByRole<HTMLInputElement>("textbox");
    expect(document.querySelector("#copybox")).not.toHaveAttribute("hidden");
    expect(field).toHaveValue(URL_TEXT);
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(URL_TEXT.length);
  });

  it("stays mounted but hidden, without stealing focus, when closed", () => {
    render(<CopyBox />);
    setUi({ copyBox: { url: URL_TEXT, open: false } });
    const box = document.querySelector("#copybox")!;
    expect(box).toHaveAttribute("hidden");
    expect(box.querySelector("input")).not.toHaveFocus();
  });

  it("focuses and selects again when reopened", () => {
    render(<CopyBox />);
    setUi({ copyBox: { url: URL_TEXT, open: true } });
    const field = document.querySelector<HTMLInputElement>("#copybox input")!;
    field.blur();
    setUi({ copyBox: { url: URL_TEXT, open: false } });
    expect(field).not.toHaveFocus();
    setUi({ copyBox: { url: URL_TEXT + "x", open: true } });
    expect(field).toHaveFocus();
    expect(field.selectionEnd).toBe(URL_TEXT.length + 1);
  });

  it("closes through the action", async () => {
    render(<CopyBox />);
    setUi({ copyBox: { url: URL_TEXT, open: true } });
    await userEvent.click(screen.getByRole("button", { name: "好" }));
    expect(actions.closeCopyBox).toHaveBeenCalledTimes(1);
  });
});
