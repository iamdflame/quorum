import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Reveal from "../components/Reveal.jsx";
import { readCampaign, strk, MACHINE } from "../campaignRead.js";

/**
 * One campaign, read live from mainnet.
 *
 * This page needs no wallet, on purpose. Deciding whether to join is exactly the
 * moment a person is least willing to announce themselves, so requiring a
 * connection here would defeat the thing the project exists for. Only pledging
 * needs a prover, and that is said at the bottom rather than in place of the
 * campaign.
 */
export default function Campaign() {
  const { id } = useParams();
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const c = await readCampaign(id);
        if (live) setState({ status: "ok", c });
      } catch (e) {
        if (live) setState({ status: "error", error: String(e?.message ?? e) });
      }
    };
    load();
    // Phase and pledge count both change under you while the page is open.
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, [id]);

  const c = state.c;
  const met = c && c.count >= c.threshold;

  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="eyebrow">Campaign</p>
          <h1 className="display mono" style={{ fontSize: "clamp(22px,3.2vw,40px)", wordBreak: "break-all" }}>{id}</h1>
          {state.status === "ok" && c.phase !== "Void" && (
            <p className="lead" style={{ marginTop: 20, color: "var(--dim)" }}>
              Read from Starknet mainnet a moment ago. Nothing here is stored by this app —
              every number below is the contract's own answer.
            </p>
          )}
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap-narrow">

          {state.status === "loading" && (
            <p className="mono" style={{ color: "var(--muted)" }}>Reading the chain…</p>
          )}

          {state.status === "error" && (
            <div className="panel-warn">
              <h3 className="sub">Could not reach a node</h3>
              <p className="mono" style={{ fontSize: 13 }}>{state.error}</p>
            </div>
          )}

          {state.status === "ok" && c.phase === "Void" && (
            <div className="empty">
              <h2 className="section" style={{ maxWidth: "20ch" }}>No campaign under that name.</h2>
              <p>
                The contract returns <span className="mono">Phase::Void</span> — every field zero.
                That is a real answer rather than an error: nothing has ever been opened under
                this id.
              </p>
              <Link className="btn-line" to="/campaigns">Back to campaigns</Link>
            </div>
          )}

          {state.status === "ok" && c.phase !== "Void" && (
            <>
              <Reveal>
                <div className={`camp-state${c.phase === "Fired" ? " is-fired" : ""}`}>
                  <div className="camp-state-top">
                    <span className={`camp-badge${c.phase === "Fired" ? " on" : ""}`}>{c.phase}</span>
                    <span className={`camp-badge${met ? " on" : ""}`}>
                      {met ? "Quorum met" : "Quorum not yet met"}
                    </span>
                    <span className="camp-badge">{c.policy}</span>
                  </div>
                  <p className="camp-state-num">{c.count} <span className="of">of</span> {c.threshold}</p>
                  <p className="camp-state-cap">
                    {c.phase === "Fired"
                      ? "Fired. The threshold was reached and the campaign executed — and the chain records that it happened without recording who made it happen."
                      : met
                        ? "Enough people agreed. Anyone can fire it now: firing is permissionless and needs no secret, so the organiser cannot hold a met quorum hostage."
                        : `${c.threshold - c.count} more before anything can move.`}
                  </p>
                </div>
              </Reveal>

              <Reveal>
                <dl className="verify-grid">
                  <div><dt>Phase</dt><dd className="mono">{c.phase}</dd></div>
                  <div><dt>Payout policy</dt><dd className="mono">{c.policy}</dd></div>
                  <div><dt>Escrowed</dt><dd className="mono">{strk(c.escrowed)} STRK</dd></div>
                  <div><dt>Unit per pledge</dt><dd className="mono">{strk(c.unit)} STRK</dd></div>
                  <div><dt>Threshold</dt><dd className="mono">{c.threshold}</dd></div>
                  <div><dt>Expiry block</dt><dd className="mono">{c.expiry.toLocaleString()}</dd></div>
                  <div className="wide"><dt>Pledge root</dt><dd className="mono break">{c.root}</dd></div>
                  {c.policy === "BoundTreasury" && (
                    <div className="wide">
                      <dt>Payout root, committed at creation</dt>
                      <dd className="mono break">{c.payoutRoot}</dd>
                    </div>
                  )}
                </dl>
              </Reveal>

              <Reveal>
                <div className="camp-after">
                  <p>
                    <strong>What this does not say.</strong> There is no list of pledgers here
                    because the contract never had one. Every pledge is the same size, so the
                    count is the whole public record — countable, not attributable.
                  </p>
                  <div className="camp-links">
                    <a className="btn-line" href={`https://voyager.online/contract/${MACHINE}`}
                       target="_blank" rel="noreferrer">See the contract on Voyager</a>
                    <Link className="btn-line" to="/verify">Verify it independently</Link>
                  </div>
                </div>
              </Reveal>

              <Reveal>
                <div className="aside-note" style={{ marginTop: 30 }}>
                  Reading works from any node. <em className="fire">Pledging</em> is a private pool
                  transaction and carries a zero-knowledge proof, so it needs a wallet that
                  implements the STRK20 methods — Ready does, Braavos answers{" "}
                  <span className="mono">not implemented</span>.
                </div>
              </Reveal>
            </>
          )}
        </div>
      </section>
    </>
  );
}
