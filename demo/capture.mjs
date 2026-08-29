/**
 * Record the live app at true 1080p.
 *
 * The build machine's panel is 1366x768, so an ordinary screen recording would
 * be upscaled and soft. This drives a headless Chrome at 1920x1080 over the
 * DevTools Protocol instead and captures its screencast, which is the same
 * footage a 1080p monitor would have produced.
 *
 * Deterministic frame-by-frame rather than a screencast. Headless Chrome only
 * drives the page's particle canvas at about 11fps, and a screencast of that
 * stretches every particle into a long streak while the scroll visibly stutters.
 * Freezing the canvas and stepping the scroll by hand costs the background its
 * twinkle and buys a scroll that is smooth at 30fps, which is by far the better
 * trade for footage whose job is to be read.
 *
 *   node demo/capture.mjs <name> <url> <seconds> [scrollTo] [prepJS]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const [name, url, secsRaw, scrollRaw, prep] = process.argv.slice(2);
if (!name || !url) { console.error("usage: capture.mjs <name> <url> <seconds> [scrollPx] [prepJS]"); process.exit(1); }
const seconds = Number(secsRaw ?? 8);
const scrollTo = Number(scrollRaw ?? 0);

const PORT = 9333 + Math.floor(Math.random() * 400);
const frameDir = `/tmp/claude-1000/-home-dflame-Documents-strk/f873b594-8958-4e61-a4d6-8ca272031589/scratchpad/frames-${name}`;
rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir, { recursive: true });

const chrome = spawn("google-chrome", [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  "--force-device-scale-factor=1", "--window-size=1920,1080",
  "--disable-features=CalculateNativeWinOcclusion",
  `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });

/** The debug endpoint is not up the instant the process is. */
async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not listening yet */ }
    await sleep(250);
  }
  throw new Error("chrome never exposed a debugging target");
}

const ws = new WebSocket(await target());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
};

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
await sleep(6500); // fonts, the chain read, and the reveal animations

if (prep) {
  // Consent banners and the like: dismissed before recording, not in shot.
  await send("Runtime.evaluate", { expression: prep, awaitPromise: true });
  await sleep(2200);
}

/*
 * Freeze the particle field. Everything after this point must therefore drive
 * its own motion - nothing on the page will animate itself again.
 */
await send("Runtime.evaluate", { expression: "window.requestAnimationFrame = () => 0;" });

const { result: doc } = await send("Runtime.evaluate", {
  expression: "document.documentElement.scrollHeight - innerHeight", returnByValue: true });
console.log(`  ${name}: scrollable ${doc.value}px`);

const FPS = 30;
const total = Math.round(seconds * FPS);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

for (let i = 0; i < total; i++) {
  if (scrollTo > 0) {
    // Hold still briefly at each end so the clip can be cut without a jump.
    const raw = Math.min(1, Math.max(0, (i / total - 0.10) / 0.78));
    await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${scrollTo} * ${ease(raw)})` });
  }
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 94 });
  writeFileSync(`${frameDir}/f${String(i).padStart(5, "0")}.jpg`, Buffer.from(data, "base64"));
}

ws.close();
chrome.kill();
console.log(`${name}: ${total} frames at ${FPS}fps -> ${frameDir}`);
