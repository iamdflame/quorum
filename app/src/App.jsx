import { useEffect, useMemo, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import PresenceField from "./components/PresenceField.jsx";
import Nav from "./components/Nav.jsx";
import Footer from "./components/Footer.jsx";
import Home from "./pages/Home.jsx";
import How from "./pages/How.jsx";
import Campaigns from "./pages/Campaigns.jsx";
import Campaign from "./pages/Campaign.jsx";
import Create from "./pages/Create.jsx";
import Verify from "./pages/Verify.jsx";
import Run from "./pages/Run.jsx";
import { connectWallet } from "./wallet.js";

export default function App() {
  const { pathname } = useLocation();
  const [wallet, setWallet] = useState(null);
  const [heat, setHeat] = useState(0.12);

  // Every route change starts at the top; a router that keeps scroll position
  // across pages feels broken in exactly the way nobody can name.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  async function onConnect() {
    try {
      setWallet(await connectWallet());
    } catch (err) {
      console.error("[quorum] connect failed", err);
      alert(String(err?.message ?? err));
    }
  }

  const ctx = useMemo(() => ({ wallet, setHeat }), [wallet]);

  return (
    <>
      <PresenceField heat={heat} />
      <div className="field-veil" />
      <div className="shell">
        <Nav onConnect={onConnect} wallet={wallet} />
        <main>
          <Routes>
            <Route path="/" element={<Home ctx={ctx} />} />
            <Route path="/how" element={<How ctx={ctx} />} />
            <Route path="/campaigns" element={<Campaigns ctx={ctx} />} />
            <Route path="/campaigns/:id" element={<Campaign ctx={ctx} />} />
            <Route path="/create" element={<Create ctx={ctx} />} />
            <Route path="/verify" element={<Verify ctx={ctx} />} />
            <Route path="/run" element={<Run ctx={ctx} />} />
            <Route path="*" element={<Home ctx={ctx} />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </>
  );
}
