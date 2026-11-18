import { actions } from "../engine/app/actions";
import { useStore } from "../state/useStore";
import { ui } from "../state/ui";
import { InfoIcon, PhotoIcon, SoundIcon } from "./icons";
import { RoundButton } from "./RoundButton";

export function CornerBar() {
  const aboutOpen = useStore(ui, (s) => s.panels.about);
  const soundOn = useStore(ui, (s) => s.soundOn);
  return (
    <div className="fixed top-[calc(16px+var(--safe-t))] right-(--gutter-r) z-6 flex gap-2.5 short:top-[calc(10px+var(--safe-t))] roomy:top-[30px] roomy:right-[calc(14px+var(--gutter-r))]">
      <RoundButton id="photoBtn" aria-label="拍照" onClick={actions.requestPhoto}>
        <PhotoIcon />
      </RoundButton>
      <RoundButton
        id="aboutBtn"
        aria-label="制作说明"
        aria-expanded={aboutOpen}
        aria-controls="about"
        onClick={actions.toggleAbout}
      >
        <InfoIcon />
      </RoundButton>
      <RoundButton
        id="sound"
        aria-label="声音"
        aria-pressed={soundOn}
        onClick={actions.toggleSound}
        className="[&_.mute]:hidden aria-[pressed=false]:[&_.mute]:inline aria-[pressed=false]:[&_.wave]:hidden"
      >
        <SoundIcon />
      </RoundButton>
    </div>
  );
}
