import React, { useEffect, useRef } from "react";

/**
 * The measured pool, drawn.
 *
 * One point per real cell — an asset, a denomination, a six-hour window.
 * Solitary cells drift further and slower, visibly adrift; cells with a genuine
 * crowd hold station and thread together, because a crowd is what keeps you in
 * place. Nothing here is decorative: every coordinate comes from the scan.
 */
export default function Field({ points }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !points?.length) return;
    const ctx = cv.getContext("2d");
    const css = getComputedStyle(document.documentElement);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, t = 0, P = [], W = 0, H = 0;

    const lanes = [...new Set(points.map((p) => p.t))];
    const wmin = Math.min(...points.map((p) => p.w));
    const wmax = Math.max(...points.map((p) => p.w));

    function build() {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      P = points.map((p, i) => {
        const fx = (p.w - wmin) / Math.max(1, wmax - wmin);
        const fy = (lanes.indexOf(p.t) + 0.5) / lanes.length;
        const s1 = ((i * 2654435761) % 1000) / 1000;
        const s2 = ((i * 40503) % 997) / 997;
        const solo = p.e < 1.5;
        return {
          bx: fx * W * 1.04 - W * 0.02,
          by: fy * H * 0.8 + H * 0.1 + (s1 - 0.5) * (H * 0.1),
          x: 0, y: 0, ph: s1 * 6.283, sp: 0.25 + s2 * 0.5,
          amp: 4 + s2 * 9, solo, t: p.t, e: p.e,
          r: solo ? 1.5 : 1.9 + Math.min(p.e, 10) * 0.5,
        };
      });
    }
    build();
    const onResize = () => build();
    addEventListener("resize", onResize);

    const alone = css.getPropertyValue("--alone").trim();
    const crowd = css.getPropertyValue("--crowd").trim();

    function frame() {
      t += reduce ? 0 : 0.0055;
      ctx.clearRect(0, 0, W, H);
      for (const p of P) {
        const wander = p.solo ? p.amp : p.amp * 0.35;
        p.x = p.bx + Math.cos(t * p.sp + p.ph) * wander;
        p.y = p.by + Math.sin(t * p.sp * 0.82 + p.ph * 1.3) * wander * 0.62;
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < P.length; i++) {
        const a = P[i];
        if (a.solo) continue;
        for (let j = i + 1; j < P.length; j++) {
          const b = P[j];
          if (b.solo || b.t !== a.t) continue;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 104) {
            ctx.strokeStyle = crowd;
            ctx.globalAlpha = (1 - d / 104) * 0.2;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const p of P) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fillStyle = p.solo ? alone : crowd;
        ctx.globalAlpha = p.solo ? 0.5 : 0.8;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    frame();
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", onResize); };
  }, [points]);

  return <canvas ref={ref} className="field" aria-hidden="true" />;
}
