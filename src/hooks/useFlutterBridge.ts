import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

declare global {
  interface Window {
    flutter_inappwebview?: {
      callHandler: (handlerName: string, ...args: unknown[]) => void;
    };
    navigateTo?: (path: string) => void;
    appBack?: () => void;
    isRootRoute?: () => boolean;
  }
}

const TAB_ROUTES = new Set(['/', '/at-home', '/explore', '/bookings', '/profile']);

/** Internal navigation stack — single source of truth for back navigation. */
const routeStack: string[] = [window.location.pathname || '/'];

/** 🔧 Back-navigation guard — blocks stale navigateTo calls after appBack */
let isHandlingBack = false;
let lastBackTime = 0;
const BACK_GUARD_MS = 300;

/**
 * Remove routes matching a prefix from the stack.
 */
export function cleanRouteStack(prefix: string) {
  for (let i = routeStack.length - 1; i >= 0; i--) {
    if (routeStack[i].startsWith(prefix)) {
      routeStack.splice(i, 1);
    }
  }
  if (routeStack.length === 0) {
    routeStack.push('/');
  }
}

export function useFlutterBridge() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // ──────────────────────────────────────────────────────────
  // 🔧 DEBUG BLOCK START — remove this entire block after testing
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;

    window.history.pushState = function (...args: Parameters<typeof originalPush>) {
      console.log('🚨 PUSH STATE:', args[2]);
      return originalPush.apply(this, args);
    };

    window.history.replaceState = function (...args: Parameters<typeof originalReplace>) {
      console.log('✅ REPLACE STATE:', args[2]);
      return originalReplace.apply(this, args);
    };

    return () => {
      window.history.pushState = originalPush;
      window.history.replaceState = originalReplace;
    };
  }, []);
  // 🔧 DEBUG BLOCK END
  // ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (routeStack.length === 0) {
      routeStack.push(window.location.pathname || '/');
    }
  }, []);

  // --- Sync route stack + notify Flutter on every route change ---
  useEffect(() => {
    const path = location.pathname;
    const top = routeStack[routeStack.length - 1];

    // 🔧 DEBUG LOG — remove after testing
    console.log('📍 ROUTE CHANGED:', path, '| stack:', [...routeStack]);

    if (path === '/') {
      routeStack.length = 1;
      routeStack[0] = '/';
    } else if (top !== path) {
      if (TAB_ROUTES.has(path)) {
        // Tab routes always replace the current top entry
        if (routeStack.length > 0) {
          routeStack[routeStack.length - 1] = path;
        } else {
          routeStack.push(path);
        }
      } else {
        // Inner page — push normally
        routeStack.push(path);
      }
      // 🔧 DEBUG LOG — remove after testing
      console.log('📦 STACK UPDATED:', [...routeStack]);
    }

    try {
      if (window.flutter_inappwebview) {
        window.flutter_inappwebview.callHandler('routeChanged', path);
      }
    } catch (_) { /* bridge not ready */ }
  }, [location.pathname]);

  // --- Expose navigateTo / appBack / isRootRoute ---
  useEffect(() => {
    window.navigateTo = (path: string) => {
      if (!path) return;

      const current = window.location.pathname;

      console.log('🧭 navigateTo called:', {
        path,
        current,
        timestamp: Date.now(),
        stack: [...routeStack],
      });

      // GUARD: ignore if already on this route
      if (current === path) {
        console.log('⏭️ navigateTo ignored: same route');
        return;
      }

      // GUARD: ignore if back was just triggered
      if (isHandlingBack || (Date.now() - lastBackTime < BACK_GUARD_MS)) {
        console.log('⏭️ navigateTo ignored: back guard active');
        return;
      }

      // GUARD: ignore if stack top already matches
      const top = routeStack[routeStack.length - 1];
      if (top === path) {
        console.log('⏭️ navigateTo ignored: stack top matches');
        return;
      }

      try {
        if (TAB_ROUTES.has(path)) {
          if (routeStack.length > 0) {
            routeStack[routeStack.length - 1] = path;
          } else {
            routeStack.push(path);
          }
        } else {
          routeStack.push(path);
        }
        navigateRef.current(path, { replace: TAB_ROUTES.has(path) });
      } catch (e) {
        console.error('Navigation error:', e);
      }
    };

    window.appBack = () => {
      const currentPath = routeStack[routeStack.length - 1] || '/';

      // 🔧 DEBUG LOG — remove after testing
      console.log('🔙 appBack triggered at:', currentPath, '| stack:', [...routeStack]);

      // 🔧 Set back guard
      isHandlingBack = true;
      lastBackTime = Date.now();
      setTimeout(() => { isHandlingBack = false; }, BACK_GUARD_MS);

      // If on a non-home tab, go home
      if (TAB_ROUTES.has(currentPath) && currentPath !== '/') {
        // 🔧 DEBUG LOG — remove after testing
        console.log('➡️ Tab → navigating to HOME');
        routeStack.length = 1;
        routeStack[0] = '/';
        if (window.location.pathname !== '/') {
          navigateRef.current('/', { replace: true });
        }
        try {
          window.flutter_inappwebview?.callHandler('routeChanged', '/');
        } catch (_) { /* bridge not ready */ }
        return;
      }

      // If on home or stack ≤ 1, let Flutter handle exit
      if (currentPath === '/' || routeStack.length <= 1) {
        // 🔧 DEBUG LOG — remove after testing
        console.log('🏁 ROOT reached — Flutter should exit');
        routeStack.length = 1;
        routeStack[0] = '/';
        return;
      }

      // Inner page — pop and go back
      routeStack.pop();
      const previous = routeStack[routeStack.length - 1];
      // 🔧 DEBUG LOG — remove after testing
      console.log('⬅️ Inner page back →', previous, '| stack:', [...routeStack]);
      if (window.location.pathname !== previous) {
        navigateRef.current(previous, { replace: true });
      }
      try {
        window.flutter_inappwebview?.callHandler('routeChanged', previous);
      } catch (_) { /* bridge not ready */ }
    };

    window.isRootRoute = () =>
      routeStack.length <= 1 || window.location.pathname === '/';

    const blockPopState = (e: PopStateEvent) => {
      e.stopImmediatePropagation();
      const top = routeStack[routeStack.length - 1];
      // 🔧 DEBUG LOG — remove after testing
      console.log('🛑 popstate BLOCKED | browser:', window.location.pathname, '| stack top:', top);
      if (window.location.pathname !== top) {
        window.history.replaceState(null, '', top);
      }
    };

    window.addEventListener('popstate', blockPopState);

    return () => {
      window.removeEventListener('popstate', blockPopState);
      delete window.navigateTo;
      delete window.appBack;
      delete window.isRootRoute;
    };
  }, []);
}