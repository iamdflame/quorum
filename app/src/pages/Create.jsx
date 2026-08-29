import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Reveal from "../components/Reveal.jsx";
import { createCampaign, describeError, MACHINE_DISPLAY, STRK, POOL_FEE_STRK } from "../campaign.js";
import { RPC } from "../wallet.js";
import { blocksFor, DAY, humanDuration } from "quorum-protocol";

/**
 * The organiser's form.
 *
 * It shows the derived block deadline beside the human one on purpose. Starknet
 * produces a block every ~1.7s, not the 30s much tooling still assumes, and a
 * campaign whose expiry was computed on the wrong constant closes seventeen
 * times too early — silently, in the one direction that looks exactly like
 * nobody wanted to join. Expiry cannot be changed after creation.
 */
export default function Create({ ctx }) {
  const nav = useNavigate();
  const [f, setF] = useState({
    name: "", statement: "", action: "", threshold: 2, days: 7, unit: "1",
    // A window in days cannot express a campaign short enough to watch expire.
    // The contract's floor is 530 blocks, about fifteen minutes.
    windowUnit: "days",
    policy: "RefundAll",
    // Where a treasury campaign's money goes, fixed here and checked at fire
    // time. One note id per line: "note-id 1.5".
    payouts: "",
  });
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [hash, setHash] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const say = (t) => setLog((l) => [...l, t]);

  const SPAN = { minutes: 60, hours: 3600, days: DAY };
  const blocks = useMemo(
    () => blocksFor(Number(f.days || 0) * (SPAN[f.windowUnit] ?? DAY)),
    [f.days, f.windowUnit],
  );

  /* "note-id 1.5" per line -> the payout set, in wei. */
  const payouts = useMemo(() => {
    if (f.policy !== "BoundTreasury") return [];
    return f.payouts.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
      const i = line.lastIndexOf(" ");
      const noteId = (i < 0 ? line : line.slice(0, i)).trim();
      const amount = Number(i < 0 ? 0 : line.slice(i + 1));
      return { noteId, amount, token: STRK, valid: noteId.length > 0 && noteId.length <= 31 && amount > 0 };
    });
  }, [f.policy, f.payouts]);
  const nameTooLong = f.name.length > 31;
  const threshold = Math.max(0, Math.floor(Number(f.threshold) || 0));
  const unit = Number(f.unit) || 0;

  // What the whole campaign will cost, rather than a per-action figure the
  // organiser has to multiply in their head while deciding.
  const fees = Number(POOL_FEE_STRK) * (2 + threshold);
  const pledged = unit * threshold;

  const problems = [];
  if (!f.name.trim()) problems.push("Give the campaign a name.");
  if (nameTooLong) problems.push(`The name is ${f.name.length} characters; 31 is the limit.`);
  if (!f.statement.trim()) problems.push("Say what people are committing to.");
  if (threshold < 2) problems.push("A threshold below two fires on the first pledge.");
  if (unit <= 0) problems.push("Every pledge must be a positive, identical amount.");
  if (blocks < 530) problems.push("The contract's floor is 530 blocks — about fifteen minutes.");
  if (f.policy === "BoundTreasury") {
    if (payouts.length === 0) {
      problems.push("A treasury campaign must name its destinations before anyone pledges.");
    } else if (payouts.some((p) => !p.valid)) {
      problems.push("Each payout line is a note id, a space, then an amount — \"strike-fund 2\".");
    } else {
      const total = payouts.reduce((s, p) => s + p.amount, 0);
      // The contract refuses a payout set that does not equal the escrow, so
      // catching it here saves a campaign that can reach quorum and never fire.
      if (Math.abs(total - pledged) > 1e-9) {
        problems.push(`Payouts total ${total} STRK but a quorum escrows exactly ${pledged}.`);
      }
    }
  }

  async function onCreate() {
    if (!ctx.wallet) return say("Connect a wallet first.");
    setBusy(true); setLog([]); setHash(null);
    try {
      const r = await fetch(RPC, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_blockNumber", params: [] }),
      });
      const head = (await r.json()).result;

      const spec = {
        id: f.name.trim(),
        terms: {
          statement: f.statement.trim(),
          action: f.action.trim() || "Reaching quorum opens the set to the people in it.",
        },
        token: STRK,
        unit: BigInt(Math.round(unit * 1e18)),
        threshold,
        expiryBlock: head + blocks,
        // Either mode, but a treasury campaign's destinations are fixed here and
        // checked against the committed root when it fires - so filling in this
        // form is the only moment anyone chooses where the money goes.
        policy: f.policy === "BoundTreasury"
          ? {
              kind: "BoundTreasury",
              payouts: payouts.map((p) => ({
                noteId: p.noteId, token: STRK, amount: BigInt(Math.round(p.amount * 1e18)),
              })),
            }
          : { kind: "RefundAll" },
      };
      const { hash } = await createCampaign(ctx.wallet.account, spec, head, "SN_MAIN", say);
      setHash(hash);
      say(`Created. ${hash}`);
    } catch (err) {
      console.error("[quorum] create failed", err);
      say(`FAILED: ${describeError(err)}`);
    } finally { setBusy(false); }
  }

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
            <form className="form" onSubmit={(e) => { e.preventDefault(); onCreate(); }}>
              <label className="field">
                <span className="field-label mono">Campaign name</span>
                <input value={f.name} onChange={set("name")} placeholder="walkout-2026" maxLength={40} />
                <span className={`field-hint${nameTooLong ? " bad" : ""}`}>
                  {nameTooLong
                    ? `${f.name.length} characters — a Cairo short string holds 31.`
                    : "Stored on-chain as a short string. Must be unused."}
                </span>
              </label>

              <label className="field">
                <span className="field-label mono">What are people committing to?</span>
                <textarea rows={3} value={f.statement} onChange={set("statement")}
                  placeholder="We will not accept the new contract." />
                <span className="field-hint">
                  Hashed on-chain, never published. A campaign's subject is often more dangerous
                  than its participant list.
                </span>
              </label>

              <label className="field">
                <span className="field-label mono">What does reaching quorum do?</span>
                <textarea rows={2} value={f.action} onChange={set("action")}
                  placeholder="Opens the set to the people in it. No value moves." />
                <span className="field-hint">
                  {f.policy === "RefundAll"
                    ? "Refund-all: nothing can be paid anywhere, so quorum only opens the set."
                    : "Treasury: reaching quorum pays exactly the destinations below, and nothing else."}
                </span>
              </label>

              <label className="field">
                <span className="field-label mono">What happens to the money</span>
                <select value={f.policy} onChange={set("policy")}>
                  <option value="RefundAll">Refund all — nothing moves, ever</option>
                  <option value="BoundTreasury">Treasury — pay a set fixed now</option>
                </select>
                <span className="field-hint">
                  Both are safe for the same reason: the destinations are decided here, before
                  anyone pledges, and checked against a committed root when the campaign fires.
                  Whoever fires it cannot change them — including you.
                </span>
              </label>

              {f.policy === "BoundTreasury" && (
                <label className="field">
                  <span className="field-label mono">Where the money goes</span>
                  <textarea rows={3} value={f.payouts} onChange={set("payouts")}
                    placeholder={"strike-fund 2\nlegal-costs 2"} />
                  <span className="field-hint">
                    One per line: a note id, a space, an amount in STRK. They must total exactly{" "}
                    <span className="mono">{pledged}</span> STRK — what a full quorum escrows — or
                    the campaign could reach quorum and never be fireable.
                  </span>
                </label>
              )}

              <div className="field-row">
                <label className="field">
                  <span className="field-label mono">Pledges needed</span>
                  <input type="number" min="2" value={f.threshold} onChange={set("threshold")} />
                  <span className="field-hint">Two is the minimum that is coordination.</span>
                </label>
                <label className="field">
                  <span className="field-label mono">Open for</span>
                  <div className="field-pair">
                    <input type="number" min="1" value={f.days} onChange={set("days")} />
                    <select value={f.windowUnit} onChange={set("windowUnit")}>
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                    </select>
                  </div>
                  <span className="field-hint">
                    {blocks.toLocaleString()} blocks — {humanDuration(blocks)}. Measured from the
                    chain at 1.7s a block, not assumed.
                  </span>
                </label>
                <label className="field">
                  <span className="field-label mono">Pledge size (STRK)</span>
                  <input value={f.unit} onChange={set("unit")} inputMode="decimal" />
                  <span className="field-hint">Every pledge is exactly this.</span>
                </label>
              </div>

              {problems.length > 0 && (
                <ul className="problems">
                  {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}

              <button className="btn-primary" disabled={busy || problems.length > 0 || !ctx.wallet}>
                {busy ? "Proving…" : !ctx.wallet ? "Connect a wallet first" : "Open the campaign"}
              </button>

              {log.length > 0 && (
                <div className="runlog mono" style={{ marginTop: 18 }}>
                  {log.map((l, i) => (
                    <div key={i} className={l.startsWith("FAILED") ? "runlog-fail" : ""}>{l}</div>
                  ))}
                </div>
              )}

              {hash && (
                <p className="status ok" style={{ marginTop: 14 }}>
                  <a href={`https://voyager.online/tx/${hash}`} target="_blank" rel="noreferrer">
                    {hash.slice(0, 28)}… on Voyager
                  </a>
                  {" · "}
                  <a onClick={() => nav("/run")} style={{ cursor: "pointer" }}>now pledge into it →</a>
                </p>
              )}
            </form>
          </Reveal>

          <Reveal delay={120}>
            <aside className="aside">
              <h3 className="sub">What this campaign will cost</h3>
              <dl className="cost">
                <div><dt>Create</dt><dd className="mono">{POOL_FEE_STRK.toString()} STRK</dd></div>
                <div><dt>{threshold} pledges</dt><dd className="mono">{Number(POOL_FEE_STRK) * threshold} STRK fees</dd></div>
                <div><dt>Fire</dt><dd className="mono">{POOL_FEE_STRK.toString()} STRK</dd></div>
                <div><dt><strong>Fees in total</strong></dt><dd className="mono"><strong>{fees} STRK</strong></dd></div>
                <div><dt>Pledged, refundable</dt><dd className="mono">{pledged} STRK</dd></div>
              </dl>
              <p className="aside-note">
                Pledged value is never spent — a refund-all campaign cannot move it, so it comes
                back whether the quorum is reached or not. Only the fees are gone.
              </p>

              <h3 className="sub" style={{ marginTop: 32 }}>Two things that cannot be undone</h3>
              <p className="aside-note">
                <strong>Expiry is fixed.</strong> Set it long enough that people can hear about
                the campaign and decide, and short enough that money is not trapped if it stalls.
              </p>
              <p className="aside-note">
                <strong>The name is permanent</strong> and must be unused. Reusing one reverts with
                <span className="mono"> id already used</span>.
              </p>
              <p className="aside-note">
                There is no fire secret. Once the quorum is met, <strong>anyone</strong> can fire
                it — so there is no key for you to lose and none for anyone to steal.
              </p>
            </aside>
          </Reveal>
        </div>
      </section>
    </>
  );
}
