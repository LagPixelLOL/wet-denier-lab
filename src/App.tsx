import { AboutDialog } from "./components/AboutDialog";
import { Brand } from "./components/Brand";
import { CornerBar } from "./components/CornerBar";
import { Dock } from "./components/Dock";
import { Hint } from "./components/Hint";
import { Loading } from "./components/Loading";
import { PhotoDialog } from "./components/PhotoDialog";
import { SidePanels } from "./components/SidePanels";
import { Viewport } from "./components/Viewport";
import { ZoomBar } from "./components/ZoomBar";

export function App() {
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
    </>
  );
}
