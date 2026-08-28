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
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={`reveal${shown ? " in" : ""}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}
