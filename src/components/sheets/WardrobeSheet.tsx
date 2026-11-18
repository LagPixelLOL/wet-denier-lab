import { useEffect, useRef, type ReactNode } from "react";
import { actions } from "../../engine/app/actions";
import { Pill } from "../Pill";
import { thumbCanvases } from "../../engine/app/thumbnails";
import { COLORS, COLOR_ORDER, type ColorDef } from "../../engine/catalog/colors";
import {
  CUFF_STYLE_ORDER,
  DENIER_OPTIONS,
  MATERIALS,
  MATERIAL_ORDER,
  PATTERN_ORDER,
  SECRET_DECAL_ORDER,
  STOCKING_LENGTH_ORDER,
} from "../../engine/catalog/garments";
import { PRESETS } from "../../engine/catalog/presets";
import { POSE_ORDER } from "../../engine/rig/poses";
import { useT, type MessageKey } from "../../i18n";
import { useStore } from "../../state/useStore";
import { ui, type WardrobeTab } from "../../state/ui";
import { CardGrid, ChipGroup, CustomColorSwatch, LabeledRow, type ChipOption } from "./primitives";
import { hideScrollbar, paneHintClass, wardrobeSheetClass } from "./styles";

const TABS: [WardrobeTab, MessageKey][] = [
  ["pose", "tab.pose"],
  ["preset", "tab.preset"],
  ["style", "tab.style"],
  ["color", "tab.color"],
  ["material", "tab.material"],
  ["pattern", "tab.pattern"],
  ["fun", "tab.fun"],
];

const isPaletteColor = (color: string) => !!(COLORS as Partial<Record<string, ColorDef>>)[color];

/** Chip values with the message key of each label. */
type Choices = [value: string, label: MessageKey][];

const POSE_CHOICES: Choices = POSE_ORDER.map((key) => [key, `pose.${key}`]);
const LENGTH_CHOICES: Choices = STOCKING_LENGTH_ORDER.map((key) => [key, `length.${key}`]);
const CUFF_CHOICES: Choices = CUFF_STYLE_ORDER.map((key) => [key, `cuff.${key}`]);
const GARTER_CHOICES: Choices = [
  ["0", "garter.off"],
  ["1", "garter.on"],
];
const MATERIAL_CHOICES: Choices = MATERIAL_ORDER.map((key) => [key, `material.${key}`]);
const DENIER_CHIPS: ChipOption[] = DENIER_OPTIONS.map((denier) => ({ value: String(denier), label: denier + "D" }));
const PATTERN_CHOICES: Choices = PATTERN_ORDER.map((key) => [key, `pattern.${key}`]);
const SECRET_CHOICES: Choices = SECRET_DECAL_ORDER.map((key) => [key, `secret.${key}`]);
const WET_COLOR_CHOICES: Choices = [
  ["", "wetColor.none"],
  ["sakura", "wetColor.sakura"],
  ["mist", "wetColor.mist"],
  ["taro", "wetColor.taro"],
  ["cherry", "wetColor.cherry"],
];
const TARGET_CHOICES: Choices = [
  ["-1", "target.both"],
  ["0", "target.left"],
  ["1", "target.right"],
];

const registerCanvas = (value: string, canvas: HTMLCanvasElement | null) => {
  if (canvas) {
    thumbCanvases.presets[Number(value)] = canvas;
  }
};
const pickPreset = (value: string) => actions.preset(Number(value));
const previewPreset = (value: string) => actions.previewPreset(Number(value));
const endPreview = () => actions.previewPreset(null);

