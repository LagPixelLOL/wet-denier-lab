import { actions } from "../engine/app/actions";
import { useStore } from "../state/useStore";
import { ui } from "../state/ui";
import { InfoIcon, PhotoIcon, SoundIcon } from "./icons";

export function CornerBar() {
  const aboutOpen = useStore(ui, (s) => s.panels.about);
  const soundOn = useStore(ui, (s) => s.soundOn);
  return (
    <div className="corner">
      <button id="photoBtn" className="round" aria-label="拍照" onClick={actions.requestPhoto}>
        <PhotoIcon />
      </button>
      <button
        id="aboutBtn"
        className="round"
        aria-label="制作说明"
        aria-expanded={aboutOpen}
        aria-controls="about"
        onClick={actions.toggleAbout}
      >
        <InfoIcon />
      </button>
      <button id="sound" className="round" aria-label="声音" aria-pressed={soundOn} onClick={actions.toggleSound}>
        <SoundIcon />
      </button>
    </div>
  );
}
