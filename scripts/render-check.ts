/**
 * Headless render check: builds the app, serves dist/, renders it in headless Chromium and saves a screenshot
 * plus a JSON report. Fails unless WebGL ran on a hardware GPU (pass --allow-software to accept SwiftShader,
 * llvmpipe and other software renderers).
 *
 *   node scripts/render-check.ts [options]
 *
 *   --url <url>         render this page instead of building and serving dist/
 *   --no-build          serve the existing dist/ without rebuilding
 *   --hash <hash>       URL hash to open, e.g. "#look=1~..." from the copy-link button
 *   --size <w>x<h>      viewport size in CSS pixels (default 1280x800)
 *   --dpr <n>           device pixel ratio (default 1)
 *   --locale <tag>      browser language, which picks the UI language (default en-US)
 *   --click <selector>  click this element once the page is ready (repeatable, in order); "wait:<ms>" in place
 *                       of a selector pauses that long before the next click
 *   --pour <x>,<y>      press and hold the pointer at this point of the viewport (CSS pixels) once the page is
 *                       ready, which pours water there; it stays down while settling and for the screenshot
 *   --release <ms>      with --pour: let the pointer go after settling and keep rendering this long before
 *                       the screenshot
 *   --settle <ms>       time to keep rendering after the page is ready (default 2000)
 *   --angle <backend>   ANGLE backend: vulkan, gl-egl or swiftshader (default vulkan)
 *   --perf              uncap the frame rate (no vsync) and also report gpuMs, the time the GPU needs to finish
 *                       each frame
 *   --dev               serve the app with Vite's dev server instead of the built one. The development build lets
 *                       --dpr set the render scale directly, past the app's pixel budget, and with --perf adds
 *                       benchMs to the report: the time per frame when rendering frames back to back at that
 *                       scale, which is what to compare when a shader changes (use e.g. --dpr 5)
 *   --out <file.png>    screenshot path (default render-check/render.png); the report goes next to it
 *   --allow-software    do not fail when the renderer is a software one
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright";
import { build, createServer, preview, type PreviewServer, type ViteDevServer } from "vite";

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i;

const ANGLE_FLAGS: Record<string, string[]> = {
  vulkan: ["--use-angle=vulkan", "--enable-features=Vulkan,VulkanFromANGLE", "--disable-vulkan-surface"],
  "gl-egl": ["--use-gl=angle", "--use-angle=gl-egl"],
  swiftshader: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
};

const { values: opts } = parseArgs({
  allowNegative: true,
  options: {
    url: { type: "string" },
    build: { type: "boolean", default: true },
    hash: { type: "string", default: "" },
    size: { type: "string", default: "1280x800" },
    dpr: { type: "string", default: "1" },
    locale: { type: "string", default: "en-US" },
    click: { type: "string", multiple: true, default: [] },
    pour: { type: "string" },
    release: { type: "string" },
    settle: { type: "string", default: "2000" },
    angle: { type: "string", default: "vulkan" },
    perf: { type: "boolean", default: false },
    dev: { type: "boolean", default: false },
    out: { type: "string", default: "render-check/render.png" },
    "allow-software": { type: "boolean", default: false },
  },
});

const [width, height] = opts.size.split("x").map(Number);
if (!(width > 0 && height > 0)) throw new Error(`Bad --size ${opts.size}, expected e.g. 1280x800`);
const angleFlags = ANGLE_FLAGS[opts.angle];
if (!angleFlags) throw new Error(`Bad --angle ${opts.angle}, expected ${Object.keys(ANGLE_FLAGS).join(", ")}`);
const outFile = path.resolve(opts.out);
const reportFile = outFile.replace(/\.png$/i, "") + ".json";

/** GPU utilization and memory from nvidia-smi, or null when there is no NVIDIA GPU. */
function sampleNvidia() {
  try {
    const line = execFileSync(
      "nvidia-smi",
      ["--query-gpu=name,utilization.gpu,memory.used", "--format=csv,noheader,nounits"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).split("\n")[0];
    const [name, util, mem] = line.split(",").map((s) => s.trim());
    return { name, utilizationPct: Number(util), memoryUsedMiB: Number(mem) };
  } catch {
    return null;
  }
}

/** Renderer strings of the app's own WebGL context (getContext returns the one three.js created). */
function readWebGLInfo(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#view");
    const gl = canvas?.getContext("webgl2");
    if (!gl) return null;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      vendor: String(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
      renderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      version: String(gl.getParameter(gl.VERSION)),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  });
}

