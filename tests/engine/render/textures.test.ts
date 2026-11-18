// @vitest-environment jsdom
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDecalAtlas, createKnitTexture, createLogoTexture } from "../../../src/engine/stage/textures";
import { installFakeCanvas } from "../../helpers/fakeCanvas";
import type { FakeCanvasInstall } from "../../helpers/fakeCanvas";
import { FakeRenderer } from "../../helpers/fakeRenderer";

let canvas: FakeCanvasInstall;
const renderer = new FakeRenderer({ maxAnisotropy: 16 }).asRenderer;
const lowAnisotropy = new FakeRenderer({ maxAnisotropy: 2 }).asRenderer;

beforeEach(() => {
  canvas = installFakeCanvas();
});

afterEach(() => {
  canvas.restore();
});

const opNames = (index = 0) => canvas.contexts[index].ops.map((op) => op[0]);

describe("createKnitTexture", () => {
  it("draws a 64x64 two-stroke stitch tile three times over with three widths", () => {
    const texture = createKnitTexture(renderer);
    const image = texture.image as HTMLCanvasElement;
    expect([image.width, image.height]).toEqual([64, 64]);
    const strokes = canvas.contexts[0].ops.filter((op) => op[0] === "stroke");
    expect(strokes).toHaveLength(3 * 3 * 2);
    const widths = canvas.contexts[0].ops.filter((op) => op[0] === "lineWidth=").map((op) => op[1]);
    expect(widths.slice(0, 6)).toEqual([19.2, 19.2, 12.8, 12.8, 4.48, 4.48]);
    expect(opNames().at(-1)).toBe("getImageData");
  });

  it("stores the mean red level of the tile and sets repeat sampling", () => {
    const texture = createKnitTexture(renderer);
    expect(texture).toBeInstanceOf(THREE.CanvasTexture);
    // mean of the fake pixel data derived from the drawing ops
    expect(texture.userData.mean).toMatchInlineSnapshot(`0.504944087009804`);
    expect(texture.userData.mean).toBeGreaterThan(0);
    expect(texture.userData.mean).toBeLessThan(1);
    expect([texture.wrapS, texture.wrapT]).toEqual([THREE.RepeatWrapping, THREE.RepeatWrapping]);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
  });

  it("caps anisotropy at 8 and at the renderer maximum", () => {
    expect(createKnitTexture(renderer).anisotropy).toBe(8);
    expect(createKnitTexture(lowAnisotropy).anisotropy).toBe(2);
  });

  it("draws the pinned tile", () => {
    createKnitTexture(renderer);
    expect(canvas.contexts[0].opsDigest).toMatchInlineSnapshot(`"da07e65f"`);
  });
});

describe("createDecalAtlas", () => {
  it("draws four cells (heart, star, paw, word) into a 512 atlas", () => {
    const texture = createDecalAtlas(renderer);
    const image = texture.image as HTMLCanvasElement;
    expect([image.width, image.height]).toEqual([512, 512]);
    const ops = canvas.contexts[0].ops;
    expect(ops.filter((op) => op[0] === "translate")).toEqual([
      ["translate", 128, 384],
      ["translate", 384, 384],
      ["translate", 128, 128],
      ["translate", 384, 128],
    ]);
    expect(ops.filter((op) => op[0] === "save")).toHaveLength(4);
    expect(ops.filter((op) => op[0] === "restore")).toHaveLength(4);
    expect(ops.filter((op) => op[0] === "bezierCurveTo")).toHaveLength(2);
    // star: 10 points; paw: pad plus four toes
    expect(ops.filter((op) => op[0] === "lineTo")).toHaveLength(10);
    expect(ops.filter((op) => op[0] === "ellipse")).toHaveLength(5);
    expect(ops.filter((op) => op[0] === "fillText")).toEqual([["fillText", "雨丝", 0, 128 * 0.04]]);
    expect(ops.find((op) => op[0] === "font=")?.[1]).toMatch(/^700 105px /);
  });

  it("uses trilinear filtering, linear data and anisotropy up to 4", () => {
    const texture = createDecalAtlas(renderer);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(texture.anisotropy).toBe(4);
    expect(createDecalAtlas(lowAnisotropy).anisotropy).toBe(2);
  });

  it("draws the pinned atlas", () => {
    createDecalAtlas(renderer);
    expect(canvas.contexts[0].opsDigest).toMatchInlineSnapshot(`"56ac8570"`);
  });
});

describe("createLogoTexture", () => {
  it("writes the centered logo line on a 1024x128 canvas", () => {
    const texture = createLogoTexture(renderer);
    const image = texture.image as HTMLCanvasElement;
    expect([image.width, image.height]).toEqual([1024, 128]);
    expect(canvas.contexts[0].ops).toEqual([
      ["fillStyle=", "#fff"],
      ["textAlign=", "center"],
      ["textBaseline=", "middle"],
      ["font=", '300 50px "Helvetica Neue", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'],
      ["letterSpacing=", "12px"],
      ["fillText", "雨丝  ·  NEWTON QUAN", 512, 66],
    ]);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(texture.anisotropy).toBe(8);
  });

  it("skips letter spacing when the context does not support it", () => {
    canvas.restore();
    canvas = installFakeCanvas({ letterSpacing: false });
    createLogoTexture(renderer);
    expect(opNames()).not.toContain("letterSpacing=");
    expect(opNames().at(-1)).toBe("fillText");
  });
});
