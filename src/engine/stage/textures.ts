/**
 * Procedural canvas textures: knit stitch tile, decal atlas and floor logo.
 */
import * as THREE from "three";

export function createKnitTexture(renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 64, 64);
  ctx.lineCap = "round";
  const drawLine = (x0, y0, x1, y1, width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  for (const offsetY of [-64, 0, 64]) {
    for (const [lineWidth, color] of [
      [19.2, "#7a7a7a"],
      [12.8, "#d6d6d6"],
      [4.48, "#ffffff"],
    ]) {
      drawLine(5.12, offsetY + 1.28, 30.08, offsetY + 58.88, lineWidth, color);
      drawLine(58.88, offsetY + 1.28, 33.92, offsetY + 58.88, lineWidth, color);
    }
  }
  const pixels = ctx.getImageData(0, 0, 64, 64).data;
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += pixels[i];
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.userData.mean = sum / (pixels.length / 4) / 255;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export function createDecalAtlas(renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "#fff";
  const drawCell = (col, row, draw) => {
    ctx.save();
    ctx.translate(col * 256 + 128, (1 - row) * 256 + 128);
    draw(128);
    ctx.restore();
  };
  drawCell(0, 0, (r) => {
    ctx.beginPath();
    ctx.moveTo(0, r * 0.78);
    ctx.bezierCurveTo(-r * 1.25, -r * 0.05, -r * 0.62, -r * 0.95, 0, -r * 0.32);
    ctx.bezierCurveTo(r * 0.62, -r * 0.95, r * 1.25, -r * 0.05, 0, r * 0.78);
    ctx.fill();
  });
  drawCell(1, 0, (r) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const radius = i % 2 ? r * 0.38 : r * 0.9;
      ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    ctx.closePath();
    ctx.fill();
  });
  drawCell(0, 1, (r) => {
    ctx.beginPath();
    ctx.ellipse(0, r * 0.3, r * 0.5, r * 0.4, 0, 0, 7);
    ctx.fill();
    for (const [x, y, rotation] of [
      [-0.56, -0.12, -0.4],
      [-0.2, -0.5, -0.12],
      [0.2, -0.5, 0.12],
      [0.56, -0.12, 0.4],
    ]) {
      ctx.beginPath();
      ctx.ellipse(x * r, y * r, r * 0.17, r * 0.24, rotation, 0, 7);
      ctx.fill();
    }
  });
  drawCell(1, 1, (r) => {
    ctx.font = "700 " + Math.round(r * 0.82) + 'px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("雨丝", 0, r * 0.04);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export function createLogoTexture(renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '300 50px "Helvetica Neue", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = "12px";
  }
  ctx.fillText("雨丝  ·  NEWTON QUAN", 512, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}
