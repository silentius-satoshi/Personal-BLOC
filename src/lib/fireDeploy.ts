// Where the FIRE face shows (batch 1 build 4b — BL42): on the owner's deploy and in dev (so in the e2e), never on the
// public deploy (VITE_LANDING=1) or the sandbox (VITE_DEMO=1) — docs/claude/commercialization.md's three deploys. Until
// its borrow lane ships, the public app never sees a sell-only face (the FIRE plan review's F6).
// PURE, ZERO imports: the hub reads the two flags once, where the pill is built, and hands them here — so the rule is
// tested without Vite. A flag hides the face only at '1', as App.tsx's and AppShell's own reads compare it.

/** True where the FIRE face may show: neither VITE_LANDING nor VITE_DEMO is '1'. */
export function fireFaceOnDeploy(env: { VITE_LANDING?: string; VITE_DEMO?: string }): boolean {
  return env.VITE_LANDING !== '1' && env.VITE_DEMO !== '1';
}
