import { useState, useRef, useEffect } from 'react';
import { nip19, getPublicKey } from 'nostr-tools';
import { cryptoClient } from '../../lib/crypto/cryptoClient';
import { useStore, type ViewerSlot } from '../../store/useStore';
import { publishViewerSnapshotNow, publishViewerRevocationNow } from '../../lib/nostr/syncEngine';
import { unwrapSecretKey } from '../../lib/nostr/keyVault';
import { deriveViewerKeyFromNsec } from '../../lib/nostr/viewerKey';
import { buildHandoffToken } from '../../lib/nostr/handoffToken';
import { Toggle } from '../ui/Toggle';
import { PassphraseInput } from '../ui/PassphraseInput';
import { SecretKeyCard } from '../Auth/SecretKeyCard';
import styles from './SharingPage.module.css';

/**
 * Sharing subpage (Viewer M3) — the owner's viewer-access home, extracted from SettingsMain.
 * Owner-only (SettingsMain gates it `!viewerMode`). Sections:
 *  - YOUR SHARE CODE: the owner's npub to hand out.
 *  - YOUR VIEWERS: the ROSTER (local-signer-only) — <ViewerRoster/> lists every provisioned viewer with a
 *    per-row tier toggle · Rotate · Remove, plus the add-a-viewer derive flow. The owner MINTS every viewer
 *    key (there is no viewer-supplied-npub path — that model died at Handoff v4).
 *  - PREVIEW: open the live viewer experience (its own Safe|Trusted toggle).
 */
