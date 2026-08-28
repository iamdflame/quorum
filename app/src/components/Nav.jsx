import { useEffect, useState } from "react";
import { NavLink, Link } from "react-router-dom";

const LINKS = [
  { to: "/how", label: "How it works" },
  { to: "/campaigns", label: "Campaigns" },
  { to: "/create", label: "Start one" },
  { to: "/verify", label: "Verify" },
];

/** The mark: a ring of pledges, one of which closes it. */
export function Mark({ size = 22 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const x = 12 + Math.cos(a) * 8, y = 12 + Math.sin(a) * 8;
        const last = i === 7;
        return (
          <circle key={i} cx={x} cy={y} r={last ? 2.4 : 1.7}
            fill={last ? "var(--fire-500)" : "var(--cold-500)"} />
        );
      })}
    </svg>
  );
}

export default function Nav({ onConnect, wallet }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`nav${scrolled ? " scrolled" : ""}`}>
      <div className="nav-inner">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <Mark />
          <span className="brand-name">Quorum</span>
        </Link>

        <div className={`nav-links${open ? " open" : ""}`}>
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className="nav-link" onClick={() => setOpen(false)}>
              {l.label}
            </NavLink>
          ))}
        </div>

        <button className="nav-cta" onClick={onConnect}>
          {wallet ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "Connect"}
        </button>

        <button className="nav-burger" onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6">
            {open ? <><path d="M5 5l12 12" /><path d="M17 5L5 17" /></>
                  : <><path d="M3 7h16" /><path d="M3 15h16" /></>}
          </svg>
        </button>
      </div>
    </nav>
  );
}
