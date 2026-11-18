import { useStore } from "../state/useStore";
import { ui } from "../state/ui";

export function Loading() {
  const error = useStore(ui, (s) => s.bootError);
  return (
    <div id="loading" className="loading">
      {error === null ? (
        <>
          <span></span>正在准备丝袜与水…
        </>
      ) : (
        <>
          三维画面启动失败：{error}
          <br />
          请用最新版 Chrome / Safari / Edge 打开
        </>
      )}
    </div>
  );
}
