import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { StoreProvider } from "./lib/store";
import { AppShell } from "./components/AppShell";
import { Home } from "./screens/Home";
import { NewProject } from "./screens/NewProject";
import { ProjectDetail } from "./screens/ProjectDetail";
import { Rules } from "./screens/Rules";
import { Settings } from "./screens/Settings";
import { NoBridge, Pairing } from "./screens/StateScreens";
import { MobileHome, MobileWorkbench } from "./screens/MobileScreens";
import { Unlock } from "./screens/Unlock";

// V6-08: the /v6 slice loads on demand. Set VITE_V6_ENABLED=false to build without it.
const V6_ENABLED = import.meta.env.VITE_V6_ENABLED !== "false";
const V6App = lazy(() => import("./v6/routes/V6App.tsx"));

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter basename="/patent">
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Home />} />
            <Route path="/projects" element={<Home />} />
            <Route path="/new" element={<NewProject />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/projects/:id/upload" element={<ProjectDetail />} />
            <Route path="/projects/:id/readiness" element={<ProjectDetail />} />
            <Route path="/projects/:id/intake" element={<ProjectDetail />} />
            <Route path="/projects/:id/strategy" element={<ProjectDetail />} />
            <Route path="/projects/:id/figures" element={<ProjectDetail />} />
            <Route path="/projects/:id/audit" element={<ProjectDetail />} />
            <Route path="/projects/:id/export" element={<ProjectDetail />} />
            <Route path="/projects/:id/history" element={<ProjectDetail />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="/nobridge" element={<NoBridge />} />
          <Route path="/pairing" element={<Pairing />} />
          <Route path="/unlock" element={<Unlock />} />
          <Route path="/mobile" element={<MobileHome />} />
          <Route path="/mobile/workbench" element={<MobileWorkbench />} />
          {V6_ENABLED ? (
            <Route
              path="/v6/*"
              element={
                <Suspense fallback={null}>
                  <V6App />
                </Suspense>
              }
            />
          ) : null}
          <Route path="*" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}
