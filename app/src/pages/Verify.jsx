import { useState } from "react";
import Reveal from "../components/Reveal.jsx";
import { readCampaign } from "../campaignRead.js";

/**
 * Independent verification.
 *
 * A participant hands money to a contract on two claims: that the quorum was
 * really reached, and that what fired is what they agreed to. Both are checkable
 * from public data, and neither should require trusting the organiser — who is
 * exactly the party with a motive to lie, and often the one under most pressure.
 */
export default function Verify() {
  const [id, setId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function check(e) {
    e.preventDefault();
    setBusy(true); setResult(null);
    try {
      setResult({ ok: true, ...(await readCampaign(id)) });
    } catch (err) {
      setResult({ ok: false, error: String(err?.message ?? err) });
    } finally { setBusy(false); }
  }

  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="eyebrow">Verify</p>
          <h1 className="display" style={{ fontSize: "clamp(38px,5.4vw,74px)" }}>
            Don't trust the<br />organiser. <em className="fire">Check.</em>
          </h1>
          <p className="lead" style={{ marginTop: 24, color: "var(--dim)" }}>
            Everything a campaign claims is checkable from public chain data — by a
            participant, a journalist, or the employer on the other side of it. The claim
            is verifiable <em className="fire">because</em> the identities are not.
          </p>
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap-narrow">
          <Reveal>
            <form className="form" onSubmit={check}>
              <label className="field">
                <span className="field-label mono">Campaign name or id</span>
                <input value={id} onChange={(e) => setId(e.target.value)} placeholder="walkout-2026" />
              </label>
              <button className="btn-primary" disabled={busy || !id.trim()}>
                {busy ? "Reading the chain…" : "Read the campaign"}
              </button>
            </form>
          </Reveal>

          {result && !result.ok && (
            <div className="panel-warn" style={{ marginTop: 32 }}>
              <h3 className="sub">Could not read it</h3>
              <p className="mono" style={{ fontSize: 13 }}>{result.error}</p>
            </div>
          )}

          {result?.ok && (
            <div className="verify-out" style={{ marginTop: 32 }}>
              {result.phase === "Void" ? (
                <>
                  <h3 className="sub">No campaign under that name</h3>
                  <p>
                    The contract returns <span className="mono">Phase::Void</span> — every field
                    zero. That is a real answer, not an error: nothing has ever been opened
                    under this id.
                  </p>
                </>
              ) : (
                <dl className="verify-grid">
                  <div><dt>Phase</dt><dd className="mono">{result.phase}</dd></div>
                  <div><dt>Payout policy</dt><dd className="mono">{result.policy}</dd></div>
                  <div><dt>Pledges</dt><dd className="mono">{result.count}</dd></div>
                  <div><dt>Unit</dt><dd className="mono">{result.unit.toString()}</dd></div>
                  <div><dt>Threshold</dt><dd className="mono">{result.threshold}</dd></div>
                  <div><dt>Quorum reached</dt><dd className="mono">{result.count >= result.threshold ? "yes" : "not yet"}</dd></div>
                  <div><dt>Escrowed</dt><dd className="mono">{result.escrowed.toString()}</dd></div>
                  <div><dt>Expiry block</dt><dd className="mono">{result.expiry.toLocaleString()}</dd></div>
                  <div className="wide"><dt>Pledge root</dt><dd className="mono break">{result.root}</dd></div>
                  {result.policy === "BoundTreasury" && (
                    <div className="wide"><dt>Committed payout root</dt><dd className="mono break">{result.payoutRoot}</dd></div>
                  )}
                </dl>
              )}
            </div>
          )}

          <Reveal>
            <div className="verify-explain">
              <h3 className="sub">What a full verification checks</h3>
              <ul className="check-list">
                <li>The pledge count on-chain matches the number of <span className="mono">Committed</span> events that exist.</li>
                <li>Those events are sequential, with no gaps — nothing inserted or removed.</li>
                <li>The accumulator replays exactly from the observed commitments, so the set was never reordered.</li>
                <li>Firing happened at or above the threshold. Seeing otherwise would mean the contract is not the one it claims to be.</li>
                <li>Payouts reproduce the root committed at creation — so the money went where the campaign said it would, and nowhere the organiser chose later.</li>
                <li>The document you were shown hashes to the terms committed when the campaign opened.</li>
              </ul>
              <p className="aside-note">
                It distinguishes <em className="fire">cannot verify</em> from
                <em className="fire"> verified false</em>. An observer holding no commitments
                cannot replay the root, and reporting that as a failure would make the whole
                report useless in the common case.
              </p>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
