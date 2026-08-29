import { Link } from "react-router-dom";
import { Mark } from "./Nav.jsx";

const MACHINE = "0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <div className="brand" style={{ marginBottom: 18 }}>
              <Mark size={20} />
              <span className="brand-name">Quorum</span>
            </div>
            <p className="footer-blurb">
              Threshold coordination on Starknet. Your pledge binds only once enough
              others have pledged too — and if the quorum is never reached, you get your
              money back and you were never revealed.
            </p>
          </div>

          <div>
            <h4>Product</h4>
            <ul>
              <li><Link to="/how">How it works</Link></li>
              <li><Link to="/campaigns">Campaigns</Link></li>
              <li><Link to="/create">Start a campaign</Link></li>
              <li><Link to="/verify">Verify a campaign</Link></li>
            </ul>
          </div>

          <div>
            <h4>On chain</h4>
            <ul>
              <li><a href={`https://voyager.online/contract/${MACHINE}`} target="_blank" rel="noreferrer">QuorumMachine</a></li>
              <li><a href="https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" target="_blank" rel="noreferrer">STRK20 pool</a></li>
              <li><a href="https://sepolia.voyager.online/contract/0x07d639ca00289a59a6949a12f6470feadf74d905d01bcce331f6c9d1d775fc73" target="_blank" rel="noreferrer">Sepolia deployment</a></li>
            </ul>
          </div>

          <div>
            <h4>Source</h4>
            <ul>
              <li><a href="https://github.com/iamdflame/quorum" target="_blank" rel="noreferrer">Repository</a></li>
              <li><a href="https://github.com/iamdflame/quorum/blob/master/contracts/src/quorum.cairo" target="_blank" rel="noreferrer">The contract</a></li>
              <li><a href="https://github.com/iamdflame/quorum/blob/master/contracts/tests/quorum_test.cairo" target="_blank" rel="noreferrer">The adversarial tests</a></li>
              <li><a href="https://strk20-by-example.org/" target="_blank" rel="noreferrer">STRK20 docs</a></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <span>Apache-2.0 · unaudited · own the review if you build on it</span>
          <span>157 tests · 43 Cairo · 114 TypeScript</span>
          <span>Live on Starknet mainnet</span>
        </div>
      </div>
    </footer>
  );
}
