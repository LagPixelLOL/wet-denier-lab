import { InfoIcon, PhotoIcon, SoundIcon } from "./icons";

export function CornerBar() {
  return (
    <div className="corner">
      <button id="photoBtn" className="round" aria-label="拍照">
        <PhotoIcon />
      </button>
      <button id="aboutBtn" className="round" aria-label="制作说明" aria-expanded="false" aria-controls="about">
        <InfoIcon />
      </button>
      <button id="sound" className="round" aria-label="声音" aria-pressed="true">
        <SoundIcon />
      </button>
    </div>
  );
}
