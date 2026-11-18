import { useEffect, useRef, type ReactNode } from "react";
import { actions } from "../../engine/app/actions";
import { Pill } from "../Pill";
import { thumbCanvases } from "../../engine/app/thumbnails";
import { COLORS, COLOR_ORDER, type ColorDef } from "../../engine/catalog/colors";
import {
  CUFF_STYLES,
  CUFF_STYLE_ORDER,
  DENIER_OPTIONS,
  MATERIALS,
  MATERIAL_ORDER,
  PATTERNS,
  PATTERN_ORDER,
  SECRET_DECALS,
  SECRET_DECAL_ORDER,
  STOCKING_LENGTHS,
  STOCKING_LENGTH_ORDER,
} from "../../engine/catalog/garments";
import { PRESETS } from "../../engine/catalog/presets";
import { POSES, POSE_ORDER } from "../../engine/rig/poses";
import { useStore } from "../../state/useStore";
import { ui, type WardrobeTab } from "../../state/ui";
import { CardGrid, ChipGroup, CustomColorSwatch, LabeledRow, type ChipOption } from "./primitives";
import { hideScrollbar, paneHintClass, wardrobeSheetClass } from "./styles";

const TABS: [WardrobeTab, string][] = [
  ["pose", "姿势"],
  ["preset", "套装"],
  ["style", "款式"],
  ["color", "颜色"],
  ["material", "材质"],
  ["pattern", "花纹"],
  ["fun", "彩蛋"],
];

const BARE_HINT = "光腿没穿袜子，这些选项用不上。";

const isPaletteColor = (color: string) => !!(COLORS as Partial<Record<string, ColorDef>>)[color];

const options = (pairs: [string, string][]): ChipOption[] => pairs.map(([value, label]) => ({ value, label }));

