import { useRef, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const THRESHOLD = 80;        // px to trigger refresh
const MAX_PULL = 140;         // max visual pull distance
const RESISTANCE = 0.45;     // damping factor

type PullState = 'idle' | 'pulling' | 'ready' | 'refreshing';

const PullToRefresh = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [pullDistance, setPullDistance] = useState(0);
  const [state, setState] = useState<PullState>('idle');
  const startY = useRef(0);
  const startX = useRef(0);
  const pulling = useRef(false);
  const directionLocked = useRef<'vertical' | 'horizontal' | null>(null);

  const getScrollContainer = useCallback(
    () => document.getElementById('scroll-container'),
    []
  );

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      const container = getScrollContainer();
      if (!container || container.scrollTop > 0) return;
      if (state === 'refreshing') return;
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
      pulling.current = true;
      directionLocked.current = null;
    },
    [getScrollContainer, state]
  );

  const onTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!pulling.current) return;
      const container = getScrollContainer();
      if (!container || container.scrollTop > 0) {
        pulling.current = false;
        setPullDistance(0);
        setState('idle');
        return;
      }

      const deltaY = e.touches[0].clientY - startY.current;
      const deltaX = e.touches[0].clientX - startX.current;

      // Lock direction on first significant movement
      if (!directionLocked.current) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);
        if (absX < 5 && absY < 5) return; // not enough movement yet
        directionLocked.current = absX > absY ? 'horizontal' : 'vertical';
      }

      // If horizontal swipe detected, bail out entirely
      if (directionLocked.current === 'horizontal') {
        pulling.current = false;
        setPullDistance(0);
        setState('idle');
        return;
      }

      if (deltaY <= 0) {
        setPullDistance(0);
        setState('idle');
        return;
      }

      // Prevent native scroll while pulling down
      e.preventDefault();

      const damped = Math.min(deltaY * RESISTANCE, MAX_PULL);
      setPullDistance(damped);
      setState(damped >= THRESHOLD ? 'ready' : 'pulling');
    },
    [getScrollContainer]
  );

  const doRefresh = useCallback(async () => {
    setState('refreshing');
    setPullDistance(THRESHOLD * 0.6); // hold indicator visible

    // Invalidate all React Query caches
    await queryClient.invalidateQueries();

    // Minimum visible feedback
    await new Promise((r) => setTimeout(r, 600));

    setState('idle');
    setPullDistance(0);
    pulling.current = false;
  }, [queryClient]);

  const onTouchEnd = useCallback(() => {
    if (!pulling.current) return;
    pulling.current = false;

    if (state === 'ready') {
      doRefresh();
    } else {
      setState('idle');
      setPullDistance(0);
    }
  }, [state, doRefresh]);

  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [getScrollContainer, onTouchStart, onTouchMove, onTouchEnd]);

  const label =
    state === 'refreshing'
      ? 'Refreshing…'
      : state === 'ready'
        ? 'Release to refresh'
        : 'Pull to refresh';

  const progress = Math.min(pullDistance / THRESHOLD, 1);

  return (
    <>
      {/* Pull indicator — sits above the scroll content */}
      <div
        className="overflow-hidden transition-[height] duration-200 ease-out flex items-end justify-center"
        style={{
          height: pullDistance,
          transitionDuration: state === 'pulling' || state === 'ready' ? '0ms' : '200ms',
        }}
        aria-live="polite"
      >
        {pullDistance > 4 && (
          <div className="flex items-center gap-2 pb-3">
            <div
              className={`w-5 h-5 rounded-full border-2 border-primary border-t-transparent ${
                state === 'refreshing' ? 'animate-spin' : ''
              }`}
              style={{
                transform: state !== 'refreshing' ? `rotate(${progress * 360}deg)` : undefined,
                opacity: Math.min(progress * 1.5, 1),
              }}
            />
            <span className="text-[11px] font-body text-muted-foreground">{label}</span>
          </div>
        )}
      </div>
      {children}
    </>
  );
};

export default PullToRefresh;
