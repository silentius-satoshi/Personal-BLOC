import { useState, useRef, useEffect } from 'react';
import { nip19, getPublicKey } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { useStore, publishViewerSnapshotNow, publishViewerRevocationNow } from '../../store/useStore';
import { unwrapSecretKey } from '../../lib/nostr/keyVault';
import { deriveViewerKeyFromNsec } from '../../lib/nostr/viewerKey';
import { buildHandoffToken } from '../../lib/nostr/handoffToken';
import { Toggle } from '../ui/Toggle';
import { SecretKeyCard } from '../Auth/SecretKeyCard';
import styles from './SharingPage.module.css';

/**
 * Sharing subpage (Viewer V2) — the owner's viewer-access home, extracted from SettingsMain.
 * Owner-only (SettingsMain gates it `!viewerMode`). Two sections:
 *  - YOUR SHARE CODE: the owner's npub to hand out.
 *  - YOUR VIEWER: the single grant card (list-ready for multi-viewer) with the C-safe/C-trusted
 *    privacy toggle + revoke, or the add-a-viewer form when empty.
 * Reads the store directly; owns its own draft/error/copied local state (verbatim handlers).
 */
export function SharingPage() {
  const nostrPubkey         = useStore((s) => s.nostrPubkey);
  const nostrSigningMethod  = useStore((s) => s.nostrSigningMethod);
  const viewerNpub          = useStore((s) => s.viewerNpub);
  const viewerLabel         = useStore((s) => s.viewerLabel);
  const viewerPrivacyTrusted = useStore((s) => s.viewerPrivacyTrusted);
  const setViewerNpub       = useStore((s) => s.setViewerNpub);
  const setViewerPubkey     = useStore((s) => s.setViewerPubkey);
  const setViewerLabel      = useStore((s) => s.setViewerLabel);
  const setViewerPrivacyTrusted = useStore((s) => s.setViewerPrivacyTrusted);
  // Preview-as-viewer trigger (relocated here from the journal headers) — sets the transient flag AND
  // leaves Settings so AppShell's branch J renders the (unchanged) ViewerPreview overlay.
  const setViewerPreview        = useStore((s) => s.setViewerPreview);
  const setActiveTab            = useStore((s) => s.setActiveTab);
  const previousTab             = useStore((s) => s.previousTab);

  const [draft, setDraft]           = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  const [error, setError]           = useState<string | null>(null);
  const [npubCopied, setNpubCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  if (!nostrPubkey) {
    return (
      <div className={styles.section}>
        <p className={styles.desc}>Connect a Nostr identity first to share viewer access.</p>
      </div>
    );
  }

  const ownerNpub = (() => { try { return nip19.npubEncode(nostrPubkey); } catch { return ''; } })();

  const copyOwnerNpub = () => {
    if (!ownerNpub) return;
    navigator.clipboard?.writeText(ownerNpub);
    setNpubCopied(true);
    setTimeout(() => setNpubCopied(false), 1500);
  };

  const addViewer = () => {
    const input = draft.trim();
    try {
      const decoded = nip19.decode(input);
      if (decoded.type !== 'npub') { setError('Not a valid npub'); return; }
      setViewerNpub(input);
      setViewerPubkey(decoded.data as string);
      const label = labelDraft.trim();
      if (label) setViewerLabel(label);
      setError(null);
      void publishViewerSnapshotNow();   // seal + publish NOW so the viewer hydrates without waiting for an owner edit
    } catch { setError('Not a valid npub'); }
  };

  const revoke = () => {
    void publishViewerRevocationNow();   // tombstone WHILE viewerPubkey is still set
    setViewerNpub(null); setViewerPubkey(null); setViewerLabel(null);
    setDraft(''); setLabelDraft(''); setError(null); setConfirmRevoke(false);
  };

  return (
    <div className={styles.section}>
      {/* YOUR SHARE CODE */}
      <div className={styles.groupTitle}>YOUR SHARE CODE</div>
      <p className={styles.desc}>Give this to the person you're sharing with — they'll enter it when connecting.</p>
      <div className={styles.npubRow}>
        <span className={styles.npub}>{ownerNpub ? `${ownerNpub.slice(0, 14)}…${ownerNpub.slice(-8)}` : nostrPubkey.slice(0, 12)}</span>
        <button className={styles.actionBtn} onClick={copyOwnerNpub}>{npubCopied ? 'Copied ✓' : 'Copy'}</button>
      </div>

      {/* YOUR VIEWER */}
      <div className={styles.groupTitle} style={{ marginTop: 20 }}>YOUR VIEWER</div>
      {viewerNpub ? (
        <div className={styles.grantCard}>
          <div className={styles.grantHead}>
            <span className={styles.grantDot} />
            <span className={styles.grantName}>
              {viewerLabel || 'Viewer'}{' '}
              <span className={styles.grantNpub}>({viewerNpub.slice(0, 12)}…{viewerNpub.slice(-6)})</span>
            </span>
            <span className={styles.grantActive}>Active</span>
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleLabel}>
              <span className={styles.toggleTitle}>Show real figures</span>
              <span className={styles.toggleHint}>Off: health only · On: balances + liquidation prices</span>
            </div>
            <Toggle value={viewerPrivacyTrusted} onChange={setViewerPrivacyTrusted} />
          </div>
          {confirmRevoke ? (
            <div className={styles.confirmRow}>
              <span className={styles.confirmText}>Stop sharing with this viewer?</span>
              <button className={styles.revokeBtn} onClick={revoke}>Revoke</button>
              <button className={styles.actionBtn} onClick={() => setConfirmRevoke(false)}>Cancel</button>
            </div>
          ) : (
            <button className={styles.revokeBtn} onClick={() => setConfirmRevoke(true)}>Revoke</button>
          )}
        </div>
      ) : (
        <div className={styles.addBlock}>
          <p className={styles.desc}>Add someone to follow your plan, read-only.</p>
          <input
            className={styles.input}
            type="text"
            placeholder="Nickname (e.g. Dad's iPhone)"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
          />
          <input
            className={styles.input}
            type="text"
            placeholder="Their npub1…"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
          />
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.addBtn} onClick={addViewer}>Add</button>
        </div>
      )}

      {/* GENERATE FROM IDENTITY (local signer only) — deterministically derive the viewer's key from your own
          nsec. Regenerable anytime (no separate backup); hand the shown token to the viewer. A passphrase makes
          the token safe to send remotely (NIP-49); leave it blank for in-person handoff. */}
      {nostrSigningMethod === 'local' && (
        <>
          <div className={styles.groupTitle} style={{ marginTop: 20 }}>GENERATE A VIEWER KEY</div>
          <p className={styles.desc}>
            Derive the viewer's key from your own identity — it stays reproducible, so you can regenerate the exact
            same key anytime without a separate backup. The token includes your npub, so the viewer pastes just one
            string. Set a passphrase to send it remotely (encrypted); leave it blank for in-person handoff.
          </p>
          <GenerateViewerKeyBlock />
        </>
      )}

      {/* PREVIEW — see exactly what a viewer sees (safe or trusted), previewable before granting access */}
      <div className={styles.groupTitle} style={{ marginTop: 20 }}>PREVIEW</div>
      <p className={styles.desc}>Open a live preview of the viewer experience, with a Safe / Trusted toggle.</p>
      <button
        className={styles.actionBtn}
        onClick={() => { setViewerPreview(true); setActiveTab(previousTab); }}
      >
        👁 Preview as viewer
      </button>
    </div>
  );
}

