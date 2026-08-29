import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Reveal from "../components/Reveal.jsx";
import { RPC } from "../wallet.js";
import { getEventsPaged, feltToName, readCampaign, strk } from "../campaignRead.js";

const MACHINE = "0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7";
// starknet_keccak("Created")
const CREATED = "0x3d899d98fd273fdfb3ab9d667c9743f84081d8e2009d188f3ad6b0967260e8b";

/**
 * Live campaigns, read from the chain.
 *
 * There is no backend and no index: campaigns are `Created` events on the
 * machine, and this reads them directly. That matters more than convenience —
 * an index is a list of campaigns someone operates, and a list someone operates
 * is a list someone can be made to hand over.
 */
export default function Campaigns() {
  const [state, setState] = useState({ loading: true, campaigns: [], error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const head = await rpc("starknet_blockNumber", []);
        const events = await getEventsPaged({
          from_block: { block_number: Math.max(0, head - 900_000) },
          to_block: { block_number: head },
          address: MACHINE,
          keys: [[CREATED]],
          chunk_size: 100,
        });
        if (cancelled) return;

        // Newest first: a list of campaigns is read to find the live ones.
        const seen = [...events].reverse();

        // Each campaign's own answer, rather than what the creation event said
        // it would be. Phase and count both move after creation.
        const campaigns = await Promise.all(seen.map(async (e) => {
          const id = feltToName(e.keys[1]);
          const base = { id, raw: e.keys[1], block: e.block_number, tx: e.transaction_hash };
          try {
            const c = await readCampaign(e.keys[1]);
            return { ...base, ...c, met: c.count >= c.threshold };
          } catch {
            // A campaign that cannot be read is still a campaign that exists.
            return { ...base, phase: null };
          }
        }));
        if (!cancelled) setState({ loading: false, error: null, campaigns });
      } catch (err) {
        if (!cancelled) setState({ loading: false, campaigns: [], error: String(err?.message ?? err) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="eyebrow">Campaigns</p>
          <h1 className="display" style={{ fontSize: "clamp(38px,5.4vw,74px)" }}>
            What is open<br />right now.
          </h1>
          <p className="lead" style={{ marginTop: 24, color: "var(--dim)" }}>
            Read straight from the contract. There is no index and no backend —
            a list someone operates is a list someone can be made to hand over.
          </p>
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap">
          {state.loading && <p className="mono state-note">Reading the chain…</p>}

          {state.error && (
            <div className="panel-warn">
              <h3 className="sub">Could not reach the chain</h3>
              <p className="mono" style={{ fontSize: 13 }}>{state.error}</p>
            </div>
          )}

          {!state.loading && !state.error && state.campaigns.length === 0 && (
            <Reveal>
              <div className="empty">
                <h2 className="section" style={{ maxWidth: "18ch" }}>Nothing in the last 900,000 blocks.</h2>
                <p>
                  Campaigns are read from <span className="mono">Created</span> events on the
                  contract, so this is what the chain says rather than what an index remembers.
                  Anything older than that window is still on chain and still readable by id
                  from <Link to="/verify">Verify</Link>.
                </p>
                <Link to="/create" className="btn-primary" style={{ marginTop: 12, display: "inline-block" }}>
                  Open one
                </Link>
              </div>
            </Reveal>
          )}

          {state.campaigns.length > 0 && (
            <div className="campaign-grid">
              {state.campaigns.map((c, i) => (
                <Reveal key={c.tx} delay={i * 70}>
                  <Link to={`/campaigns/${c.id}`} className="campaign-card">
                    <span className="mono campaign-id">{c.id}</span>

                    {c.phase && (
                      <span className="camp-state-top" style={{ margin: "4px 0 0" }}>
                        <span className={`camp-badge${c.phase === "Fired" ? " on" : ""}`}>{c.phase}</span>
                        <span className={`camp-badge${c.met ? " on" : ""}`}>
                          {c.count} of {c.threshold}
                        </span>
                      </span>
                    )}

                    <span className="mono campaign-block">
                      {c.phase
                        ? `${strk(c.escrowed)} STRK escrowed · block ${c.block.toLocaleString()}`
                        : `block ${c.block.toLocaleString()}`}
                    </span>
                  </Link>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
  return j.result;
}
