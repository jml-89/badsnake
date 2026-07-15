// Headless repro harness for rendering/deploy bugs. See CLAUDE.md.
//
//   npm run build && node scripts/repro.mjs
//
// Serves dist/ under the /badsnake/ GitHub Pages subpath, drives it in headless
// Chromium, captures console/errors/failed-requests/HTTP>=400, prints DOM+WebGL
// probes, and writes a screenshot. Requires `npm i -D playwright` once; Chromium
// itself is auto-detected (pre-installed in the web environment).
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "dist");
const SUBPATH = "/badsnake"; // must match the GitHub Pages project path
const OUT = join(HERE, "..", "repro.png");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

async function findChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  ].filter(Boolean);
  for (const c of candidates) {
    try { await access(c); return c; } catch { /* keep looking */ }
  }
  return undefined; // let Playwright use its own managed download
}

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]).replace(new RegExp("^" + SUBPATH), "");
  if (p.endsWith("/favicon.ico")) { res.writeHead(204); res.end(); return; } // browsers auto-request this; not a bug
  if (p === "" || p === "/") p = "/index.html";
  try {
    const file = join(DIST, normalize(p));
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
// REPRO_QUERY lets a caller drive the app's URL-param demo overrides (e.g.
// "3d=1&powerup=analog") so a specific power-up state can be screenshotted
// without playing up to it. REPRO_OUT overrides the screenshot path.
const query = process.env.REPRO_QUERY ? `?${process.env.REPRO_QUERY}` : "";
const url = `http://localhost:${server.address().port}${SUBPATH}/${query}`;
const outPath = process.env.REPRO_OUT ? process.env.REPRO_OUT : OUT;

const browser = await chromium.launch({
  executablePath: await findChromium(),
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

const logs = [];
page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => {
  // favicon.ico is auto-requested by the browser and not shipped — ignore the
  // expected 404 so it doesn't masquerade as the bug under investigation.
  if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) logs.push(`[http ${r.status()}] ${r.url()}`);
});

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500); // let the animation loop run a few frames

const info = await page.evaluate(() => {
  const app = document.getElementById("app");
  const canvas = document.querySelector("canvas");
  const gl = document.createElement("canvas").getContext("webgl2")
    || document.createElement("canvas").getContext("webgl");
  return {
    hasApp: !!app,
    appChildren: app ? app.children.length : -1,
    hasCanvas: !!canvas,
    canvasSize: canvas ? `${canvas.width}x${canvas.height}` : "none",
    webglSupported: !!gl,
  };
});

await page.screenshot({ path: outPath });
console.log("URL:      ", url);
console.log("DOM/GL:   ", JSON.stringify(info));
console.log("screenshot:", outPath, "  <-- LOOK AT THIS");
console.log(`logs (${logs.length}):\n` + (logs.join("\n") || "(none)"));

await browser.close();
server.close();
