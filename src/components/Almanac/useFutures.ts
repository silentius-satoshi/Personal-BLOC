import { useEffect, useMemo, useRef, useState } from 'react';
import { runFuturesJob } from './futuresClient';
import type { FuturesJob } from './futuresRun';
import type { FuturesSummary } from '../../simulation/monteCarlo';
import { FUTURES_DEBOUNCE_MS } from './futuresView';

export interface FuturesState {
  /** The latest run's summary — held while a newer run goes, so the readout never blanks in the middle of a drag. */
  summary: FuturesSummary | null;
  /** The current inputs have no landed run yet. */
  running: boolean;
}

/**
 * The futures for a face's current inputs. The run is keyed by the job's CONTENT, never its identity: a face rebuilds
 * the job on every price tick (its anchor is a dependency), and an identity key would run a thousand engine runs for
 * nothing on each one — measured over nine live quotes, eight runs instead of one. A run starts once the inputs have
 * held still for FUTURES_DEBOUNCE_MS, and a result for inputs that have moved on since is dropped. A `null` job runs
 * nothing and keeps the last summary.
 */
export function useFutures(job: FuturesJob | null): FuturesState {
  const key = useMemo(() => (job === null ? null : JSON.stringify(job)), [job]);
  const jobRef = useRef(job);
  jobRef.current = job;
  const [state, setState] = useState<FuturesState>({ summary: null, running: job !== null });

  useEffect(() => {
    const current = jobRef.current;
    if (key === null || current === null) return undefined;
    let live = true;
    setState((s) => (s.running ? s : { ...s, running: true }));
    const timer = setTimeout(() => {
      void runFuturesJob(current).then((summary) => {
        if (live && summary !== null) setState({ summary, running: false });
      });
    }, FUTURES_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [key]);

  return state;
}
