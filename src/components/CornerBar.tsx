import { actions } from "../engine/app/actions";
import { useStore } from "../state/useStore";
import { ui } from "../state/ui";
import { InfoIcon, PhotoIcon, SoundIcon } from "./icons";
import { LanguageMenu } from "./LanguageMenu";
import { RoundButton } from "./RoundButton";
import { useT } from "../i18n";

export function CornerBar() {
  const aboutOpen = useStore(ui, (s) => s.panels.about);
  const soundOn = useStore(ui, (s) => s.soundOn);
  const t = useT();
  return (
    <div className="fixed top-[calc(16px+var(--safe-t))] right-(--gutter-r) z-6 flex gap-2.5 short:top-[calc(10px+var(--safe-t))] roomy:top-[30px] roomy:right-[calc(14px+var(--gutter-r))]">
      <RoundButton id="photoBtn" aria-label={t("corner.photo")} onClick={actions.requestPhoto}>
        <PhotoIcon />
      </RoundButton>
      <RoundButton
        id="aboutBtn"
        aria-label={t("corner.about")}
        aria-expanded={aboutOpen}
        aria-controls="about"
        onClick={actions.toggleAbout}
      >
        <InfoIcon />
      </RoundButton>
      <RoundButton
        id="sound"
        aria-label={t("corner.sound")}
        aria-pressed={soundOn}
        onClick={actions.toggleSound}
        className="[&_.mute]:hidden aria-[pressed=false]:[&_.mute]:inline aria-[pressed=false]:[&_.wave]:hidden"
      >
        <SoundIcon />
      </RoundButton>
      <LanguageMenu />
    </div>
  );
}
