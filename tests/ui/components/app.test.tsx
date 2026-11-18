import { act, cleanup, render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import type { Container, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roots = vi.hoisted(() => [] as { root: Root; container: Container }[]);

vi.mock("../../../src/engine/app/actions", async () => (await import("./harness")).mockActionsModule());
vi.mock("../../../src/engine/app/boot", () => ({ startApp: vi.fn() }));
// Records the roots main.tsx creates so the test can unmount them.
vi.mock("react-dom/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...real,
    createRoot: (...args: Parameters<typeof real.createRoot>) => {
      const root = real.createRoot(...args);
      roots.push({ root, container: args[0] });
      return root;
    },
  };
});

// Viewport keeps a module-level "started" flag, so every test loads fresh module instances.
async function load() {
  vi.resetModules();
  const [{ startApp }, { App }, { Viewport }, { ui }, { actions }] = await Promise.all([
    import("../../../src/engine/app/boot"),
    import("../../../src/App"),
    import("../../../src/components/Viewport"),
    import("../../../src/state/ui"),
    import("../../../src/engine/app/actions"),
  ]);
  return { startApp: vi.mocked(startApp), App, Viewport, ui, actions };
}

beforeEach(() => {
  roots.length = 0;
});

afterEach(() => {
  act(() => {
    for (const { root, container } of roots) {
      if (container instanceof Element && container.id === "root") {
        root.unmount();
      }
    }
  });
  cleanup();
  document.body.innerHTML = "";
});

describe("Viewport", () => {
  it("renders the labeled WebGL canvas and starts the engine after it is in the document", async () => {
    const { startApp, Viewport } = await load();
    let canvasAtStart: Element | null = null;
    startApp.mockImplementation(() => {
      canvasAtStart = document.querySelector("#view");
    });
    render(<Viewport />);
    const canvas = document.querySelector("#view")!;
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas).toHaveAttribute("aria-label", "三维丝袜泼水");
    expect(startApp).toHaveBeenCalledTimes(1);
    expect(canvasAtStart).toBe(canvas);
  });

  it("starts the engine once under StrictMode's double effects", async () => {
    const { startApp, Viewport } = await load();
    let probeEffects = 0;
    function Probe() {
      useEffect(() => {
        probeEffects++;
      }, []);
      return null;
    }
    render(
      <StrictMode>
        <Probe />
        <Viewport />
      </StrictMode>,
    );
    // StrictMode did run mount effects twice; only the guard keeps startApp at one call.
    expect(probeEffects).toBe(2);
    expect(startApp).toHaveBeenCalledTimes(1);
  });

  it("does not restart the engine when remounted", async () => {
    const { startApp, Viewport } = await load();
    render(<Viewport />).unmount();
    render(<Viewport />);
    expect(startApp).toHaveBeenCalledTimes(1);
  });
});

describe("App", () => {
  it("mounts the viewport first, then every overlay, with the copy box absent", async () => {
    const { App } = await load();
    const { container } = render(<App />);
    const top = [...container.children].map((el) => el.id || el.getAttribute("aria-label") || el.tagName);
    expect(top).toEqual(["view", "HEADER", "DIV", "about", "hint", "loading", "zoombar", "ASIDE", "操作", "photo"]);
    expect(container.querySelector("aside #scenes")).not.toBeNull();
    expect(container.querySelector("aside #materials")).not.toBeNull();
    expect(container.querySelector("#copybox")).toBeNull();
  });

  it("starts the engine once", async () => {
    const { App, startApp } = await load();
    render(<App />);
    expect(startApp).toHaveBeenCalledTimes(1);
  });

  it("renders the copy box last once the engine asks for it", async () => {
    const { App, ui } = await load();
    const { container } = render(<App />);
    act(() => ui.set({ copyBox: { url: "https://example.test/#x", open: true } }));
    expect(container.lastElementChild).toHaveAttribute("id", "copybox");
  });
});

describe("App locale", () => {
  it("sets <html lang> to the locale and re-measures the layout when it changes", async () => {
    const { App, ui, actions } = await load();
    render(<App />);
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(actions.relayout).toHaveBeenCalledTimes(1);
    act(() => ui.set({ locale: "en-US" }));
    expect(document.documentElement.lang).toBe("en-US");
    expect(actions.relayout).toHaveBeenCalledTimes(2);
    expect(document.querySelector("#viewReset")).toHaveTextContent("Reset");
  });
});

describe("main entry", () => {
  it("picks the UI language from the browser before the first render", async () => {
    const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR", "en-GB"]);
    try {
      const root = document.body.appendChild(document.createElement("div"));
      root.id = "root";
      const { ui } = await load();
      await act(async () => {
        await import("../../../src/main");
      });
      expect(ui.get().locale).toBe("en-US");
      expect(root.querySelector("#dock, .dock")).toHaveTextContent("Wardrobe");
    } finally {
      languages.mockRestore();
      document.documentElement.lang = "";
    }
  });

  it("renders the app into #root under StrictMode and starts the engine once", async () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    const { startApp } = await load();
    await act(async () => {
      await import("../../../src/main");
    });
    expect(roots.map((entry) => entry.container)).toContain(root);
    expect(root.querySelector("canvas#view")).not.toBeNull();
    expect(root.querySelector("#materials")).not.toBeNull();
    expect(startApp).toHaveBeenCalledTimes(1);
  });
});
