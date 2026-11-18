import { actions } from "../engine/app/actions";
import { useStore } from "../state/useStore";
import { ui } from "../state/ui";
import { BucketIcon, DryIcon, OrbitIcon, RainIcon, SceneIcon, SlowIcon, WardrobeIcon, WaterIcon } from "./icons";

export function Dock() {
  const mode = useStore(ui, (s) => s.mode);
  const rain = useStore(ui, (s) => s.rain);
  const rainLabel = useStore(ui, (s) => s.rainLabel);
  const slow = useStore(ui, (s) => s.slow);
  const matOpen = useStore(ui, (s) => s.panels.mat);
  const sceneOpen = useStore(ui, (s) => s.panels.scene);
  return (
    <nav className="dock" aria-label="操作">
      <div className="modes" role="radiogroup" aria-label="触控方式">
        <span className="thumb" aria-hidden="true"></span>
        <button
          id="modeWater"
          className="mode"
          role="radio"
          aria-checked={mode === "water"}
          onClick={() => actions.setMode("water")}
        >
          <WaterIcon />
          <span>泼水</span>
        </button>
        <button
          id="modeView"
          className="mode"
          role="radio"
          aria-checked={mode === "view"}
          onClick={() => actions.setMode("view")}
        >
          <OrbitIcon />
          <span>视角</span>
        </button>
      </div>
      <span className="sep" aria-hidden="true"></span>
      <button id="bucketBtn" className="tool accent" data-key="空格" onClick={actions.bucket}>
        <BucketIcon />
        <span>一捧水</span>
      </button>
      <button id="rainBtn" className="tool" aria-pressed={rain} data-key="R" onClick={actions.toggleRain}>
        <RainIcon />
        <span>{rainLabel}</span>
      </button>
      <button id="slowBtn" className="tool" aria-pressed={slow} data-key="S" onClick={actions.toggleSlow}>
        <SlowIcon />
        <span>慢动作</span>
      </button>
      <button id="dryBtn" className="tool" data-key="D" onClick={actions.dry}>
        <DryIcon />
        <span>擦干</span>
      </button>
      <button id="sceneBtn" className="tool" aria-pressed={sceneOpen} data-key="C" onClick={actions.toggleScenes}>
        <SceneIcon />
        <span>场景</span>
      </button>
      <button id="matBtn" className="tool" aria-pressed={matOpen} data-key="W" onClick={actions.toggleWardrobe}>
        <WardrobeIcon />
        <span>衣橱</span>
      </button>
    </nav>
  );
}