/**
 * Times between animation frames (ms) over `ms` while the app keeps rendering. With `gpu`, also how long the GPU
 * took to finish each frame: this callback runs right after the app's own, and reading a pixel back blocks until
 * everything the app just drew has been executed.
 */
function measureFrames(page: Page, ms: number, gpu: boolean) {
  return page.evaluate(
    ([ms, gpu]) =>
      new Promise<{ frame: number[]; gpu: number[] }>((resolve) => {
        const gl = gpu ? document.querySelector<HTMLCanvasElement>("#view")?.getContext("webgl2") : null;
        const pixel = new Uint8Array(4);
        const times = { frame: [] as number[], gpu: [] as number[] };
        let last = performance.now();
        const end = last + ms;
        const tick = () => {
          const now = performance.now();
          times.frame.push(now - last);
          last = now;
          if (gl) {
            // three.js caches the bound framebuffer, so put it back afterwards.
            const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            const before = performance.now();
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            times.gpu.push(performance.now() - before);
            gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
          }
          if (now < end) requestAnimationFrame(tick);
          else resolve(times);
        };
        requestAnimationFrame(tick);
      }),
    [ms, gpu] as const,
  );
}

/** Mean and percentiles of a list of times (ms), skipping the first frames while the page warms up. */
function timeStats(times: number[]) {
  const steady = times.slice(Math.min(5, times.length - 1)).sort((a, b) => a - b);
  const total = steady.reduce((sum, t) => sum + t, 0);
  const at = (q: number) => Math.round(steady[Math.min(steady.length - 1, Math.floor(q * steady.length))] * 100) / 100;
  return {
    count: steady.length,
    total,
    ms: { mean: Math.round((total / steady.length) * 1000) / 1000, p50: at(0.5), p95: at(0.95), max: at(1) },
  };
}

/** Frame rate and frame times, plus GPU times per frame when they were measured. */
function frameStats(times: { frame: number[]; gpu: number[] }) {
  const frame = timeStats(times.frame);
  return {
    frames: frame.count,
    fps: Math.round((frame.count / frame.total) * 10000) / 10,
    frameMs: frame.ms,
    ...(times.gpu.length ? { gpuMs: timeStats(times.gpu).ms } : {}),
  };
}

/** Pixel statistics of a PNG, decoded in the browser, to catch blank or single-color renders. */
function imageStats(page: Page, png: Buffer) {
  return page.evaluate(
    async (dataUrl) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, img.width, img.height);
      const colors = new Set<number>();
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < data.length; i += 4) {
        const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        sum += luma;
        sumSq += luma * luma;
        if (colors.size < 100000) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      }
      const n = data.length / 4;
      const mean = sum / n;
      return {
        width: img.width,
        height: img.height,
        distinctColors: colors.size,
        lumaMean: mean,
        lumaStdDev: Math.sqrt(sumSq / n - mean * mean),
      };
    },
    "data:image/png;base64," + png.toString("base64"),
  );
}

/**
 * Renders `frames` frames back to back with the development build's __advance hook, waits for the GPU to finish
 * them and returns the time per frame (ms). With the render scale pushed up, this is dominated by shader cost.
 */
function benchFrames(page: Page, frames: number) {
  return page.evaluate((frames) => {
    const advance = (window as { __advance?: (seconds: number, fps: number) => void }).__advance;
    const gl = document.querySelector<HTMLCanvasElement>("#view")?.getContext("webgl2");
    if (!advance || !gl) return null;
    const pixel = new Uint8Array(4);
    const run = (count: number) => {
      const start = performance.now();
      advance(count / 60, 60);
      const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
      return (performance.now() - start) / count;
    };
    run(10);
    return [run(frames), run(frames), run(frames)].sort((a, b) => a - b)[1];
  }, frames);
}

let server: PreviewServer | ViteDevServer | undefined;
let url = opts.url;
if (!url) {
  if (opts.dev) {
    server = await createServer({ logLevel: "warn", server: { host: "127.0.0.1", port: 4173, open: false } });
    await server.listen();
  } else {
    if (opts.build) await build({ logLevel: "warn" });
    server = await preview({ logLevel: "warn", preview: { host: "127.0.0.1", port: 4173, open: false } });
  }
  url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("vite did not report a URL");
}
url += opts.hash;

