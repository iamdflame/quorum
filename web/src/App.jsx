import React, { useEffect, useState } from "react";
import { usableWallets, connectWallet, describeEnvironment } from "./wallets.js";
import { WalletAccountV6, RpcProvider } from "starknet";
import { probeStrk20, shieldOnly, POOL_FEE_STRK, CONCLAVE, POOL } from "./strk20.js";
import Field from "./Field.jsx";

const RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const nf = new Intl.NumberFormat("en-US");

export default function App() {
  const [pool, setPool] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [probe, setProbe] = useState(null);
  const [amount, setAmount] = useState("10");
  const [status, setStatus] = useState(null);
  const [txHash, setTxHash] = useState(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}pool.json`).then((r) => r.json()).then(setPool).catch(() => {});
  }, []);

  /**
   * Forget everything about a previous connection.
   *
   * Clears any cached connection state this page put in localStorage.
   *
   * This cannot revoke the site's permission inside the extension; only the
   * wallet can do that. So it says so rather than implying a full reset.
   */
  async function onReset() {
    setWallet(null);
    setProbe(null);
    setTxHash(null);
    setStatus({ kind: "work", text: "Clearing…" });
    try {
      for (const k of Object.keys(localStorage)) {
        if (/^gsw-|starknet/i.test(k)) localStorage.removeItem(k);
      }
    } catch (err) {
      console.warn("[shoal] could not clear localStorage", err);
    }
    setStatus({
      kind: "ok",
      text: "Cleared. If Ready still auto-approves, remove this site under its " +
            "Connected apps — only the wallet can revoke that.",
    });
  }

  async function onConnect() {
    setStatus({ kind: "work", text: "Looking for a Starknet wallet…" });
    setProbe(null);
    try {
      const candidates = usableWallets();
      if (candidates.length === 0) {
        const env = describeEnvironment();
        console.warn("[shoal] no starknet-capable wallet", env);
        setStatus({
          kind: "error",
          text:
            `No Starknet wallet found. Wallet Standard reported ${env.total || "none"}` +
            `${env.names.length ? ` (${env.names.join(", ")})` : ""}, and no legacy Starknet ` +
            `object was injected on window${env.windowKeys.length ? ` (saw: ${env.windowKeys.join(", ")})` : ""}. ` +
            `If Ready is installed, reload the page — extensions attach on load, so one installed ` +
            `after this tab opened is invisible until refresh.`,
        });
        return;
      }

      // Prefer Ready when several are present; it is the wallet documented as
      // implementing the STRK20 methods.
      const chosen =
        candidates.find((w) => /ready|argent/i.test(w.name ?? "")) ?? candidates[0];

      setStatus({ kind: "work", text: `Waiting for ${chosen.name} to authorise this site…` });
      const { wallet: w, address } = await connectWallet(chosen);

      const provider = new RpcProvider({ nodeUrl: RPC });
      const account = new WalletAccountV6({ provider, walletProvider: w, address });

      setWallet({ account, name: w.name, address });
      setStatus({ kind: "work", text: "Checking whether this wallet speaks STRK20…" });
      const p = await probeStrk20(account);
      setProbe(p);
      setStatus(p.supported
        ? { kind: "ok", text: "Connected. This wallet can shield." }
        : { kind: "error", text: p.reason });
    } catch (err) {
      console.error("[shoal] connect failed", err);
      setStatus({ kind: "error", text: `Connect failed: ${String(err?.message ?? err).slice(0, 260)}` });
    }
  }

  async function onShield() {
    if (!wallet) return;
    setStatus({ kind: "work", text: "Wallet is proving the transaction. This takes a while." });
    setTxHash(null);
    try {
      const units = BigInt(Math.round(Number(amount) * 1e18));
      const actions = shieldOnly(units);
      const { call, proof } = await wallet.account.strk20PrepareInvoke(actions);
      const res = await wallet.account.executeWithProof(call, proof);
      setTxHash(res.transaction_hash);
      setStatus({ kind: "ok", text: "Submitted. It touches the pool, so it counts." });
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message ?? err).slice(0, 300) });
    }
  }

  const alonePct = pool ? Math.round((pool.alone / pool.cells) * 100) : null;

  return (
    <div className="axis">
      <header className="hero">
        <p className="eyebrow">STRK20 privacy pool · Starknet mainnet{pool ? ` · block ${nf.format(pool.block)}` : ""}</p>
        <h1 className="numeral">{pool ? pool.median.toFixed(0) : "–"}</h1>
        <p className="claim">The median user of a live privacy pool is hiding among <i>one person.</i></p>
        {pool && (
          <p className="sub">
            {nf.format(pool.cells)} cells measured. {nf.format(pool.alone)} of them — {alonePct}% —
            contain exactly one participant. The largest crowd anywhere in the pool is {pool.max.toFixed(0)}.
          </p>
        )}
      </header>

      {pool && <Field points={pool.points} />}

      <section>
        <p className="tick">Already linked</p>
        <h2>{nf.format(pool?.linkage?.notes ?? 0)} private notes are tied to a public address right now.</h2>
        <p>
          Every pool event is anonymous alone. But every event sharing a transaction hash was caused by
          one actor, and some of them name a public address in the clear. Join on transaction hash and
          the pool gives up its own linkage — no viewing key, no proof broken, no cryptography touched.
        </p>
        {pool?.linkage && (
          <div className="grid">
            <Stat n={nf.format(pool.linkage.addrs)} l="public addresses bound to notes" />
            <Stat n={nf.format(pool.linkage.notes)} l="notes attributable to an address" />
            <Stat n={nf.format(pool.linkage.byKind.binding.user)} l="deposits bound to note creation" />
            <Stat n={nf.format(pool.linkage.byKind.onboarding.user)} l="registrations beside a move" />
          </div>
        )}
      </section>

      <section>
        <p className="tick">Act</p>
        <h2>Shield into the pool.</h2>
        <p>
          A private transaction has to be proved, and the only question is who reaches the prover. Here it
          is your wallet, so this page needs nothing but an RPC URL — the mainnet proving-service URL is
          still unpublished, which blocks the SDK route for every team.
        </p>

        <div className="btnrow">
          <button className="btn" onClick={onConnect}>
            {wallet ? "Reconnect" : "Connect a wallet"}
          </button>
          <button className="btn ghost" onClick={onReset}>Reset connection</button>
        </div>
        {status && <p className={`status ${status.kind}`}>{status.text}</p>}

        {!wallet ? null : (
          <div className="panel">
            <div className="row"><span>wallet</span><b>{wallet.name}</b></div>
            <div className="row"><span>address</span><b className="mono">{wallet.address?.slice(0, 18)}…</b></div>
            <div className="row">
              <span>STRK20 support</span>
              <b className={probe?.supported ? "ok" : "warn"}>
                {probe === null ? "probing…" : probe.supported ? "yes" : "no"}
              </b>
            </div>

            {probe && !probe.supported && (
              <p className="note">
                {probe.reason} Both routes close at once when this happens: the SDK route on the missing
                prover URL, and this route on the wallet. A wallet implementing the STRK20 methods — the
                Ready extension does — is the way through.
              </p>
            )}

            {probe?.supported && (
              <>
                <label className="field">
                  <span>amount</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
                  <span className="unit">STRK</span>
                </label>
                <p className="note">
                  The pool charges {POOL_FEE_STRK.toString()} STRK per transaction on top of this, which is
                  what makes splitting for a bigger crowd a real trade rather than a free one.
                </p>
                <button className="btn" onClick={onShield}>Shield {amount} STRK</button>
              </>
            )}

            {txHash && (
              <p className="status ok">
                <a href={`https://voyager.online/tx/${txHash}`} target="_blank" rel="noreferrer">
                  {txHash.slice(0, 26)}… on Voyager
                </a>
              </p>
            )}
          </div>
        )}
      </section>

      <footer>
        <span>ConclaveMachine <a className="mono" href={`https://voyager.online/contract/${CONCLAVE}`} target="_blank" rel="noreferrer">{CONCLAVE.slice(0, 14)}…</a></span>
        <span>pool <a className="mono" href={`https://voyager.online/contract/${POOL}`} target="_blank" rel="noreferrer">{POOL.slice(0, 14)}…</a></span>
        <span><a href="https://github.com/iamdflame/shoal">github.com/iamdflame/shoal</a></span>
      </footer>
    </div>
  );
}

function Stat({ n, l }) {
  return (
    <div className="stat">
      <b>{n}</b>
      <span>{l}</span>
    </div>
  );
}