/** The wardrobe: tabs for pose, presets, style, color, material, pattern and hidden decals, plus leg target. */
export function WardrobeSheet() {
  const { tab, spec, pose, target, solo } = useStore(ui, (s) => s.wardrobe);
  const tabBar = useRef<HTMLDivElement>(null);
  const shownTab = useRef(tab);
  useEffect(() => {
    if (shownTab.current === tab) {
      return;
    }
    shownTab.current = tab;
    tabBar.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [tab]);

  const t = useT();
  const options = (choices: Choices): ChipOption[] => choices.map(([value, label]) => ({ value, label: t(label) }));
  const colorOptions: ChipOption[] = COLOR_ORDER.map((key) => ({
    value: key,
    label: "",
    swatch: { color: COLORS[key].dye, title: t(`color.${key}`) },
  }));
  const presetItems = PRESETS.map((preset, index) => ({ value: String(index), label: t(`preset.${preset.id}`) }));
  const material = spec ? MATERIALS[spec.material] : null;
  // Without stockings only the length (to put them back on) still does anything.
  const bare = spec?.length === "bare";
  const chips = (group: string, chipOptions: ChipOption[], selected: string | undefined, idle?: boolean) => (
    <ChipGroup
      group={group}
      options={chipOptions}
      selected={selected}
      idle={idle}
      disabled={bare && group !== "length"}
      onPick={(value) => actions.wearChip(group, value)}
    />
  );
  const bareHint = bare && <p className={paneHintClass}>{t("wardrobe.bareHint")}</p>;
  const panes: Record<WardrobeTab, ReactNode> = {
    pose: (
      <>
        <ChipGroup
          group="pose"
          options={options(POSE_CHOICES)}
          selected={spec ? pose : undefined}
          onPick={actions.pose}
        />
        <p className={`${paneHintClass} hidden fine:block`}>{t("wardrobe.poseHint")}</p>
      </>
    ),
    preset: (
      <CardGrid
        group="preset"
        layout="row"
        items={presetItems}
        onPick={pickPreset}
        canvasRef={registerCanvas}
        onCardHover={previewPreset}
        onLeave={endPreview}
      />
    ),
    style: (
      <>
        <LabeledRow label={t("row.length")}>{chips("length", options(LENGTH_CHOICES), spec?.length)}</LabeledRow>
        <LabeledRow label={t("row.cuff")}>
          {chips("cuff", options(CUFF_CHOICES), spec?.cuff, spec?.length === "tights")}
        </LabeledRow>
        <LabeledRow label={t("row.garter")}>
          {chips(
            "garter",
            options(GARTER_CHOICES),
            spec ? (spec.garter ? "1" : "0") : undefined,
            !!spec && spec.length !== "thigh",
          )}
        </LabeledRow>
        {bareHint}
      </>
    ),
    color: (
      <>
        <ChipGroup
          group="color"
          options={colorOptions}
          selected={spec?.color}
          disabled={bare}
          onPick={(value) => actions.wearChip("color", value)}
          swatches
        >
          <CustomColorSwatch
            label={t("wardrobe.customColor")}
            custom={spec && !isPaletteColor(spec.color) ? spec.color : null}
            disabled={bare}
            onInput={actions.wearColor}
          />
        </ChipGroup>
        {bareHint}
      </>
    ),
    material: (
      <>
        <LabeledRow label={t("row.material")}>
          {chips("material", options(MATERIAL_CHOICES), spec?.material)}
        </LabeledRow>
        <LabeledRow label={t("row.denier")}>
          {chips("denier", DENIER_CHIPS, spec ? String(spec.denier) : undefined, !!material && material.minDenier > 0)}
        </LabeledRow>
        {bareHint || (
          <p className={paneHintClass}>
            {material &&
              t(material.minDenier ? "wardrobe.materialHintOpaque" : "wardrobe.materialHint", {
                label: t(`material.${spec!.material}`),
                hint: t(`material.${spec!.material}.hint`),
              })}
          </p>
        )}
      </>
    ),
    pattern: (
      <>
        {chips("pattern", options(PATTERN_CHOICES), spec?.pattern)}
        {bareHint}
      </>
    ),
    fun: (
      <>
        <LabeledRow label={t("row.secret")}>{chips("secret", options(SECRET_CHOICES), spec?.secret)}</LabeledRow>
        <LabeledRow label={t("row.wetColor")}>
          {chips("wetColor", options(WET_COLOR_CHOICES), spec ? spec.wetColor || "" : undefined)}
        </LabeledRow>
        {bareHint || <p className={paneHintClass}>{t("wardrobe.funHint")}</p>}
      </>
    ),
  };
  const currentTarget = spec ? String(solo ? -1 : target) : undefined;

  return (
    <section id="materials" className={wardrobeSheetClass} aria-label={t("wardrobe.label")}>
      <div
        className={`-mx-1 -mt-0.5 mb-0 flex justify-between gap-0 overflow-x-auto overscroll-contain px-0.5 ${hideScrollbar}`}
        role="tablist"
        aria-label={t("wardrobe.tabs")}
        ref={tabBar}
      >
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`relative flex-none rounded-xl px-2 pt-[7px] pb-2 text-[13px] tracking-[0.04em] [transition:color_0.2s] en:px-1 en:text-[12.5px] en:tracking-normal ${id === tab ? "font-semibold text-ink-strong after:absolute after:right-2 after:bottom-0.5 after:left-2 after:h-0.5 after:rounded-[2px] after:bg-accent after:content-[''] en:after:right-1 en:after:left-1" : "text-ink-soft"}`}
            role="tab"
            data-tab={id}
            aria-selected={id === tab}
            onClick={() => actions.showTab(id)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className="max-h-[min(34vh,250px)] min-h-[118px] overflow-y-auto overscroll-contain py-0.5 wide:max-h-none roomy:-mx-[3px] roomy:min-h-0 roomy:overflow-y-auto roomy:px-[3px]">
        {TABS.map(([id]) => (
          <div
            key={id}
            className="grid [align-content:start] gap-[9px] hidden-attr:hidden"
            data-pane={id}
            role="tabpanel"
            hidden={id !== tab}
          >
            {panes[id]}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2.5 gap-y-2 border-t border-t-hairline pt-2">
        <div
          className={`flex rounded-[999px] bg-well p-0.5 ${tab === "pose" || solo ? "invisible" : ""}`}
          data-key="target"
          role="radiogroup"
          aria-label={t("wardrobe.target")}
        >
          {TARGET_CHOICES.map(([value, label]) => {
            const on = value === currentTarget;
            return (
              <button
                key={value}
                data-v={value}
                role="radio"
                className={`rounded-[999px] px-3 py-[5px] text-[12.5px] whitespace-nowrap [transition:background_0.2s,color_0.2s] wide:px-[9px] narrow-en:px-2.5 ${on ? "bg-glass-strong font-semibold text-ink-strong shadow-[0_1px_4px_#5c467829]" : "text-ink-soft"}`}
                aria-checked={spec ? on : undefined}
                onClick={() => actions.target(Number(value))}
              >
                {t(label)}
              </button>
            );
          })}
        </div>
        <div className="flex gap-[7px]">
          <Pill id="randomBtn" className="wide:px-[11px] narrow-en:px-[11px]" onClick={actions.random}>
            {t("wardrobe.random")}
          </Pill>
          <Pill
            id="shareBtn"
            className="wide:px-[11px] narrow-en:px-[11px]"
            title={t("wardrobe.shareTitle")}
            onClick={actions.share}
          >
            {t("wardrobe.share")}
          </Pill>
        </div>
      </div>
    </section>
  );
}
