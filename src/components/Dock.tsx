import { BucketIcon, DryIcon, OrbitIcon, RainIcon, SceneIcon, SlowIcon, WardrobeIcon, WaterIcon } from "./icons";

export function Dock() {
  return (
    <nav className="dock" aria-label="操作">
      <div className="modes" role="radiogroup" aria-label="触控方式">
        <span className="thumb" aria-hidden="true"></span>
        <button id="modeWater" className="mode" role="radio" aria-checked="true">
          <WaterIcon />
          <span>泼水</span>
        </button>
        <button id="modeView" className="mode" role="radio" aria-checked="false">
          <OrbitIcon />
          <span>视角</span>
        </button>
      </div>
      <span className="sep" aria-hidden="true"></span>
      <button id="bucketBtn" className="tool accent" data-key="空格">
        <BucketIcon />
        <span>一捧水</span>
      </button>
      <button id="rainBtn" className="tool" aria-pressed="false" data-key="R">
        <RainIcon />
        <span>细雨</span>
      </button>
      <button id="slowBtn" className="tool" aria-pressed="false" data-key="S">
        <SlowIcon />
        <span>慢动作</span>
      </button>
      <button id="dryBtn" className="tool" data-key="D">
        <DryIcon />
        <span>擦干</span>
      </button>
      <button id="sceneBtn" className="tool" aria-pressed="false" data-key="C">
        <SceneIcon />
        <span>场景</span>
      </button>
      <button id="matBtn" className="tool" aria-pressed="false" data-key="W">
        <WardrobeIcon />
        <span>衣橱</span>
      </button>
    </nav>
  );
}
