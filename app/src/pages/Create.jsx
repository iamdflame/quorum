import { useMemo, useState } from "react";
import Reveal from "../components/Reveal.jsx";

const BLOCK_SECONDS = 1.7;
const DAY_BLOCKS = Math.ceil(86400 / BLOCK_SECONDS);

/**
 * The organiser's form.
 *
 * Deliberately shows the derived block deadline next to the human one. Block
 * time on Starknet is ~1.7s, not the 30s a lot of tooling still assumes, and a
 * campaign whose expiry is computed on the wrong constant closes seventeen times
 * too early — silently, in the one direction that looks like nobody wanted to join.
 */
export default function Create() {
  const [f, setF] = useState({
    name: "", statement: "", action: "", threshold: 5, days: 14, amount: "10",
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const blocks = useMemo(() => Math.round(Number(f.days || 0) * DAY_BLOCKS), [f.days]);
  const tooShort = blocks > 0 && blocks < Math.ceil(900 / BLOCK_SECONDS);
  const nameTooLong = f.name.length > 31;

  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="eyebrow">Start a campaign</p>
          <h1 className="display" style={{ fontSize: "clamp(38px,5.4vw,74px)" }}>
            Set the number.<br />Set the <em className="fire">deadline</em>.
          </h1>
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap form-grid">
          <Reveal>
            <form className="form" onSubmit={(e) => e.preventDefault()}>
              <label className="field">
                <span className="field-label mono">Campaign name</span>
                <input value={f.name} onChange={set("name")} placeholder="walkout-2026" maxLength={40} />
                <span className={`field-hint${nameTooLong ? " bad" : ""}`}>
                  {nameTooLong
                    ? `${f.name.length} characters — a Cairo short string holds 31.`
                    : "Stored on-chain as a short string. Up to 31 characters."}
                </span>
              </label>

              <label className="field">
                <span className="field-label mono">What are people committing to?</span>
                <textarea rows={3} value={f.statement} onChange={set("statement")}
                  placeholder="We will not accept the new contract." />
                <span className="field-hint">
                  Hashed on-chain, never published. The subject of a campaign is often more
                  dangerous than its participant list.
                </span>
              </label>

              <label className="field">
                <span className="field-label mono">What does firing do?</span>
                <textarea rows={2} value={f.action} onChange={set("action")}
                  placeholder="Each pledge funds one day of the strike fund." />
              </label>

              <div className="field-row">
                <label className="field">
                  <span className="field-label mono">Pledges needed</span>
                  <input type="number" min="2" value={f.threshold} onChange={set("threshold")} />
                  <span className="field-hint">Below two is not coordination.</span>
                </label>
                <label className="field">
                  <span className="field-label mono">Open for (days)</span>
                  <input type="number" min="1" value={f.days} onChange={set("days")} />
                  <span className={`field-hint${tooShort ? " bad" : ""}`}>
                    {blocks.toLocaleString()} blocks at 1.7s/block
                  </span>
                </label>
                <label className="field">
                  <span className="field-label mono">Pledge size (STRK)</span>
                  <input value={f.amount} onChange={set("amount")} inputMode="decimal" />
                  <span className="field-hint">Plus 6 STRK pool fee per action.</span>
                </label>
              </div>

              <button className="btn-primary" style={{ marginTop: 8 }} disabled>
                Open campaign — needs a prover
              </button>
            </form>
          </Reveal>

          <Reveal delay={120}>
            <aside className="aside">
              <h3 className="sub">What this will cost</h3>
              <dl className="cost">
                <div><dt>Opening the campaign</dt><dd className="mono">6 STRK</dd></div>
                <div><dt>Each pledge</dt><dd className="mono">6 STRK + the pledge</dd></div>
                <div><dt>Firing it</dt><dd className="mono">6 STRK</dd></div>
                <div><dt>Each refund, if it fails</dt><dd className="mono">6 STRK</dd></div>
              </dl>
              <p className="aside-note">
                The pool charges a flat fee per transaction, read live from
                <span className="mono"> get_fee_amount()</span>. Pledged value is never spent —
                it either settles or comes back.
              </p>

              <h3 className="sub" style={{ marginTop: 34 }}>Before you open one</h3>
              <p className="aside-note">
                <strong>Expiry cannot be changed.</strong> Once a campaign exists, its deadline
                is fixed. Set it long enough that people can hear about it, talk to each
                other, and decide — not long enough that the money is trapped if it stalls.
              </p>
              <p className="aside-note">
                <strong>Keep the fire secret.</strong> It is the only thing that can fire the
                campaign, and it is not recoverable. Losing it means the campaign expires and
                everyone is refunded — which is safe, but it is not what you wanted.
              </p>
            </aside>
          </Reveal>
        </div>
      </section>
    </>
  );
}
