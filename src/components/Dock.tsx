import { actions } from "../engine/app/actions";
import { useStore } from "../state/useStore";
import { ui } from "../state/ui";
import { BucketIcon, DryIcon, OrbitIcon, RainIcon, SceneIcon, SlowIcon, WardrobeIcon, WaterIcon } from "./icons";
import { useT } from "../i18n";

const mode =
  "relative z-1 grid min-w-0 flex-[1_1_0] justify-items-center gap-[3px] rounded-[14px] px-0.5 pt-[5px] pb-1 text-[11px] whitespace-nowrap text-ink-soft transition-[color] duration-250 ease-[ease] aria-checked:font-semibold max-[380px]:text-[10px] narrow-en:text-[10px] narrow-en:tracking-[-0.01em] narrow-en:max-[380px]:text-[9.5px] wide:flex-none wide:pt-[7px] wide:pb-[5px] short:flex-[1_1_0] short:pt-1 short:pb-[3px] [&_svg]:size-[22px] max-[380px]:[&_svg]:size-[21px] short:[&_svg]:size-5";

// Keyboard hint badges (fine pointer, wide layout only).
const tool =
  "relative grid min-w-0 flex-[1_1_0] justify-items-center gap-[3px] rounded-2xl px-0.5 pt-2 pb-1.5 text-[11px] whitespace-nowrap [transition:background_.2s,color_.2s,transform_.12s] max-[380px]:text-[10px] narrow-en:text-[10px] narrow-en:tracking-[-0.01em] narrow-en:max-[380px]:text-[9.5px] wide:w-[66px] wide:flex-none wide:text-[11.5px] short:w-auto short:rounded-xl short:pt-[5px] short:pb-1 short:text-[10.5px] [&_svg]:size-[23px] max-[380px]:[&_svg]:size-[21px] short:[&_svg]:size-5 fine-wide:after:absolute fine-wide:after:top-[3px] fine-wide:after:right-1 fine-wide:after:min-w-3.5 fine-wide:after:rounded-[5px] fine-wide:after:px-[3px] fine-wide:after:text-center fine-wide:after:font-ui fine-wide:after:text-[9px] fine-wide:after:leading-[14px] fine-wide:after:tracking-normal fine-wide:after:content-[attr(data-key)] [body.fine.wide.short_&]:after:hidden";

const plainTool =
  tool +
  " text-ink active:transform-[scale(0.94)] aria-pressed:bg-accent-soft aria-pressed:text-accent fine-wide:after:bg-well fine-wide:after:text-ink-soft fine-wide:aria-pressed:after:bg-[#fff9] fine-wide:aria-pressed:after:text-accent";

const accentTool =
  tool +
  " bg-[linear-gradient(160deg,var(--accent),var(--accent-deep))] text-on-ink shadow-[0_6px_16px_var(--focus)] active:transform-[scale(0.92)] fine-wide:after:bg-[#ffffff38] fine-wide:after:text-on-ink";

export function Dock() {
  const current = useStore(ui, (s) => s.mode);
  const rain = useStore(ui, (s) => s.rain);
  const rainLabel = useStore(ui, (s) => s.rainLabel);
  const slow = useStore(ui, (s) => s.slow);
  const matOpen = useStore(ui, (s) => s.panels.mat);
  const sceneOpen = useStore(ui, (s) => s.panels.scene);
  const t = useT();
  return (
    <nav
      className="dock fixed bottom-[calc(18px+var(--safe-b))] left-1/2 flex w-[min(440px,calc(100vw-var(--gutter-l)-var(--gutter-r)))] transform-[translate(-50%)] gap-0.5 rounded-[22px] border border-line bg-glass p-1.5 shadow-panel backdrop-blur-[16px] wide:top-1/2 wide:bottom-auto wide:left-(--gutter-l) wide:w-auto wide:transform-[translateY(-50%)] wide:flex-col wide:gap-[3px] wide:p-[7px] short:top-auto short:bottom-[calc(8px+var(--safe-b))] short:grid short:transform-none short:grid-cols-[repeat(2,54px)] short:gap-0.5 short:rounded-[18px] short:p-[5px] roomy:left-[calc(14px+var(--gutter-l))]"
      aria-label={t("dock.label")}
    >
      <div
        className="relative flex min-w-0 flex-[2_1_0] rounded-[17px] bg-well p-[3px] wide:flex-none wide:flex-col short:col-span-full short:flex-row"
        role="radiogroup"
        aria-label={t("dock.touchMode")}
      >
        <span
          className="absolute top-[3px] bottom-[3px] left-[3px] w-[calc(50%-3px)] rounded-[14px] bg-glass-strong shadow-[0_2px_8px_#5c467829] transition-[transform] duration-320 ease-[cubic-bezier(0.3,0.8,0.25,1)] view-mode:transform-[translate(100%)] wide:right-[3px] wide:bottom-auto wide:h-[calc(50%-3px)] wide:w-auto wide-view-mode:transform-[translateY(100%)] short:right-auto short:bottom-[3px] short:h-auto short:w-[calc(50%-3px)] short-view-mode:transform-[translate(100%)]"
          aria-hidden="true"
        ></span>
        <button
          id="modeWater"
          className={mode + " aria-checked:text-accent"}
          role="radio"
          aria-checked={current === "water"}
          onClick={() => actions.setMode("water")}
        >
          <WaterIcon />
          <span>{t("dock.splash")}</span>
        </button>
        <button
          id="modeView"
          className={mode + " aria-checked:text-ink-strong"}
          role="radio"
          aria-checked={current === "view"}
          onClick={() => actions.setMode("view")}
        >
          <OrbitIcon />
          <span>{t("dock.view")}</span>
        </button>
      </div>
      <span
        className="mx-[3px] my-[9px] flex-[0_0_1px] self-stretch bg-hairline wide:mx-[9px] wide:my-[3px] short:hidden"
        aria-hidden="true"
      ></span>
      <button id="bucketBtn" className={accentTool} data-key={t("key.space")} onClick={actions.bucket}>
        <BucketIcon />
        <span>{t("dock.bucket")}</span>
      </button>
      <button id="rainBtn" className={plainTool} aria-pressed={rain} data-key="R" onClick={actions.toggleRain}>
        <RainIcon />
        <span>{t(rainLabel)}</span>
      </button>
      <button id="slowBtn" className={plainTool} aria-pressed={slow} data-key="S" onClick={actions.toggleSlow}>
        <SlowIcon />
        <span>{t("dock.slow")}</span>
      </button>
      <button id="dryBtn" className={plainTool} data-key="D" onClick={actions.dry}>
        <DryIcon />
        <span>{t("dock.dry")}</span>
      </button>
      <button id="sceneBtn" className={plainTool} aria-pressed={sceneOpen} data-key="C" onClick={actions.toggleScenes}>
        <SceneIcon />
        <span>{t("dock.scenes")}</span>
      </button>
      <button id="matBtn" className={plainTool} aria-pressed={matOpen} data-key="W" onClick={actions.toggleWardrobe}>
        <WardrobeIcon />
        <span>{t("dock.wardrobe")}</span>
      </button>
    </nav>
  );
}
