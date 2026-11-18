import { useEffect } from "react";
import { AboutDialog } from "./components/AboutDialog";
import { Brand } from "./components/Brand";
import { CopyBox } from "./components/CopyBox";
import { CornerBar } from "./components/CornerBar";
import { Dock } from "./components/Dock";
import { Hint } from "./components/Hint";
import { Loading } from "./components/Loading";
import { PhotoDialog } from "./components/PhotoDialog";
import { SidePanels } from "./components/SidePanels";
import { Viewport } from "./components/Viewport";
import { ZoomBar } from "./components/ZoomBar";
import { actions } from "./engine/app/actions";
import { useStore } from "./state/useStore";
import { ui } from "./state/ui";

export function App() {
  const locale = useStore(ui, (s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
    // Translated text changes the size of the dock and sheets, which the stage insets are measured from.
    actions.relayout();
  }, [locale]);
  return (
    <>
      <Viewport />
      <Brand />
      <CornerBar />
      <AboutDialog />
      <Hint />
      <Loading />
      <ZoomBar />
      <SidePanels />
      <Dock />
      <PhotoDialog />
      <CopyBox />
    </>
  );
}
