/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

// C1 commercialization — build-time flags across THREE Vercel projects (unset flags → dead branches, tree-shaken):
//   owner   → VITE_OWNER_PUBKEY only (the private app, untouched)
//   public  → VITE_LANDING=1, VITE_REPO_URL, VITE_SANDBOX_URL — the real free app; landing fronts '/' for the
//             not-yet-onboarded. ⚠ NO VITE_DEMO, NO VITE_OWNER_PUBKEY (real users must sign in).
//   sandbox → VITE_DEMO=1, VITE_OWNER_PUBKEY (free-riding closure lives here now), VITE_PUBLIC_SITE_URL
// ⚠ VITE_DEMO must NEVER be set on an origin with real users — the demo seed overwrites 'personal-bloc-store' on
// every load. VITE_OWNER_PUBKEY is already read in AppShell.
interface ImportMetaEnv {
  readonly VITE_LANDING?: string;         // '1' → serve LandingPage at '/' (public project)
  readonly VITE_DEMO?: string;            // '1' → seed the sandbox showcase plan + show the DemoBanner (sandbox project ONLY)
  readonly VITE_REPO_URL?: string;        // "View source" link target on the landing page
  readonly VITE_SANDBOX_URL?: string;     // landing → sandbox link (public project); no CTA when unset
  readonly VITE_PUBLIC_SITE_URL?: string; // sandbox DemoBanner → public site link (sandbox project)
  readonly VITE_OWNER_PUBKEY?: string;    // owner hex pubkey — the private/owner gate (owner + sandbox projects; NEVER on public — real users must sign in)
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  nostr?: {
    getPublicKey(): Promise<string>;
    signEvent(event: unknown): Promise<unknown>;
    nip04?: { encrypt(p: string, t: string): Promise<string>; decrypt(p: string, c: string): Promise<string> };
    nip44?: { encrypt(p: string, t: string): Promise<string>; decrypt(p: string, c: string): Promise<string> };
  };
}
