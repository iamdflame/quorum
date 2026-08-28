import { useParams, Link } from "react-router-dom";

export default function Campaign() {
  const { id } = useParams();
  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="eyebrow">Campaign</p>
          <h1 className="display mono" style={{ fontSize: "clamp(22px,3.2vw,40px)", wordBreak: "break-all" }}>{id}</h1>
        </div>
      </section>
      <hr className="rule" />
      <section className="band">
        <div className="wrap-narrow">
          <div className="empty">
            <h2 className="section" style={{ maxWidth: "20ch" }}>Pledging needs a proving service.</h2>
            <p>
              Reading a campaign works from any node. Pledging into one is a private pool
              transaction, and every private transaction carries a zero-knowledge proof.
            </p>
            <p>
              The wallet route reaches a prover for you, and that is the path this app takes —
              but it needs a wallet that implements the STRK20 methods. Ready does. Braavos
              answers <span className="mono">not implemented</span>. The SDK route needs a
              mainnet proving-service URL, which is not published; it is
              {" "}<a href="https://github.com/starkience/strk20-hackathon/issues/121" target="_blank" rel="noreferrer">
              the one blocker no team can work around</a>.
            </p>
            <Link to="/campaigns" className="btn-line" style={{ marginTop: 12, display: "inline-block" }}>
              Back to campaigns
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
