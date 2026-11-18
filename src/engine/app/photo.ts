/**
 * Photo capture with watermark and share links.
 */
import { ui } from "../../state/ui";
import { app } from "./runtime";
import { showHint } from "./hud";
import { currentLook } from "./outfit";
import { buzz } from "./splash";
import { lookUrl } from "../share/lookCodec";

export function shareLook() {
  const url = lookUrl(currentLook());
  const onCopied = () => showHint("链接已复制 · 别人打开就是这一双、这个姿势和场景", 3400);
  const showCopyBox = () => ui.set({ copyBox: { url, open: true } });
  try {
    navigator.clipboard.writeText(url).then(onCopied, showCopyBox);
  } catch {
    showCopyBox();
  }
}

export function closeCopyBox() {
  ui.set((s) => ({ copyBox: s.copyBox && { ...s.copyBox, open: false } }));
}

export function showPhoto(show) {
  document.body.classList.toggle("photo-open", show);
  ui.set((s) => ({ photo: { ...s.photo, open: show } }));
}

export function takePhoto() {
  const w = app.canvas.width;
  const h = app.canvas.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.drawImage(app.canvas, 0, 0);
  const scale = Math.min(w, h) / 720;
  const margin = Math.round(scale * 26);
  const dark = document.body.classList.contains("dim");
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = dark ? "rgba(255, 255, 255, 0.92)" : "rgba(47, 40, 56, 0.86)";
  ctx.font = Math.round(scale * 34) + 'px "ZCOOL XiaoWei", "Songti SC", "STSong", "SimSun", serif';
  ctx.fillText("雨丝", margin, h - margin - Math.round(scale * 20));
  ctx.fillStyle = dark ? "rgba(255, 255, 255, 0.74)" : "rgba(92, 82, 108, 0.82)";
  ctx.font = Math.round(scale * 13) + 'px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("WET DENIER LAB  ·  newtonquan-yusi.pages.dev", margin, h - margin);
  const dataUrl = out.toDataURL("image/jpeg", 0.93);
  const inClaude = typeof window.claude !== "undefined";
  const tip = app.isMobile
    ? "长按图片可以保存"
    : inClaude
      ? "在图片上点右键，选「图片另存为」"
      : "点「保存图片」下载，或在图片上点右键另存为";
  ui.set((s) => ({ photo: { ...s.photo, src: dataUrl, saveHidden: inClaude, tip } }));
  showPhoto(true);
  buzz(12);
}