const browser = await chromium.launch({
  // Full Chromium in new headless mode; the separate headless shell does not use the GPU as reliably.
  channel: "chromium",
  headless: true,
  args: [
    "--ignore-gpu-blocklist",
    "--enable-gpu",
    "--enable-gpu-rasterization",
    ...angleFlags,
    ...(opts.perf ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []),
  ],
});
const consoleErrors: string[] = [];
let failure = "";
try {
  const cdp = await browser.newBrowserCDPSession();
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: opts.dev ? 1 : Number(opts.dpr),
    locale: opts.locale,
  });
  if (opts.dev) {
    // The development build takes its render scale from this global, ignoring the pixel budget.
    await page.addInitScript((dpr) => Object.assign(window, { __YUSI_DPR__: dpr }), Number(opts.dpr));
  }
  page.on("console", (msg) => msg.type() === "error" && consoleErrors.push(msg.text()));
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const gpuBefore = sampleNvidia();
  const started = performance.now();
  await page.goto(url, { waitUntil: "load" });
  // #loading swaps its spinner for the error text when boot fails.
  await page.waitForFunction(
    () =>
      document.body.classList.contains("ready") || document.getElementById("loading")?.querySelector("span") === null,
    undefined,
    { timeout: 60000 },
  );
  const readyMs = Math.round(performance.now() - started);
  for (const selector of opts.click) {
    if (selector.startsWith("wait:")) {
      await page.waitForTimeout(Number(selector.slice(5)));
    } else {
      await page.click(selector, { timeout: 5000 });
    }
  }
  const pourAt = opts.pour?.split(",").map(Number);
  if (pourAt) {
    await page.mouse.move(pourAt[0], pourAt[1]);
    await page.mouse.down();
  }
  const settleMs = Number(opts.settle);
  const [frameTimes, gpuDuring] = await Promise.all([
    measureFrames(page, settleMs, opts.perf),
    new Promise((resolve) => setTimeout(() => resolve(sampleNvidia()), settleMs / 2)),
  ]);
  if (pourAt && opts.release !== undefined) {
    await page.mouse.up();
    await page.mouse.move(pourAt[0] + 40, pourAt[1] + 10, { steps: 8 });
    await page.waitForTimeout(Number(opts.release));
  }
  const benchMs = opts.perf && opts.dev ? await benchFrames(page, 40) : null;
  const webgl = await readWebGLInfo(page);
  const bootError = await page.evaluate(() => {
    const loading = document.getElementById("loading");
    return loading && !loading.querySelector("span") ? loading.textContent : null;
  });

  await mkdir(path.dirname(outFile), { recursive: true });
  const png = await page.screenshot({ path: outFile });
  const image = await imageStats(page, png);

  const info = (await cdp.send("SystemInfo.getInfo")) as {
    gpu: { devices: { vendorString: string; deviceString: string }[]; featureStatus: Record<string, string> };
  };
  const hardware = webgl !== null && !SOFTWARE_RENDERER.test(webgl.renderer);

  const report = {
    url,
    browser: browser.version(),
    angle: opts.angle,
    viewport: { width, height, dpr: Number(opts.dpr) },
    locale: opts.locale,
    readyMs,
    uncapped: opts.perf,
    ...frameStats(frameTimes),
    ...(benchMs === null ? {} : { benchMs: Math.round(benchMs * 1000) / 1000 }),
    webgl,
    hardware,
    gpuDevices: info.gpu.devices.map((d) => `${d.vendorString} ${d.deviceString}`.trim()),
    featureStatus: info.gpu.featureStatus,
    nvidia: { before: gpuBefore, during: gpuDuring },
    image,
    bootError,
    consoleErrors,
    screenshot: outFile,
  };
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));

  if (bootError) failure = `the app failed to boot: ${bootError}`;
  else if (!webgl) failure = "no WebGL2 context on #view";
  else if (!hardware && !opts["allow-software"]) failure = `software renderer: ${webgl.renderer}`;
  else if (image.lumaStdDev < 2 || image.distinctColors < 64) failure = "the screenshot is blank";
} finally {
  await browser.close();
  await server?.close();
}

if (failure) {
  console.error(`render check failed: ${failure}`);
  process.exit(1);
}
console.log(`render check passed: ${outFile}`);
