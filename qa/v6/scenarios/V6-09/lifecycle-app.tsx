/**
 * V6-09 lifecycle fixture: the real `/v6` app under a BrowserRouter, beside a
 * legacy route that uses none of the v6 document attributes. The scenario
 * bundles this file and drives it in headless Chrome, so the actual React
 * effects mount, navigate, track the OS and unmount.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import V6App from "../../../../apps/web/src/v6/routes/V6App.tsx";

function Legacy() {
  return (
    <main data-testid="legacy">
      <h1>旧版</h1>
      <Link to="/v6/settings" data-testid="legacy-to-v6">
        设置
      </Link>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/patent">
      <Routes>
        <Route path="/v6/*" element={<V6App />} />
        <Route path="*" element={<Legacy />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
