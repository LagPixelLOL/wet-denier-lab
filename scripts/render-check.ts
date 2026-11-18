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
 *   --settle <ms>       time to keep rendering after the page is ready (default 2000)
 *   --angle <backend>   ANGLE backend: vulkan, gl-egl or swiftshader (default vulkan)
 *   --out <file.png>    screenshot path (default render-check/render.png); the report goes next to it
 *   --allow-software    do not fail when the renderer is a software one
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";

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
    settle: { type: "string", default: "2000" },
    angle: { type: "string", default: "vulkan" },
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

/** Counts animation frames over `ms` while the app keeps rendering. */
function countFrames(page: Page, ms: number) {
  return page.evaluate(
    (ms) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const end = performance.now() + ms;
        const tick = (now: number) => {
          frames++;
          if (now < end) requestAnimationFrame(tick);
          else resolve(frames);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
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

let server: PreviewServer | undefined;
let url = opts.url;
if (!url) {
  if (opts.build) await build({ logLevel: "warn" });
  server = await preview({ logLevel: "warn", preview: { host: "127.0.0.1", port: 4173, open: false } });
  url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("vite preview did not report a URL");
}
url += opts.hash;

const browser = await chromium.launch({
  // Full Chromium in new headless mode; the separate headless shell does not use the GPU as reliably.
  channel: "chromium",
  headless: true,
  args: ["--ignore-gpu-blocklist", "--enable-gpu", "--enable-gpu-rasterization", ...angleFlags],
});
const consoleErrors: string[] = [];
let failure = "";
try {
  const cdp = await browser.newBrowserCDPSession();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(opts.dpr) });
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
  const settleMs = Number(opts.settle);
  const [frames, gpuDuring] = await Promise.all([
    countFrames(page, settleMs),
    new Promise((resolve) => setTimeout(() => resolve(sampleNvidia()), settleMs / 2)),
  ]);
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
    readyMs,
    fps: Math.round((frames / settleMs) * 10000) / 10,
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
