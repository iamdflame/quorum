import { useEffect, useRef } from "react";

/**
 * The background.
 *
 * Not decoration. The protocol's whole feeling is that other people are there
 * and you cannot see them — so the field renders presences that are sensed
 * rather than resolved: each one is below the threshold of being an individual,
 * and what you read is the crowd.
 *
 * `heat` is the campaign state, 0 to 1. Cold and blue-grey below quorum, warm
 * and alight above it. The page is literally colder before enough people commit,
 * which is the one thing the design has to communicate before any words do.
 */

/* Cheap value-noise. A full simplex implementation is overkill for a flow field
   that only needs to be smooth and non-repeating at this scale. */
function makeNoise(seed = 1337) {
  const p = new Uint8Array(512);
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);

  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v,
    );
  };
}

export default function PresenceField({ heat = 0, density = 1 }) {
  const ref = useRef(null);
  const heatRef = useRef(heat);
  heatRef.current = heat;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const noise = makeNoise();

    let W = 0, H = 0, dpr = 1, raf = 0, t = 0;
    let particles = [];
    // Eased so a change in campaign state is felt as a swell rather than a switch.
    let shownHeat = heat;
    const pointer = { x: -9999, y: -9999, active: false };

    function build() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Scale count to area so a phone is not asked to draw a laptop's field.
      const target = Math.round(Math.min(720, (W * H) / 2600) * density);
      particles = Array.from({ length: target }, () => spawn());
    }

    const spawn = (atEdge = false) => ({
      x: Math.random() * W,
      y: atEdge ? H + 20 : Math.random() * H,
      // Lifetime staggered so the field never pulses in unison.
      life: Math.random(),
      decay: 0.0009 + Math.random() * 0.0022,
      size: 0.6 + Math.random() * 1.7,
      drift: 0.55 + Math.random() * 0.9,
      seed: Math.random() * 1000,
    });

    build();
    const onResize = () => build();
    addEventListener("resize", onResize, { passive: true });

    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.active = true;
    };
    const onLeave = () => { pointer.active = false; pointer.x = pointer.y = -9999; };
    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("pointerleave", onLeave, { passive: true });

    function frame() {
      t += reduced ? 0 : 0.0016;
      shownHeat += (heatRef.current - shownHeat) * 0.035;
      const h = shownHeat;

      // Trails rather than a hard clear: presences leave a wake, which is what
      // makes the field read as continuous rather than as dots.
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(11, 10, 8, 0.088)";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      for (const p of particles) {
        // Curl-ish flow: sample the field at two offsets and move along the
        // perpendicular, which produces the swirling that straight gradient
        // following never does.
        const nx = noise(p.x * 0.0016 + t, p.y * 0.0016 - t * 0.6);
        const ny = noise(p.x * 0.0016 - t * 0.4, p.y * 0.0016 + t);
        const angle = (nx + ny) * Math.PI * 1.7;

        let vx = Math.cos(angle) * p.drift;
        let vy = Math.sin(angle) * p.drift - 0.14; // a slow upward bias, like heat

        if (pointer.active) {
          const dx = p.x - pointer.x, dy = p.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 34000) {
            // Presence is felt, not touched: the field parts around the cursor
            // rather than following it.
            const f = (1 - d2 / 34000) * 1.5;
            vx += (dx / (Math.sqrt(d2) + 0.001)) * f;
            vy += (dy / (Math.sqrt(d2) + 0.001)) * f;
          }
        }

        p.x += vx; p.y += vy;
        p.life -= p.decay;

        if (p.life <= 0 || p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) {
          Object.assign(p, spawn(true));
          continue;
        }

        // Brightness peaks mid-life so nothing appears or vanishes abruptly.
        const fade = Math.sin(p.life * Math.PI);
        const alpha = fade * (0.16 + h * 0.42);
        const size = p.size * (1 + h * 0.85);

        // Cold grey-blue below quorum; amber above. The colour is the state.
        const r = Math.round(120 + h * 106);
        const g = Math.round(126 + h * -20);
        const b = Math.round(140 + h * -114);

        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 5.5);
        glow.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
        glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 5.5, 0, 6.2832);
        ctx.fill();

        if (h > 0.55) {
          // Only once the crowd exists do individuals resolve at all.
          ctx.fillStyle = `rgba(255, 214, 168, ${(h - 0.55) * fade * 0.5})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, size * 0.5, 0, 6.2832);
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(frame);
    }
    frame();

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerleave", onLeave);
    };
  }, [density]);

  return <canvas ref={ref} className="presence-field" aria-hidden="true" />;
}
