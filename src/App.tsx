import { AppShell } from './components/Layout/AppShell';
import { RemoteLoginSuccessPage } from './pages/RemoteLoginSuccessPage';
import { LandingPage } from './pages/LandingPage';

export default function App() {
  if (window.location.pathname === '/remoteloginsuccess') {
    return <RemoteLoginSuccessPage />;
  }

  // C1 — the PUBLIC deploy (VITE_LANDING=1) fronts the real free app with the marketing page at root, but ONLY for a
  // visitor who hasn't onboarded yet. A returning owner/viewer (or anyone who has completed onboarding) lands straight
  // in their app at '/'. The onboarded flag is read directly from the standalone GATE key — synchronous, and App must
  // not couple to the store (the store's own seed-reader IIFE reads this same 'personal-bloc-onboarded' key).
  // Funnel: every landing CTA links '/app' → <AppShell/> → !onboardingComplete → OnboardingModal opens on the
  // ChoosePathView fork (Get started / I have a plan or a key / Connect to a shared plan) — the fork IS sign-up/log-in.
  // Completing onboarding flips the GATE key to '1' → '/' renders the app (landing skipped). The owner deploy sets no
  // VITE_LANDING → this branch never runs → parity preserved. (vercel.json rewrites every path to index.html.)
  const onboarded = (() => {
    try { return localStorage.getItem('personal-bloc-onboarded') === '1'; } catch { return false; }
  })();
  if (import.meta.env.VITE_LANDING === '1' && window.location.pathname === '/' && !onboarded) {
    return <LandingPage />;
  }

  return <AppShell />;
}
