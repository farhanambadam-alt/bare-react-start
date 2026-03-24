import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';

declare global {
  interface Window {
    flutterRefresh?: () => void;
  }
}

const THRESHOLD = 60;
const DIRECTION_LOCK_PX = 10;
const MAX_PULL = 120;

interface PullToRefreshProps {
  scrollContainerId: string;
  children: ReactNode;
}

const PullToRefresh = ({ scrollContainerId, children }: PullToRefreshProps) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startY = useRef(0);
  const startX = useRef(0);
  const directionLocked = useRef<'vertical' | 'horizontal' | null>(null);
  const pulling = useRef(false);

  const getScrollContainer = useCallback(
    () => document.getElementById(scrollContainerId),
    [scrollContainerId],
  );

  const isScrolledToTop = useCallback(() => {
    const el = getScrollContainer();
    return !el || el.scrollTop <= 0;
  }, [getScrollContainer]);

  /* ---- touch handlers ---- */

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      if (refreshing) return;
      const touch = e.touches[0];
      startY.current = touch.clientY;
      startX.current = touch.clientX;
      directionLocked.current = null;
      pulling.current = false;
    },
    [refreshing],
  );

  const onTouchMove = useCallback(
    (e: TouchEvent) => {
      if (refreshing) return;
      const touch = e.touches[0];
      const dy = touch.clientY - startY.current;
      const dx = touch.clientX - startX.current;

      // Direction lock on first significant movement
      if (!directionLocked.current) {
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDx < DIRECTION_LOCK_PX && absDy < DIRECTION_LOCK_PX) return;
        directionLocked.current = absDx > absDy ? 'horizontal' : 'vertical';
      }

      if (directionLocked.current === 'horizontal') return;

      // Only pull when scrolled to top and pulling down
      if (dy > 0 && isScrolledToTop()) {
        pulling.current = true;
        const distance = Math.min(dy * 0.5, MAX_PULL); // rubber-band
        setPullDistance(distance);
        if (distance > 0) e.preventDefault();
      } else {
        if (pulling.current) {
          pulling.current = false;
          setPullDistance(0);
        }
      }
    },
    [refreshing, isScrolledToTop],
  );

  const onTouchEnd = useCallback(() => {
    if (!pulling.current) {
      setPullDistance(0);
      return;
    }

    if (pullDistance >= THRESHOLD) {
      setRefreshing(true);
      setPullDistance(THRESHOLD); // snap to threshold

      if (window.flutterRefresh) {
        window.flutterRefresh();
      } else {
        window.location.reload();
      }

      // Reset after a short delay (Flutter will reload the webview)
      setTimeout(() => {
        setRefreshing(false);
        setPullDistance(0);
      }, 1500);
    } else {
      setPullDistance(0);
    }

    pulling.current = false;
    directionLocked.current = null;
  }, [pullDistance]);

  /* ---- attach listeners to scroll container ---- */

  useEffect(() => {
    const el = getScrollContainer();
    if (!el) return;

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [getScrollContainer, onTouchStart, onTouchMove, onTouchEnd]);

  return (
    <>
      {/* Pull indicator */}
      {pullDistance > 0 && (
        <div
          className="absolute top-0 left-0 right-0 z-[100] flex items-center justify-center pointer-events-none"
          style={{
            height: `${pullDistance}px`,
            transition: pulling.current ? 'none' : 'height 0.25s ease-out',
          }}
        >
          <div
            className={`w-6 h-6 border-2 border-primary border-t-transparent rounded-full ${
              refreshing ? 'animate-spin' : ''
            }`}
            style={{
              opacity: Math.min(pullDistance / THRESHOLD, 1),
              transform: refreshing
                ? 'none'
                : `rotate(${(pullDistance / THRESHOLD) * 360}deg)`,
            }}
          />
        </div>
      )}
      {children}
    </>
  );
};

export default PullToRefresh;
