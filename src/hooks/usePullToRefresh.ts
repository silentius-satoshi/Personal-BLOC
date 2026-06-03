import { useState, useRef, useEffect, useCallback } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  enabled?: boolean;
  threshold?: number;
}

export function usePullToRefresh({
  onRefresh,
  enabled = true,
  threshold = 70,
}: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const pullDistanceRef  = useRef(0);
  const isRefreshingRef  = useRef(false);
  const touchStartY      = useRef<number | null>(null);

  const triggerRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    pullDistanceRef.current = 35;
    setPullDistance(35);
    try {
      await onRefresh();
    } finally {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
      pullDistanceRef.current = 0;
      setPullDistance(0);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY !== 0 || isRefreshingRef.current) return;
      touchStartY.current = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchStartY.current === null) return;
      const distance = e.touches[0].clientY - touchStartY.current;
      if (distance > 0) {
        const clamped = Math.min(distance * 0.5, threshold + 20);
        pullDistanceRef.current = clamped;
        setPullDistance(clamped);
      } else {
        touchStartY.current = null;
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      if (touchStartY.current === null) return;
      touchStartY.current = null;
      if (pullDistanceRef.current >= threshold * 0.5) {
        void triggerRefresh();
      } else {
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove',  onTouchMove,  { passive: true });
    document.addEventListener('touchend',   onTouchEnd,   { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove',  onTouchMove);
      document.removeEventListener('touchend',   onTouchEnd);
    };
  }, [enabled, threshold, triggerRefresh]);

  return { pullDistance, isRefreshing, triggerRefresh };
}