const GEN_AUTO_CLEAR_MS = 30_000;

/**
 * Owner-side "Generate viewer key" — LOCAL-SIGNER-ONLY (the raw owner sk is reachable only via the Face-ID/PIN
 * unwrap; nip07/nip46 never expose it, so the parent hides this). Unwraps the owner key → deterministically
 * derives the viewer key (deriveViewerKeyFromNsec) → sets viewerPubkey/viewerNpub → publishes the snapshot →
 * reveals a HANDOFF TOKEN (`<keyPart>:<ownerNpub>`) via SecretKeyCard (auto-clears ~30s; leaving the page
 * unmounts → discards it). keyPart = a passphrase-encrypted ncryptsec (remote-safe, NIP-49) when a passphrase is
 * set, else a bare nsec (in-person). ⚠ Never logs key material. Mirrors RevealRecoveryKey's unwrap/reveal pattern.
 */
function GenerateViewerKeyBlock() {
  const wrapMeta = useStore((s) => s.writerKeyWrapMeta);
  const setViewerNpub   = useStore((s) => s.setViewerNpub);
  const setViewerPubkey = useStore((s) => s.setViewerPubkey);
  const isPin = wrapMeta?.scheme === 'pin';

  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [handoffPassphrase, setHandoffPassphrase] = useState('');   // optional — encrypts the token for remote handoff
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin]         = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
  useEffect(() => clearTimer, []);   // unmount (leaving the page) discards the revealed token

  const clearReveal = () => { clearTimer(); setRevealedToken(null); };

  const doGenerate = async () => {
    setBusy(true);
    setError(null);
    let ownerSk: Uint8Array | null = null;
    let derived: Uint8Array | null = null;
    try {
      const { writerKeyWrapped, writerKeyWrapMeta, nostrPubkey: pk, viewerKeyVersion } = useStore.getState();
      if (!writerKeyWrapped || !writerKeyWrapMeta || !pk) { setError('No local key on this device.'); return; }
      ownerSk = await unwrapSecretKey(writerKeyWrapped, writerKeyWrapMeta, writerKeyWrapMeta.scheme === 'pin' ? pin : undefined);
      derived = await deriveViewerKeyFromNsec(ownerSk, pk, viewerKeyVersion);
      const hex = getPublicKey(derived);
      // Replace-guard — never silently swap out a live viewer. Re-deriving the SAME key (existing === hex) is the
      // friction-free determinism/recovery path and skips the confirm.
      const existing = useStore.getState().viewerPubkey;
      if (existing && existing !== hex) {
        // eslint-disable-next-line no-alert
        if (!window.confirm(
          'A different viewer key is already connected. Replacing it means the current viewer ' +
          'device stops receiving updates until it signs in with the new key. Replace?'
        )) { return; }   // ownerSk + derived zeroed by the finally
      }
      setViewerPubkey(hex);
      setViewerNpub(nip19.npubEncode(hex));
      void publishViewerSnapshotNow();   // seal + publish NOW so the viewer hydrates once they sign in
      // Build the handoff token. Encode/encrypt the derived key BEFORE the finally zeros it; the token STRING
      // carries the value for the reveal window.
      const pass = handoffPassphrase.trim();
      const keyPart = pass ? nip49.encrypt(derived, pass) : nip19.nsecEncode(derived);
      setRevealedToken(buildHandoffToken(keyPart, nip19.npubEncode(pk)));
      setShowPin(false);
      setPin('');
      clearTimer();
      timerRef.current = setTimeout(clearReveal, GEN_AUTO_CLEAR_MS);
    } catch {
      setError(isPin ? 'Could not unlock — check your PIN and try again.' : 'Could not unlock — try again.');
    } finally {
      ownerSk?.fill(0);
      derived?.fill(0);
      setBusy(false);
    }
  };

  const onGenerateTap = () => {
    setError(null);
    if (isPin) setShowPin(true);   // PIN scheme → collect the PIN first
    else doGenerate();             // PRF → Face ID directly
  };

  if (revealedToken) {
    const isEncrypted = handoffPassphrase.trim().length > 0;
    return (
      <div className={styles.genBlock}>
        <SecretKeyCard nsec={revealedToken} hint="Hand this to the viewer — it includes your npub." />
        <div className={styles.revealFoot}>
          <button type="button" className={styles.actionBtn} onClick={clearReveal}>Hide</button>
          <span className={styles.desc}>
            {isEncrypted
              ? "Encrypted — safe to send remotely. Share the passphrase separately. Auto-hides in ~30s."
              : "Plaintext — hand it over in person. Auto-hides in ~30s."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.genBlock}>
      <input
        className={styles.input}
        type="text"
        placeholder="Passphrase for remote handoff (optional)"
        value={handoffPassphrase}
        onChange={(e) => { setHandoffPassphrase(e.target.value); setError(null); }}
        disabled={busy}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
      />
      {showPin ? (
        <div className={styles.pinRow}>
          <input
            className={styles.input}
            type="password"
            inputMode="numeric"
            placeholder="PIN"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(null); }}
            disabled={busy}
          />
          <button type="button" className={styles.genBtn} onClick={doGenerate} disabled={busy || pin.length < 4}>
            {busy ? 'Deriving…' : 'Generate'}
          </button>
          <button type="button" className={styles.actionBtn} onClick={() => { setShowPin(false); setPin(''); setError(null); }} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className={styles.genBtn} onClick={onGenerateTap} disabled={busy}>
          {busy ? 'Deriving…' : '🔑 Generate viewer key'}
        </button>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <span className={styles.desc}>Requires {isPin ? 'your PIN' : 'Face ID'} — shown only on this device, never stored in plain text.</span>
    </div>
  );
}
