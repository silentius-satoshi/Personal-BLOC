import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './Snackbar.module.css';

/**
 * Snackbar (Gesture & Motion System — P2) — a transient bottom toast with one action (e.g. UNDO). Portal to
 * body, above the bottom safe-area; auto-dismisses after `duration` with a thin progress hairline. role=status
 * so AT announces it. The action is a real labeled tap (undo restores data — never a gesture).
 */
export interface SnackbarProps {
  open: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  duration?: number; // ms, default 5000
}

export function Snackbar({ open, message, actionLabel, onAction, onDismiss, duration = 5000 }: SnackbarProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => onDismissRef.current(), duration);
    return () => window.clearTimeout(id);
  }, [open, duration, message]); // message in deps → a new snackbar resets the timer

  if (!open) return null;

  return createPortal(
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.card}>
        <span className={styles.msg}>{message}</span>
        {actionLabel && (
          <button className={styles.action} onClick={() => { onAction?.(); onDismiss(); }}>
            {actionLabel}
          </button>
        )}
        <span
          key={message /* restart the animation per snackbar */}
          className={styles.progress}
          style={{ animationDuration: `${duration}ms` }}
        />
      </div>
    </div>,
    document.body,
  );
}
