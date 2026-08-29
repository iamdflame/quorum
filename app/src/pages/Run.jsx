import { useState } from "react";
import Reveal from "../components/Reveal.jsx";
import {
  createCampaign, pledge, fire, derivePledgeKey, defaultSpec,
  describeError, MACHINE_DISPLAY, POOL_FEE_STRK,
} from "../campaign.js";
import { RPC } from "../wallet.js";

/**
 * Run a campaign end to end, on mainnet.
 *
 * Four transactions in order: create, pledge, pledge, fire. Each is a real pool
 * transaction and each takes a while, because the wallet is generating a STARK
 * proof rather than hanging.
 *
 * The second pledge deliberately comes from the same wallet under a different
 * nonce. That is the sybil the fixed unit prices rather than forbids — the
 * contract cannot tell two wallets from one, so it charges a full unit either
 * way — and a campaign has to be testable by one person before it is trusted by
 * forty.
 */

const STEPS = [
  { key: "create", label: "Create the campaign", detail: "Opens it with a threshold of two, a one STRK unit, and a week to gather. Escrows nothing." },
  { key: "pledgeA", label: "Pledge (first)", detail: "One STRK into the pool, sealed behind a commitment. Nothing becomes visible." },
  { key: "pledgeB", label: "Pledge (second)", detail: "Reaches quorum. Still nothing is announced — no event carries a count." },
  { key: "fire", label: "Fire it", detail: "Permissionless: there is no secret. RefundAll moves no value; the set simply opens." },
];

export default function Run({ ctx }) {
  const [id, setId] = useState(() => `demo-${Math.floor(Date.now() / 1000) % 100000}`);
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(null);
  const [log, setLog] = useState([]);

  const wallet = ctx.wallet;
  const say = (t) => setLog((l) => [...l, t]);
  const done = (k) => Boolean(state[k]);

  async function head() {
    const r = await fetch(RPC, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_blockNumber", params: [] }),
    });
    return (await r.json()).result;
  }

  async function run(step) {
    if (!wallet) return say("Connect a wallet first.");
    setBusy(step);
    try {
      const chainId = "SN_MAIN";
      if (step === "create") {
        say(`Creating "${id}"…`);
        const { hash } = await createCampaign(wallet.account, defaultSpec(id, await head()), await head(), say);
        setState((s) => ({ ...s, create: hash }));
        say(`Created. ${hash}`);
      } else if (step === "pledgeA" || step === "pledgeB") {
        const nonce = step === "pledgeA" ? 0 : 1;
        say(`Deriving pledge key ${nonce} — sign the message, nothing is stored.`);
        const key = await derivePledgeKey(wallet.account, id, chainId, nonce);
        say("Pledging one STRK…");
        const hash = await pledge(wallet.account, id, 1_000_000_000_000_000_000n, key.commitment, say);
        setState((s) => ({ ...s, [step]: hash, [`${step}Key`]: key.secret }));
        say(`Pledged. ${hash}`);
      } else if (step === "fire") {
        say("Firing. No secret is required — anyone could do this.");
        const hash = await fire(wallet.account, id, [], say);
        setState((s) => ({ ...s, fire: hash }));
        say(`Fired. ${hash}`);
        ctx.setHeat(1);
      }
    } catch (err) {
      console.error("[quorum] step failed", err);
      say(`FAILED: ${describeError(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="eyebrow">Run it on mainnet</p>
          <h1 className="display" style={{ fontSize: "clamp(38px,5.4vw,74px)" }}>
            Four transactions.<br />One <em className="fire">real</em> campaign.
          </h1>
          <p className="lead" style={{ marginTop: 24, color: "var(--dim)" }}>
            Create, pledge, pledge, fire — against{" "}
            <a className="mono" href={`https://voyager.online/contract/${MACHINE_DISPLAY}`} target="_blank" rel="noreferrer">
              {MACHINE_DISPLAY.slice(0, 14)}…
            </a>{" "}
            on Starknet mainnet. Each costs {POOL_FEE_STRK.toString()} STRK in pool fees, and each is slow:
            the wallet is generating a STARK proof, not hanging.
          </p>
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap form-grid">
          <Reveal>
            <div>
              <label className="field" style={{ marginBottom: 30 }}>
                <span className="field-label mono">Campaign name</span>
                <input value={id} onChange={(e) => setId(e.target.value)} maxLength={31}
                  disabled={done("create")} />
                <span className="field-hint">
                  {done("create") ? "Fixed once created." : "Up to 31 characters. Must be unused."}
                </span>
              </label>

              <ol className="runsteps">
                {STEPS.map((s, i) => {
                  const prev = i === 0 || done(STEPS[i - 1].key);
                  return (
                    <li key={s.key} className={`runstep${done(s.key) ? " done" : ""}`}>
                      <span className="runstep-n mono">{done(s.key) ? "✓" : i + 1}</span>
                      <div>
                        <h3 className="sub">{s.label}</h3>
                        <p>{s.detail}</p>
                        {state[s.key] ? (
                          <a className="mono runstep-tx"
                            href={`https://voyager.online/tx/${state[s.key]}`}
                            target="_blank" rel="noreferrer">
                            {state[s.key].slice(0, 26)}… on Voyager
                          </a>
                        ) : (
                          <button className="btn-line" style={{ marginTop: 12 }}
                            disabled={!wallet || !prev || busy !== null}
                            onClick={() => run(s.key)}>
                            {busy === s.key ? "Proving…" : s.label}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <aside className="aside">
              <h3 className="sub">Log</h3>
              <div className="runlog mono">
                {log.length === 0
                  ? <span style={{ color: "var(--muted)" }}>Nothing yet.</span>
                  : log.map((l, i) => (
                      <div key={i} className={l.startsWith("FAILED") ? "runlog-fail" : ""}>{l}</div>
                    ))}
              </div>

              <h3 className="sub" style={{ marginTop: 30 }}>Before you start</h3>
              <p className="aside-note">
                You need <strong>Ready</strong> — it implements the STRK20 wallet methods where
                Braavos answers <span className="mono">not implemented</span> — with a registered
                viewing key and about <strong>30 STRK</strong>. Four transactions is
                {" "}{(POOL_FEE_STRK * 4n).toString()} STRK in fees; the two pledged STRK come back.
              </p>
              <p className="aside-note">
                Registration happens on your first shield <em>inside</em> Ready, not here. If a step
                fails with <span className="mono">NOT_REGISTERED</span>, that is what is missing.
              </p>
              <p className="aside-note">
                Both pledges come from this one wallet under different nonces. The contract cannot
                tell two wallets from one — that is why every pledge costs a full unit.
              </p>
            </aside>
          </Reveal>
        </div>
      </section>
    </>
  );
}