export function SharingPage() {
  const nostrPubkey        = useStore((s) => s.nostrPubkey);
  const nostrSigningMethod = useStore((s) => s.nostrSigningMethod);
  // Preview-as-viewer trigger (relocated here from the journal headers) — sets the transient flag AND
  // leaves Settings so AppShell's branch J renders the (unchanged) ViewerPreview overlay.
  const setViewerPreview = useStore((s) => s.setViewerPreview);
  const setActiveTab     = useStore((s) => s.setActiveTab);
  const previousTab      = useStore((s) => s.previousTab);

  const [npubCopied, setNpubCopied] = useState(false);

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

  return (
    <div className={styles.section}>
      {/* YOUR SHARE CODE */}
      <div className={styles.groupTitle}>YOUR SHARE CODE</div>
      <p className={styles.desc}>Give this to the person you're sharing with — they'll enter it when connecting.</p>
      <div className={styles.npubRow}>
        <span className={styles.npub}>{ownerNpub ? `${ownerNpub.slice(0, 14)}…${ownerNpub.slice(-8)}` : nostrPubkey.slice(0, 12)}</span>
        <button className={styles.actionBtn} onClick={copyOwnerNpub}>{npubCopied ? 'Copied ✓' : 'Copy'}</button>
      </div>

      {/* YOUR VIEWERS — the roster (mint / tier / rotate / remove). LOCAL-SIGNER-ONLY: every action derives from
          the raw owner key, and viewers can only be minted locally, so a non-local device has none to manage. */}
      <div className={styles.groupTitle} style={{ marginTop: 20 }}>YOUR VIEWERS</div>
      {nostrSigningMethod === 'local' ? (
        <ViewerRoster />
      ) : (
        <p className={styles.desc}>Viewer sharing needs a local key (Face ID / PIN) on this device.</p>
      )}

      {/* PREVIEW — see exactly what a viewer sees (the overlay carries its own Safe / Trusted toggle). */}
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
 * Viewer roster (M3) — LOCAL-SIGNER-ONLY (the raw owner sk is reachable only via the Face-ID/PIN unwrap;
 * nip07/nip46 never expose it, so the parent hides this). Lists every provisioned viewer with a per-row tier
 * toggle · Rotate · Remove, plus the add-a-viewer flow. Both ADD and ROTATE share ONE derive engine
 * (unwrap → deriveViewerKeyFromNsec → reveal a HANDOFF TOKEN via SecretKeyCard, auto-clears ~30s / unmount).
 * `rotatingIndex` carries the add-vs-rotate intent through the PIN step (null ⇒ ADD). No replace-guard: ADD
 * always uses a fresh index (nothing to overwrite) and ROTATE is confirmed (the only intentional overwrite).
 * ⚠ Never logs key material; keys zeroed after encode. Mirrors RevealRecoveryKey's unwrap/reveal pattern.
 */
function ViewerRoster() {
  const wrapMeta         = useStore((s) => s.writerKeyWrapMeta);
  const viewers          = useStore((s) => s.viewers);
  const addViewerSlot    = useStore((s) => s.addViewerSlot);
  const updateViewerSlot = useStore((s) => s.updateViewerSlot);
  const removeViewerSlot = useStore((s) => s.removeViewerSlot);
  const isPin = wrapMeta?.scheme === 'pin';

  // Derive engine
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [handoffPassphrase, setHandoffPassphrase] = useState('');   // REQUIRED — tokens are always ncryptsec (encrypts the key part)
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin]         = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [rotatingIndex, setRotatingIndex] = useState<number | null>(null);   // null ⇒ the pending derive is an ADD
  // Add inputs
  const [addLabel, setAddLabel] = useState('');
  const [addTier, setAddTier]   = useState<'safe' | 'trusted'>('safe');
  // Per-row remove confirm
  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
  useEffect(() => clearTimer, []);   // unmount (leaving the page) discards the revealed token

  const clearReveal = () => { clearTimer(); setRevealedToken(null); };

  // Per-row tier toggle — republish so the viewer switches shape now (updateViewerSlot only syncs settings).
  const setTier = (slot: ViewerSlot, trusted: boolean) => {
    updateViewerSlot(slot.index, { tier: trusted ? 'trusted' : 'safe' });
    void publishViewerSnapshotNow();
  };

  // Per-row remove — tombstone THIS slot's d-tag (capture the pubkey before removal), then drop the row.
  const remove = (slot: ViewerSlot) => {
    void publishViewerRevocationNow(slot.pubkeyHex);
    removeViewerSlot(slot.index);
    setConfirmRemoveIndex(null);
  };

  // The shared derive engine — ADD (rotatingIndex === null) or ROTATE (a slot index).
  const doDerive = async () => {
    setBusy(true);
    setError(null);
    let ownerSk: Uint8Array | null = null;
    let derived: Uint8Array | null = null;
    try {
      const { writerKeyWrapped, writerKeyWrapMeta, nostrPubkey: pk, viewers: roster, nextViewerIndex } = useStore.getState();
      if (!writerKeyWrapped || !writerKeyWrapMeta || !pk) { setError('No local key on this device.'); return; }
      const rotateSlot = rotatingIndex !== null ? (roster.find((v) => v.index === rotatingIndex) ?? null) : null;
      if (rotatingIndex !== null && !rotateSlot) { setError('That viewer no longer exists.'); return; }
      // M2 coupling — derivation is PER-SLOT-INDEXED. ADD: index = nextViewerIndex, the SAME value addViewerSlot
      // will assign below (the key is bound to that index). ROTATE: reuse the slot's index; derive at the TARGET
      // version (stored kv + 1).
      const index      = rotateSlot ? rotateSlot.index          : nextViewerIndex;
      const keyVersion = rotateSlot ? rotateSlot.keyVersion + 1 : 1;   // target version, not stored version
      // Tokens are ALWAYS ncryptsec (R2c-7a-2 no-unprotected-key-artifacts). Require the passphrase BEFORE the
      // unwrap so we fail without prompting Face ID; the return hits the finally → busy/rotatingIndex reset.
      const pass = handoffPassphrase.trim();
      if (!pass) { setError('Set a handoff passphrase first — tokens are always encrypted.'); return; }
      ownerSk = await unwrapSecretKey(writerKeyWrapped, writerKeyWrapMeta, writerKeyWrapMeta.scheme === 'pin' ? pin : undefined);
      derived = await deriveViewerKeyFromNsec(ownerSk, pk, keyVersion, index);   // 4-arg indexed (M2)
      const hex  = getPublicKey(derived);
      const npub = nip19.npubEncode(hex);
      const oldPubkeyHex = rotateSlot?.pubkeyHex;   // capture BEFORE the atomic swap (for the rotate revocation)
      if (rotateSlot) updateViewerSlot(rotateSlot.index, { pubkeyHex: hex, npub, keyVersion });   // atomic: pubkey + target kv together (tier preserved)
      else addViewerSlot({ pubkeyHex: hex, npub, label: addLabel.trim() || 'Viewer', tier: addTier, keyVersion: 1 });
      void publishViewerSnapshotNow();   // seal + publish NOW so the viewer hydrates once they sign in
      // Rotation = revoke-old + issue-new, atomically from the roster's perspective: tombstone the OLD d-tag so the
      // old viewer device wipes + exits to the waiting gate on its next live event / reconnect (the Remove mechanism).
      if (rotateSlot && oldPubkeyHex && oldPubkeyHex !== hex) void publishViewerRevocationNow(oldPubkeyHex);
      // Build the handoff token — ALWAYS ncryptsec. Encrypt the derived key BEFORE the finally zeros it (the client
      // copies `derived` internally, so the finally's `derived.fill(0)` still zeroes the caller's buffer).
      const keyPart = await cryptoClient.nip49Encrypt(derived, pass);
      setRevealedToken(buildHandoffToken(keyPart, nip19.npubEncode(pk)));
      setShowPin(false);
      setPin('');
      if (!rotateSlot) { setAddLabel(''); setAddTier('safe'); }   // reset the add form on a successful add
      clearTimer();
      timerRef.current = setTimeout(clearReveal, GEN_AUTO_CLEAR_MS);
    } catch {
      setError(isPin ? 'Could not unlock — check your PIN and try again.' : 'Could not unlock — try again.');
    } finally {
      ownerSk?.fill(0);
      derived?.fill(0);
      setRotatingIndex(null);
      setBusy(false);
    }
  };

  const startAdd = () => {
    setError(null);
    setRotatingIndex(null);
    if (isPin) setShowPin(true);   // PIN scheme → collect the PIN first
    else doDerive();               // PRF → Face ID directly
  };

  // Rotate — ATOMIC: derive-at-target, commit-on-success. This does NOT pre-bump keyVersion; doDerive derives at
  // the TARGET version (stored kv + 1) and commits { pubkeyHex, npub, keyVersion } in ONE updateViewerSlot only on
  // success. So a Face-ID cancel / wrong PIN is a true no-op — the slot is untouched and the old key keeps working
  // (nothing is invalidated until the new key is actually issued). Determinism holds because the target is always
  // stored-kv + 1 at derive time; keyVersion always means "version of the key currently issued," never "next."
  const startRotate = (slot: ViewerSlot) => {
    setError(null);
    // eslint-disable-next-line no-alert
    if (!window.confirm(
      'Rotating invalidates this viewer\'s current key — their device stops receiving updates until they sign in ' +
      'again with a new token. Rotate?'
    )) return;
    setRotatingIndex(slot.index);
    if (isPin) setShowPin(true);
    else doDerive();
  };

  if (revealedToken) {
    return (
      <div className={styles.genBlock}>
        <SecretKeyCard nsec={revealedToken} hint="Hand this to the viewer — it includes your npub." />
        <div className={styles.revealFoot}>
          <button type="button" className={styles.actionBtn} onClick={clearReveal}>Hide</button>
          <span className={styles.desc}>
            Encrypted — safe to send remotely. Share the passphrase separately. Auto-hides in ~30s.
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Roster — one card per provisioned viewer */}
      {viewers.map((slot) => (
        <div key={slot.index} className={styles.grantCard}>
          <div className={styles.grantHead}>
            <span className={styles.grantDot} />
            <span className={styles.grantName}>
              {slot.label || 'Viewer'}{' '}
              <span className={styles.grantNpub}>({slot.npub.slice(0, 12)}…{slot.npub.slice(-6)})</span>
            </span>
            <span className={styles.grantActive}>{slot.tier === 'trusted' ? 'TRUSTED' : 'SAFE'}</span>
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleLabel}>
              <span className={styles.toggleTitle}>Show real figures</span>
              <span className={styles.toggleHint}>Off: health only · On: balances + liquidation prices</span>
            </div>
            <Toggle value={slot.tier === 'trusted'} onChange={(v) => setTier(slot, v)} />
          </div>
          {confirmRemoveIndex === slot.index ? (
            <div className={styles.confirmRow}>
              <span className={styles.confirmText}>Their device stops receiving updates. Remove?</span>
              <button className={styles.revokeBtn} onClick={() => remove(slot)}>Remove</button>
              <button className={styles.actionBtn} onClick={() => setConfirmRemoveIndex(null)}>Cancel</button>
            </div>
          ) : (
            <div className={styles.rowActions}>
              <button type="button" className={styles.actionBtn} onClick={() => startRotate(slot)} disabled={busy}>↻ Rotate</button>
              <button type="button" className={styles.revokeBtn} onClick={() => setConfirmRemoveIndex(slot.index)}>Remove</button>
            </div>
          )}
        </div>
      ))}

      {/* Add a viewer — mint a key from your own identity (regenerable; the token includes your npub). */}
      <div className={styles.genBlock}>
        <p className={styles.desc}>
          Add a viewer — a key is derived from your identity (regenerable, no separate backup). Hand them the shown
          token. A passphrase is required — the token is always encrypted; share the passphrase separately.
        </p>
        <input
          className={styles.input}
          type="text"
          placeholder="Nickname (e.g. Dad's iPhone)"
          value={addLabel}
          onChange={(e) => setAddLabel(e.target.value)}
          disabled={busy || showPin}
        />
        <div className={styles.rowActions}>
          <button
            type="button"
            className={addTier === 'safe' ? styles.genBtn : styles.actionBtn}
            onClick={() => setAddTier('safe')}
            disabled={busy || showPin}
          >
            Safe
          </button>
          <button
            type="button"
            className={addTier === 'trusted' ? styles.genBtn : styles.actionBtn}
            onClick={() => setAddTier('trusted')}
            disabled={busy || showPin}
          >
            Trusted
          </button>
        </div>
        <span className={styles.toggleHint}>Safe: health only · Trusted: balances + liquidation prices</span>
        <input
          className={styles.input}
          type="text"
          placeholder="Passphrase (required — encrypts the token)"
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
            <PassphraseInput
              className={styles.input}
              inputMode="numeric"
              placeholder="PIN"
              value={pin}
              onChange={(v) => { setPin(v); setError(null); }}
              disabled={busy}
            />
            <button type="button" className={styles.genBtn} onClick={doDerive} disabled={busy || pin.length < 4}>
              {busy ? 'Deriving…' : (rotatingIndex !== null ? 'Rotate' : 'Add')}
            </button>
            <button type="button" className={styles.actionBtn} onClick={() => { setShowPin(false); setPin(''); setRotatingIndex(null); setError(null); }} disabled={busy}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className={styles.genBtn} onClick={startAdd} disabled={busy}>
            {busy ? 'Deriving…' : '🔑 Add viewer'}
          </button>
        )}
        {error && <p className={styles.error}>{error}</p>}
        <span className={styles.desc}>Requires {isPin ? 'your PIN' : 'Face ID'} — shown only on this device, never stored in plain text.</span>
      </div>
    </>
  );
}
