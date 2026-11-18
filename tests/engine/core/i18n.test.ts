import { describe, expect, it } from "vitest";
import { COLOR_ORDER } from "../../../src/engine/catalog/colors";
import {
  CUFF_STYLE_ORDER,
  MATERIAL_ORDER,
  PATTERN_ORDER,
  SECRET_DECAL_ORDER,
  STOCKING_LENGTH_ORDER,
} from "../../../src/engine/catalog/garments";
import { PRESETS } from "../../../src/engine/catalog/presets";
import { POSE_ORDER } from "../../../src/engine/rig/poses";
import { BACKDROP_ORDER, SCENE_ORDER } from "../../../src/engine/stage/scenes";
import { DEFAULT_LOCALE, detectLocale, LOCALES, translate, type MessageKey } from "../../../src/i18n";
import { enUS } from "../../../src/i18n/messages/en-US";
import { zhCN } from "../../../src/i18n/messages/zh-CN";

const MESSAGES = { "zh-CN": zhCN, "en-US": enUS } as const;
const KEYS = Object.keys(zhCN) as MessageKey[];
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("detectLocale", () => {
  it.each([
    [["zh-CN"], "zh-CN"],
    [["zh"], "zh-CN"],
    [["zh-TW", "en-US"], "zh-CN"],
    [["ZH_cn"], "zh-CN"],
    [["en-GB"], "en-US"],
    [["en"], "en-US"],
    [["ja-JP", "zh-CN", "en"], "zh-CN"],
    [["fr-FR", "en-US", "zh-CN"], "en-US"],
  ])("picks the first supported language in %j", (languages, expected) => {
    expect(detectLocale(languages)).toBe(expected);
  });

  it("falls back to English when no language is supported", () => {
    expect(detectLocale(["ja-JP", "ko"])).toBe("en-US");
    expect(detectLocale([])).toBe("en-US");
  });

  it("starts in the locale the app was written in and lists each locale under its own name", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
    expect(LOCALES).toEqual([
      { id: "zh-CN", name: "简体中文" },
      { id: "en-US", name: "English" },
    ]);
  });
});

describe("translate", () => {
  it("looks up the message in the given locale", () => {
    expect(translate("zh-CN", "dock.wardrobe")).toBe("衣橱");
    expect(translate("en-US", "dock.wardrobe")).toBe("Wardrobe");
  });

  it("fills in parameters and leaves unknown placeholders alone", () => {
    expect(translate("en-US", "loading.failed", { error: "no WebGL" })).toBe("The 3D view failed to start: no WebGL");
    expect(translate("zh-CN", "wardrobe.materialHint", { label: "薄丝", hint: "遇水变透" })).toBe("薄丝: 遇水变透。");
    expect(translate("en-US", "loading.failed", {})).toBe("The 3D view failed to start: {error}");
  });
});

describe("message tables", () => {
  it.each(LOCALES.map(({ id }) => id))("%s has every key with the same placeholders", (locale) => {
    const messages: Record<string, string> = MESSAGES[locale];
    expect(Object.keys(messages).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      expect(messages[key].trim(), key).toBe(messages[key]);
      expect(messages[key], key).not.toBe("");
      expect(placeholders(messages[key]), key).toEqual(placeholders(zhCN[key]));
    }
  });

  it("names every catalog entry", () => {
    const keys: string[] = [
      ...POSE_ORDER.map((key) => `pose.${key}`),
      ...STOCKING_LENGTH_ORDER.map((key) => `length.${key}`),
      ...CUFF_STYLE_ORDER.map((key) => `cuff.${key}`),
      ...MATERIAL_ORDER.flatMap((key) => [`material.${key}`, `material.${key}.hint`]),
      ...PATTERN_ORDER.map((key) => `pattern.${key}`),
      ...SECRET_DECAL_ORDER.map((key) => `secret.${key}`),
      ...COLOR_ORDER.map((key) => `color.${key}`),
      ...SCENE_ORDER.flatMap((key) => [`scene.${key}`, `scene.${key}.rain`, `scene.${key}.hint`]),
      ...BACKDROP_ORDER.map((key) => `backdrop.${key}`),
      ...PRESETS.map((preset) => `preset.${preset.id}`),
    ];
    expect(keys.filter((key) => !(key in zhCN))).toEqual([]);
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length);
  });
});
