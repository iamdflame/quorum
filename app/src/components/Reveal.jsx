import { useEffect, useRef, useState } from "react";

/**
 * Reveal on scroll.
 *
 * Deliberately restrained — a short rise and fade, once, never replayed. Motion
 * that re-triggers as you scroll back up reads as a toy, and this subject cannot
 * afford to read as a toy.
 */
export default function Reveal({ children, delay = 0, as: Tag = "div" }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); io.disconnect(); }
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    io.observe(el);

    /*
     * Motion is an enhancement and must never be the thing that decides whether
     * content exists. If the observer has not fired shortly after mount - a
     * headless renderer, a prerender pass, an element shorter than the 15%
     * threshold in a small viewport - show it anyway. The failure this prevents
     * is the worst kind: a page reporting live chain state that is simply blank,
     * with no error to explain it.
     */
    const failsafe = setTimeout(() => setShown(true), 1200);
    return () => { io.disconnect(); clearTimeout(failsafe); };
  }, []);

  return (
    <Tag ref={ref} className={`reveal${shown ? " in" : ""}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}
