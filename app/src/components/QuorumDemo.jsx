import { useEffect, useRef, useState } from "react";

/**
 * The mechanism, playable.
 *
 * Five slots. Commit to them in any order and nothing happens — no names, no
 * running total that identifies anyone, no way to tell who is already in. The
 * fifth commitment fires it, and only in that instant does anyone learn there
 * were five.
 *
 * That is the entire product, and it is the one thing a screenshot cannot
 * convey: the interesting state is the one where *nothing is happening*.
 */

const THRESHOLD = 5;
const SLOTS = 8;

export default function QuorumDemo({ onHeat }) {
  const [pledged, setPledged] = useState(() => new Set());
  const [fired, setFired] = useState(false);
  const [expired, setExpired] = useState(false);
  const ringRef = useRef(null);

  const count = pledged.size;
  const reached = count >= THRESHOLD;

  useEffect(() => {
    // Drive the page background from the demo, so the ignition is not confined
    // to a widget — the whole site warms.
    const h = fired ? 1 : expired ? 0.04 : 0.12 + (count / THRESHOLD) * 0.42;
    onHeat?.(Math.min(h, 1));
  }, [count, fired, expired, onHeat]);

  useEffect(() => {
    if (!reached || fired || expired) return;
    const t = setTimeout(() => setFired(true), 520);
    return () => clearTimeout(t);
  }, [reached, fired, expired]);

  function toggle(i) {
    if (fired || expired) return;
    setPledged((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function reset() {
    setPledged(new Set());
    setFired(false);
    setExpired(false);
  }

  return (
    <div className={`demo${fired ? " is-fired" : ""}${expired ? " is-expired" : ""}`}>
      <div className="demo-head">
        <span className="demo-label mono">
          {fired ? "quorum reached — fired"
            : expired ? "expired below quorum — everyone refunded"
            : "sealed · nothing is visible yet"}
        </span>
        <span className="demo-count mono">
          {fired || expired ? `${count} of ${THRESHOLD}` : "— of " + THRESHOLD}
        </span>
      </div>

      <div className="demo-ring" ref={ringRef}>
        {Array.from({ length: SLOTS }).map((_, i) => {
          const on = pledged.has(i);
          const a = (i / SLOTS) * Math.PI * 2 - Math.PI / 2;
          const x = 50 + Math.cos(a) * 36;
          const y = 50 + Math.sin(a) * 36;
          return (
            <button
              key={i}
              className={`slot${on ? " on" : ""}`}
              style={{ left: `${x}%`, top: `${y}%`, transitionDelay: `${i * 24}ms` }}
              onClick={() => toggle(i)}
              aria-pressed={on}
              aria-label={on ? `Withdraw pledge ${i + 1}` : `Pledge as person ${i + 1}`}
              disabled={fired || expired}
            />
          );
        })}
        <div className="demo-core">
          <span className="demo-core-num">{fired ? count : expired ? "0" : count === 0 ? "" : "?"}</span>
          <span className="demo-core-cap mono">
            {fired ? "committed" : expired ? "refunded" : count === 0 ? "pledge" : "sealed"}
          </span>
        </div>
      </div>

      <p className="demo-note">
        {fired
          ? "It fired. Only now does anyone learn how many there were — and still not who."
          : expired
          ? "The deadline passed below quorum. Every pledge went back, and nobody was ever named."
          : count === 0
          ? "Click the ring to pledge. Watch what the others can see."
          : `You have pledged. So, possibly, have others — the count stays hidden until quorum, so going first tells nobody anything.`}
      </p>

      <div className="demo-actions">
        <button className="btn-ghost" onClick={reset}>Reset</button>
        {!fired && !expired && (
          <button className="btn-ghost" onClick={() => setExpired(true)}>
            Let the deadline pass
          </button>
        )}
      </div>
    </div>
  );
}
