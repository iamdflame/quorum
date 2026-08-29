/**
 * Turn real captured command output into a terminal clip.
 *
 * The output is never retyped or invented — it is read from a file produced by
 * actually running the command, ANSI colours and all. A demo that fakes its
 * terminal is a demo that will be caught, and this project's whole argument is
 * that you should not have to take anyone's word for anything.
 *
 * Renders one PNG per revealed line and lets ffmpeg hold each for a beat, which
 * reads as output arriving rather than a wall of text appearing at once.
 *
 *   node demo/terminal.mjs <name> <textfile> "<command line>"
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [name, file, command] = process.argv.slice(2);
const scratch = "/tmp/claude-1000/-home-dflame-Documents-strk/f873b594-8958-4e61-a4d6-8ca272031589/scratchpad";
const dir = `${scratch}/term-${name}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

/* The 16-colour SGR codes the CLIs actually emit, mapped onto the brand. */
const SGR = {
  "0": null, "1": "b", "2": "dim",
  "31": "#E2661A", "32": "#7FB069", "33": "#D9A441",
  "36": "#6FA8B5", "90": "#6E6960",
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** ANSI -> spans. Only what these tools emit; anything else is dropped, not guessed. */
function ansiToHtml(line) {
  let out = "", open = 0;
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0, m;
  while ((m = re.exec(line)) !== null) {
    out += esc(line.slice(last, m.index));
    last = m.index + m[0].length;
    for (const code of m[1].split(";")) {
      if (code === "0" || code === "") { out += "</span>".repeat(open); open = 0; continue; }
      const v = SGR[code];
      if (v === "b") { out += `<span class="b">`; open++; }
      else if (v === "dim") { out += `<span class="dim">`; open++; }
      else if (v) { out += `<span style="color:${v}">`; open++; }
    }
  }
  out += esc(line.slice(last)) + "</span>".repeat(open);
  return out || "&nbsp;";
}

const lines = readFileSync(file, "utf8").replace(/\n+$/, "").split("\n");

const page = (shown, cursor) => `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="file://${process.cwd()}/cards/base.css">
<style>
.stage{padding:0;display:block}
.win{position:absolute;inset:56px 64px;border:1px solid var(--line);border-radius:10px;
  background:#0D0B09;display:flex;flex-direction:column;overflow:hidden;
  box-shadow:0 50px 120px -40px rgba(0,0,0,.9)}
.bar{height:52px;flex:none;display:flex;align-items:center;gap:11px;padding:0 22px;
  border-bottom:1px solid var(--line);background:#100E0B}
.dot{width:12px;height:12px;border-radius:50%;background:#2C251C}
.dot.r{background:#3a2a20}
.title{margin-left:16px;font-family:var(--mono);font-size:15px;color:var(--muted);letter-spacing:.06em}
.body{flex:1;padding:30px 34px;font-family:var(--mono);font-size:23px;line-height:1.62;
  color:#C9C4BC;white-space:pre-wrap;word-break:break-word}
.cmd{color:var(--text)}
.cmd .p{color:var(--fire)}
.b{font-weight:700;color:#E8E6E1}
.dim{color:var(--muted)}
.cur{display:inline-block;width:12px;height:24px;background:var(--fire);
  vertical-align:-4px;margin-left:3px;opacity:${cursor ? 1 : 0}}
</style>
<div class="win">
  <div class="bar"><span class="dot r"></span><span class="dot"></span><span class="dot"></span>
    <span class="title">quorum — bash</span></div>
  <div class="body"><div class="cmd"><span class="p">$</span> ${esc(command)}</div>
${shown.map(ansiToHtml).join("\n")}<span class="cur"></span></div>
</div>`;

/* One frame per revealed line, plus a beat on the bare prompt before output. */
const states = [[], ...lines.map((_, i) => lines.slice(0, i + 1))];
states.forEach((shown, i) => {
  writeFileSync(`${dir}/s${String(i).padStart(4, "0")}.html`, page(shown, i === 0));
  execFileSync("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--force-device-scale-factor=2", "--virtual-time-budget=3000",
    "--window-size=1920,1280",
    `--screenshot=${dir}/s${String(i).padStart(4, "0")}.raw.png`,
    `file://${dir}/s${String(i).padStart(4, "0")}.html`,
  ], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error",
    "-i", `${dir}/s${String(i).padStart(4, "0")}.raw.png`,
    "-vf", "crop=3840:2160:0:0,scale=1920:1080:flags=lanczos",
    `${dir}/f${String(i).padStart(4, "0")}.png`], { stdio: "ignore" });
});

console.log(`${name}: ${states.length} states -> ${dir}`);