const POSE_OPTIONS = options(POSE_ORDER.map((key) => [key, POSES[key].label]));
const LENGTH_OPTIONS = options(STOCKING_LENGTH_ORDER.map((key) => [key, STOCKING_LENGTHS[key].label]));
const CUFF_OPTIONS = options(CUFF_STYLE_ORDER.map((key) => [key, CUFF_STYLES[key].label]));
const GARTER_OPTIONS = options([
  ["0", "不要"],
  ["1", "要（大腿袜）"],
]);
const COLOR_OPTIONS: ChipOption[] = COLOR_ORDER.map((key) => ({
  value: key,
  label: "",
  swatch: { color: COLORS[key].dye, title: COLORS[key].label },
}));
const MATERIAL_OPTIONS = options(MATERIAL_ORDER.map((key) => [key, MATERIALS[key].label]));
const DENIER_CHIPS = options(DENIER_OPTIONS.map((denier) => [String(denier), denier + "D"]));
const PATTERN_OPTIONS = options(PATTERN_ORDER.map((key) => [key, PATTERNS[key].label]));
const SECRET_OPTIONS = options(
  SECRET_DECAL_ORDER.map((key) => [key, key === "none" ? "无" : "藏" + SECRET_DECALS[key].label]),
);
const WET_COLOR_OPTIONS = options([
  ["", "不变"],
  ["sakura", "变樱粉"],
  ["mist", "变雾蓝"],
  ["taro", "变香芋紫"],
  ["cherry", "变正红"],
]);
const TARGET_OPTIONS: [string, string][] = [
  ["-1", "双腿"],
  ["0", "左腿"],
  ["1", "右腿"],
];
const PRESET_ITEMS = PRESETS.map((preset, index) => ({ value: String(index), label: preset.name }));

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
  const bareHint = bare && <p className={paneHintClass}>{BARE_HINT}</p>;
  const panes: Record<WardrobeTab, ReactNode> = {
    pose: (
      <>
        <ChipGroup group="pose" options={POSE_OPTIONS} selected={spec ? pose : undefined} onPick={actions.pose} />
        <p className={`${paneHintClass} hidden fine:block`}>键盘数字键 1 到 7 也能换姿势。</p>
      </>
    ),
    preset: (
      <CardGrid
        group="preset"
        layout="row"
        items={PRESET_ITEMS}
        onPick={pickPreset}
        canvasRef={registerCanvas}
        onCardHover={previewPreset}
        onLeave={endPreview}
      />
    ),
    style: (
      <>
        <LabeledRow label="长度">{chips("length", LENGTH_OPTIONS, spec?.length)}</LabeledRow>
        <LabeledRow label="袜口">{chips("cuff", CUFF_OPTIONS, spec?.cuff, spec?.length === "tights")}</LabeledRow>
        <LabeledRow label="吊带">
          {chips(
            "garter",
            GARTER_OPTIONS,
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
          options={COLOR_OPTIONS}
          selected={spec?.color}
          disabled={bare}
          onPick={(value) => actions.wearChip("color", value)}
          swatches
        >
          <CustomColorSwatch
            label="自选颜色"
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
        <LabeledRow label="材质">{chips("material", MATERIAL_OPTIONS, spec?.material)}</LabeledRow>
        <LabeledRow label="厚度">
          {chips("denier", DENIER_CHIPS, spec ? String(spec.denier) : undefined, !!material && material.minDenier > 0)}
        </LabeledRow>
        {bareHint || (
          <p className={paneHintClass}>
            {material &&
              material.label + "：" + material.hint + (material.minDenier ? "。这种料子不透，厚度不起作用。" : "。")}
          </p>
        )}
      </>
    ),
    pattern: (
      <>
        {chips("pattern", PATTERN_OPTIONS, spec?.pattern)}
        {bareHint}
      </>
    ),
    fun: (
      <>
        <LabeledRow label="显形">{chips("secret", SECRET_OPTIONS, spec?.secret)}</LabeledRow>
        <LabeledRow label="变色">
          {chips("wetColor", WET_COLOR_OPTIONS, spec ? spec.wetColor || "" : undefined)}
        </LabeledRow>
        {bareHint || <p className={paneHintClass}>平时看不出来，泼上水才显出来。选好以后往腿上泼水试试。</p>}
      </>
    ),
  };
  const currentTarget = spec ? String(solo ? -1 : target) : undefined;

  return (
    <section id="materials" className={wardrobeSheetClass} aria-label="衣橱">
      <div
        className={`-mx-1 -mt-0.5 mb-0 flex justify-between gap-0 overflow-x-auto overscroll-contain px-0.5 ${hideScrollbar}`}
        role="tablist"
        aria-label="衣橱分类"
        ref={tabBar}
      >
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`relative flex-none rounded-xl px-2 pt-[7px] pb-2 text-[13px] tracking-[0.04em] [transition:color_0.2s] ${id === tab ? "font-semibold text-ink-strong after:absolute after:right-2 after:bottom-0.5 after:left-2 after:h-0.5 after:rounded-[2px] after:bg-accent after:content-['']" : "text-ink-soft"}`}
            role="tab"
            data-tab={id}
            aria-selected={id === tab}
            onClick={() => actions.showTab(id)}
          >
            {label}
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
      <div className="flex items-center justify-between gap-2.5 border-t border-t-hairline pt-2">
        <div
          className={`flex rounded-[999px] bg-well p-0.5 ${tab === "pose" || solo ? "invisible" : ""}`}
          data-key="target"
          role="radiogroup"
          aria-label="穿在哪条腿上"
        >
          {TARGET_OPTIONS.map(([value, label]) => {
            const on = value === currentTarget;
            return (
              <button
                key={value}
                data-v={value}
                role="radio"
                className={`rounded-[999px] px-3 py-[5px] text-[12.5px] whitespace-nowrap [transition:background_0.2s,color_0.2s] wide:px-[9px] ${on ? "bg-glass-strong font-semibold text-ink-strong shadow-[0_1px_4px_#5c467829]" : "text-ink-soft"}`}
                aria-checked={spec ? on : undefined}
                onClick={() => actions.target(Number(value))}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-[7px]">
          <Pill id="randomBtn" className="wide:px-[11px]" onClick={actions.random}>
            随机一双
          </Pill>
          <Pill
            id="shareBtn"
            className="wide:px-[11px]"
            title="把这一双连同姿势和场景生成一个链接"
            onClick={actions.share}
          >
            复制链接
          </Pill>
        </div>
      </div>
    </section>
  );
}
