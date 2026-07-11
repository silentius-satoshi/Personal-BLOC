import { AppShell } from './components/Layout/AppShell';
import { RemoteLoginSuccessPage } from './pages/RemoteLoginSuccessPage';
import { LandingPage } from './pages/LandingPage';

export default function App() {
  if (window.location.pathname === '/remoteloginsuccess') {
    return <RemoteLoginSuccessPage />;
  }

  // C0 — the PUBLIC deploy (VITE_LANDING=1) serves the marketing page at root and the sandbox app at /app. The
  // owner deploy sets no flag → this branch never runs. /app + everything else falls through to <AppShell/>
  // (vercel.json rewrites every path to index.html, so client-side pathname routing serves /app).
  if (import.meta.env.VITE_LANDING === '1' && window.location.pathname === '/') {
    return <LandingPage />;
  }

  return <AppShell />;
}
