import Reveal from "../components/Reveal.jsx";

const STEPS = [
  { n: "01", t: "An organiser opens a campaign",
    d: "They set what people are pledging to, how many pledges are needed, and a deadline. The terms are hashed on-chain, never published — a campaign's subject is often more dangerous than its participant list. “Forty of us walk out on the 3rd” tells an employer exactly what is coming, months before it has the numbers to survive being noticed." },
  { n: "02", t: "People pledge, sealed",
    d: "A pledge is an encrypted note in the STRK20 pool. Value moves without naming who moved it. Your pledge is stored against a commitment the contract can check but not reverse, so the machine holds your money without ever knowing whose it is." },
  { n: "03", t: "Nothing happens",
    d: "This is the important part, and the part no screenshot conveys. Below quorum there is no list, no names, and nothing an employer can act on. Going first tells nobody anything, which is exactly why anyone can afford to." },
  { n: "04", t: "Quorum, or the deadline",
    d: "Reach the threshold before expiry and the campaign fires: it settles atomically and only then does anyone learn how many there were. Miss it and every pledge is reclaimable, in full, and nobody was ever named." },
];

const TESTS = [
  ["a_campaign_cannot_fire_below_its_quorum", "The invariant everything rests on."],
  ["a_quorum_that_was_met_still_cannot_fire_late", "Or an organiser sits on a signed list as leverage."],
  ["a_pledge_cannot_be_withdrawn_before_the_deadline", "Or a pledger defects just before quorum."],
  ["a_malicious_organiser_cannot_pay_out_more_than_was_pledged", "Authority to fire is not authority to mint."],
  ["an_organiser_cannot_strand_value_by_underpaying", "Conservation runs both ways."],
  ["a_failed_campaign_returns_every_pledge_in_full", "The reason anyone goes first."],
  ["a_stranger_cannot_reclaim_someone_elses_pledge", "A refund needs that pledge's own preimage."],
  ["poseidon_matches_the_typescript_client", "Drift here would silently strand every refund."],
];

export default function How() {
  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="eyebrow">How it works</p>
          <h1 className="display" style={{ fontSize: "clamp(38px,5.4vw,74px)" }}>
            Four steps, and the<br />third one is <em className="fire">nothing</em>.
          </h1>
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap">
          <ol className="steps">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 80}>
                <li className="step">
                  <span className="step-n mono">{s.n}</span>
                  <div>
                    <h3 className="sub">{s.t}</h3>
                    <p>{s.d}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap-narrow">
          <Reveal>
            <p className="eyebrow">Nothing to write down</p>
            <h2 className="section">Your claim on your own money is derived, not stored.</h2>
            <p>
              A pledge lives on-chain under <span className="mono">poseidon(REFUND_TAG, secret)</span>,
              and that secret is your only claim on it — the contract deliberately has no idea
              who you are, so there is nobody to appeal to.
            </p>
            <p>
              A safety net that depends on you not losing a random string is not a safety net.
              So secrets are never random: they are <strong>derived from a signature your wallet
              can always reproduce</strong>. Nothing to store, nothing to back up. Reinstall on a
              new machine and the same secret falls out.
            </p>
          </Reveal>
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">The tests are the product</p>
            <h2 className="section">A coordination mechanism is worth nothing unless it holds when the organiser turns on the people in it.</h2>
            <p style={{ maxWidth: "56ch", marginBottom: 40 }}>
              So the adversarial cases are the suite and the happy path is almost incidental.
              Every one below runs against an organiser who <strong>holds the fire secret</strong> and
              is trying to steal.
            </p>
          </Reveal>
          <div className="tests">
            {TESTS.map(([name, why], i) => (
              <Reveal key={name} delay={i * 45}>
                <div className="test-row">
                  <span className="test-pass mono">PASS</span>
                  <code className="mono">{name}</code>
                  <span className="test-why">{why}</span>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <p className="mono guarantee-foot">
              157 tests · 43 Cairo · 114 TypeScript ·{" "}
              <a href="https://github.com/iamdflame/shoal/blob/master/contracts/tests/quorum_test.cairo"
                target="_blank" rel="noreferrer">read them →</a>
            </p>
          </Reveal>
        </div>
      </section>

      <hr className="rule" />

      <section className="band">
        <div className="wrap-narrow">
          <Reveal>
            <p className="eyebrow">Stated plainly</p>
            <h2 className="section">What is public, and what is not.</h2>
            <p>
              The pool hides <strong>who</strong> pledged and <strong>how much</strong>. It does not
              hide that a campaign exists, how many pledges it holds, or when they arrived —
              each pledge is a transaction, and transactions are counted.
            </p>
            <p>
              For a union drive that means an employer can see <em className="fire">forty people
              pledged</em>, just not which forty. For most of these cases that is the right trade.
              For some it is not, and you should know which you are in before you pledge rather
              than after.
            </p>
          </Reveal>
        </div>
      </section>
    </>
  );
}
