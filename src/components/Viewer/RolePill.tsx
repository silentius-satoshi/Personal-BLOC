import { useStore } from '../../store/useStore';

/**
 * Viewer V5 — DORMANT role scaffolding. The seam exists so a second role (e.g. 'accountant') is
 * additive, not a rewrite: a future snapshot can carry granted roles and useGrantedRoles widens its
 * derivation; RolePill starts rendering the moment there's more than one role to distinguish.
 */

/** Derived (not stored): the roles this install has been granted. Today literally viewer-or-nothing. */
export function useGrantedRoles(): readonly string[] {
  const viewerMode = useStore((s) => s.viewerMode);
  return viewerMode ? ['viewer'] : [];
}

/** Renders NOTHING unless more than one role is granted (never today) — ships invisible. */
export function RolePill({ roles }: { roles: readonly string[] }) {
  if (roles.length <= 1) return null;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--text-faint)',
        border: '1px solid var(--border)',
        borderRadius: 999,
        padding: '2px 8px',
      }}
    >
      {roles.join(' · ')}
    </span>
  );
}
