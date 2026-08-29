import { useCallback } from "react";
import { Link } from "react-router-dom";
import QuorumDemo from "../components/QuorumDemo.jsx";
import Reveal from "../components/Reveal.jsx";

const CASES = [
  { t: "Unionise", d: "You cannot sign a card publicly. The first names are the ones that get fired, and everyone knows it, so the card never circulates." },
  { t: "Report someone", d: "One accusation against a powerful person destroys the accuser. Two against the same person is a pattern. Nobody can be the one." },
  { t: "Boycott", d: "A boycott of one is a customer who left. A boycott of four hundred is leverage. Going first costs you and buys nothing." },
  { t: "Join a class action", d: "The first plaintiff is named in every filing, deposed, and remembered by every future employer in the industry." },
];

export default function Home({ ctx }) {
  const setHeat = useCallback((h) => ctx.setHeat(h), [ctx]);

  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Threshold coordination · Starknet mainnet</p>
            <h1 className="display">
              Nobody moves<br />until <em className="fire">enough of us</em> do.
            </h1>
            <p className="lead" style={{ marginTop: 28 }}>
              Pledge into a campaign and your pledge binds only once enough others have
              pledged too. If the quorum is never reached you get your money back,
              and you were never revealed.
            </p>
            <div className="hero-actions">
              <Link to="/create" className="btn-primary">Start a campaign</Link>
              <Link to="/how" className="btn-line">How it works</Link>
            </div>
            <p className="hero-foot mono">
              Live at <a href="https://voyager.online/contract/0x0079bab03056fd05dde50e921cf5ea8c3405aaaa2f05492a8a0e1fb6c811ff76"
                target="_blank" rel="noreferrer">0x06d3f070…8c08</a>
            </p>
          </div>

          <div className="hero-demo">
            <QuorumDemo onHeat={setHeat} />
          </div>
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">The problem</p>
            <h2 className="section">The first mover carries all the risk and gets none of the benefit.</h2>
            <p className="lead" style={{ color: "var(--dim)" }}>
              There is a class of action nobody can take alone. Not because it is hard,
              but because the payoff for going first is strictly negative — and everyone
              can see that, so nobody goes.
            </p>
          </Reveal>

          <div className="cases">
            {CASES.map((c, i) => (
              <Reveal key={c.t} delay={i * 90}>
                <article className="case">
                  <span className="case-num mono">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="sub">{c.t}</h3>
                  <p>{c.d}</p>
                </article>
              </Reveal>
            ))}
          </div>

          <Reveal>
            <p className="pull">
              Economists call this a collective action problem.
              <em className="fire"> Everyone else calls it Tuesday.</em>
            </p>
          </Reveal>
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap-narrow">
          <Reveal>
            <p className="eyebrow">Why a threshold changes it</p>
            <h2 className="section">If your commitment binds only when enough others have committed, going first costs nothing.</h2>
            <p>
              The mechanism is not new. Ian Ayres and Barry Nalebuff described
              <strong> information escrows</strong> for exactly this, and Callisto built one
              for campus assault reports that opens only when a second report names the
              same person.
            </p>
            <p>
              What has never existed is a way to run it where the escrow holds
              <strong> real money</strong>, the count is enforced by
              <strong> something other than trust</strong>, and
              <strong> nobody is exposed when it fails</strong>.
            </p>
          </Reveal>

          <div className="fail-grid">
            <Reveal delay={60}>
              <div className="fail">
                <h3 className="sub">On a public chain</h3>
                <p>Every pledge is public. The employer reads the list before it is long enough to protect anyone. The mechanism defeats itself.</p>
              </div>
            </Reveal>
            <Reveal delay={140}>
              <div className="fail">
                <h3 className="sub">On a server</h3>
                <p>The operator is a single point of coercion. A subpoena, a court order, a bribe, or one disgruntled engineer unmasks everyone at once.</p>
              </div>
            </Reveal>
            <Reveal delay={220}>
              <div className="fail on-pool">
                <h3 className="sub">On the pool</h3>
                <p>A pledge is an encrypted note. Value moves without naming who moved it, escrow is held by a contract rather than a company, and settlement is atomic.</p>
              </div>
            </Reveal>
          </div>

          <Reveal>
            <p className="pull" style={{ marginTop: 60 }}>
              The privacy is not a feature bolted onto a coordination app.
              <em className="fire"> Remove it and there is no product, because there is no coordination.</em>
            </p>
          </Reveal>
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">What the contract enforces</p>
            <h2 className="section">A promise is only worth what breaks if it is false.</h2>
            <p style={{ maxWidth: "58ch", marginBottom: 44 }}>
              Everything rests on one sentence said to someone deciding whether to risk
              their job: <strong>if the quorum is not reached, you get your money back and
              you are never revealed.</strong> So the contract enforces it, rather than
              promising it.
            </p>
          </Reveal>
          <div className="guarantees">
            {[
              ["Cannot fire below quorum", "Not “should not”. The transaction reverts."],
              ["Cannot fire late", "Once expired, refunds are the only path. An organiser cannot sit on a signed list as leverage."],
              ["Cannot create value", "Payouts sum to exactly what was escrowed, in the token escrowed."],
              ["Cannot withdraw early", "Otherwise a pledger watches the count and defects just before quorum."],
              ["Cannot reclaim twice", "A refund needs that pledge's own preimage, and burns it."],
              ["Cannot reorder the set", "Pledges fold into an order-dependent root, fixing the sequence as it is counted."],
            ].map(([t, d], i) => (
              <Reveal key={t} delay={i * 70}>
                <div className="guarantee">
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                    <path d="M2 8l4 4 7-9" stroke="var(--fire-500)" strokeWidth="1.7" />
                  </svg>
                  <div><strong>{t}</strong><p>{d}</p></div>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <p className="mono guarantee-foot">
              All of it holds against an organiser who holds the fire secret and wants to steal.
              <Link to="/how"> See the tests →</Link>
            </p>
          </Reveal>
        </div>
      </section>

      <hr className="rule" />

      <section className="band cta-band">
        <div className="wrap-narrow" style={{ textAlign: "center" }}>
          <Reveal>
            <h2 className="section" style={{ margin: "0 auto 24px", maxWidth: "16ch" }}>
              Somebody has to go first. Make it cost nothing.
            </h2>
            <div className="hero-actions" style={{ justifyContent: "center" }}>
              <Link to="/create" className="btn-primary">Start a campaign</Link>
              <Link to="/campaigns" className="btn-line">See live campaigns</Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
