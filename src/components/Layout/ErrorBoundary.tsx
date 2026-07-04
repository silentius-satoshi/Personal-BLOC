import { Component, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';

// Permanent diagnostics asset (not a temp probe) — a boot crash today renders a white screen with nothing
// to go on, especially painful on-device with no console. ErrorBoundary catches render-thrown errors;
// GlobalErrorOverlay catches async errors/rejections that never unmount React but may explain a broken
// boot. Deliberately styled inline (no CSS module, no app tokens, no icon libs) — this is the one surface
// that must still render when everything else might not, so it has no import that could itself fail.

async function copyDetails(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
  }
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: '#0d0d0d', color: '#e5e5e5',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    padding: 20, overflowY: 'auto', zIndex: 2147483647,
  } as const,
  heading: { fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: '#ff6b6b' } as const,
  label: { fontSize: 12, color: '#888', margin: '16px 0 4px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  message: { fontSize: 14, margin: '0 0 4px', wordBreak: 'break-word' as const },
  pre: {
    background: '#181818', border: '1px solid #333', borderRadius: 6, padding: 12,
    fontSize: 12, lineHeight: 1.5, maxHeight: 320, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' as const,
  },
  btnRow: { display: 'flex', gap: 10, marginTop: 16 },
  btn: {
    background: '#222', color: '#e5e5e5', border: '1px solid #444', borderRadius: 6,
    padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
  } as const,
  btnPrimary: { background: '#E8836A', color: '#0d0d0d', border: '1px solid #E8836A', fontWeight: 700 } as const,
};

function firstLines(s: string | undefined, n: number): string {
  if (!s) return '';
  return s.split('\n').slice(0, n).join('\n');
}

function CrashFallback({ message, stack, componentStack }: { message?: string; stack?: string; componentStack?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const full = [message, stack, componentStack ? `component stack:\n${componentStack}` : null]
      .filter(Boolean).join('\n\n');
    void copyDetails(full).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };
  return (
    <div style={styles.overlay}>
      <h1 style={styles.heading}>Something crashed</h1>
      {message && <p style={styles.message}>{message}</p>}
      {stack && (
        <>
          <div style={styles.label}>Stack (first 30 lines)</div>
          <pre style={styles.pre}>{firstLines(stack, 30)}</pre>
        </>
      )}
      {componentStack && (
        <>
          <div style={styles.label}>Component stack</div>
          <pre style={styles.pre}>{firstLines(componentStack, 30)}</pre>
        </>
      )}
      <div style={styles.btnRow}>
        <button style={styles.btn} onClick={handleCopy}>{copied ? 'Copied ✓' : 'Copy details'}</button>
        <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => location.reload()}>Reload app</button>
      </div>
    </div>
  );
}

interface EBState { hasError: boolean; message?: string; stack?: string; componentStack?: string }

export class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { hasError: false };

  static getDerivedStateFromError(error: Error): Partial<EBState> {
    return { hasError: true, message: error.message, stack: error.stack };
  }

  componentDidCatch(_error: Error, errorInfo: ErrorInfo) {
    this.setState({ componentStack: errorInfo.componentStack ?? undefined });
  }

  render() {
    if (this.state.hasError) {
      return (
        <CrashFallback
          message={this.state.message}
          stack={this.state.stack}
          componentStack={this.state.componentStack}
        />
      );
    }
    return this.props.children;
  }
}

// ── Global async capture (errors/rejections that don't unmount React) ────────────────────────────────

interface CapturedError { message: string; stack?: string; ts: number }

const MAX_ERRORS = 20;
let errors: CapturedError[] = [];
const listeners = new Set<() => void>();

function push(e: CapturedError) {
  errors = [...errors, e].slice(-MAX_ERRORS);
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot(): CapturedError[] {
  return errors;
}

// Registered once, at module-import time — independent of whether GlobalErrorOverlay has mounted yet.
window.addEventListener('error', (e) => {
  push({ message: e.message, stack: e.error?.stack, ts: Date.now() });
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as { message?: string; stack?: string } | undefined;
  push({ message: reason?.message ?? String(reason), stack: reason?.stack, ts: Date.now() });
});

const overlayStyles = {
  banner: {
    position: 'fixed', left: 0, right: 0, bottom: 0, maxHeight: '50vh', overflowY: 'auto',
    background: '#0d0d0d', color: '#e5e5e5', borderTop: '2px solid #ff6b6b',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    padding: 16, zIndex: 2147483647,
  } as const,
  top: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 13, fontWeight: 700, color: '#ff6b6b', margin: 0 },
  closeBtn: {
    background: 'transparent', color: '#888', border: 'none', fontSize: 16, cursor: 'pointer', lineHeight: 1,
  } as const,
  entry: { borderTop: '1px solid #262626', padding: '8px 0', fontSize: 12 },
  entryMsg: { margin: '0 0 4px', wordBreak: 'break-word' as const },
  entryMeta: { color: '#666', fontSize: 11 },
  btn: {
    background: '#222', color: '#e5e5e5', border: '1px solid #444', borderRadius: 6,
    padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4,
  } as const,
};

export function GlobalErrorOverlay() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const [dismissed, setDismissed] = useState(false);
  const lastSeenLength = useRef(0);

  if (snapshot.length > lastSeenLength.current) {
    lastSeenLength.current = snapshot.length;
    if (dismissed) setDismissed(false);   // a fresh error un-dismisses the banner
  }

  if (snapshot.length === 0 || dismissed) return null;

  const handleCopyAll = () => {
    const full = snapshot.map((e) => `${new Date(e.ts).toISOString()} ${e.message}\n${e.stack ?? ''}`).join('\n\n');
    void copyDetails(full);
  };

  return (
    <div style={overlayStyles.banner}>
      <div style={overlayStyles.top}>
        <p style={overlayStyles.title}>Unhandled errors ({snapshot.length})</p>
        <button style={overlayStyles.closeBtn} onClick={() => setDismissed(true)} aria-label="Dismiss">✕</button>
      </div>
      {snapshot.map((e, i) => (
        <div key={i} style={overlayStyles.entry}>
          <p style={overlayStyles.entryMsg}>{e.message}</p>
          <span style={overlayStyles.entryMeta}>{new Date(e.ts).toLocaleTimeString()}</span>
        </div>
      ))}
      <button style={overlayStyles.btn} onClick={handleCopyAll}>Copy details</button>
    </div>
  );
}
