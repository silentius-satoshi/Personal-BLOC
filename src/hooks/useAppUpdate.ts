import { useSyncExternalStore } from 'react';
import { getUpdateState, subscribeUpdate, type UpdateState } from '../lib/appUpdate';

/** BL51 — the session's update state (lib/appUpdate): the home's card and Settings → About read it. No store field. */
export function useAppUpdate(): UpdateState {
  return useSyncExternalStore(subscribeUpdate, getUpdateState, getUpdateState);
}
