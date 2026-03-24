

## Fix: Bottom Nav Tab Replay Bug

### Problem
Tapping bottom nav tabs pushes each tab path onto `routeStack`, so pressing back replays every tab visit in reverse. Native apps treat tab switches as view replacements, not stack pushes.

### Solution

Two changes:

**1. BottomNav.tsx — Use `replace` navigation for tab switches**

Change the tab `onClick` from `navigate(tab.path)` to `navigate(tab.path, { replace: true })`. This tells React Router (and the route sync effect) to replace rather than push.

**2. useFlutterBridge.ts — Handle tab routes as replacements in the route stack**

Define a set of tab paths: `['/', '/at-home', '/explore', '/bookings', '/profile']`.

In the route sync `useEffect` (lines 54-65), when the new path is a tab route, **replace** the last stack entry instead of pushing — but only if the current top is also a tab route. If navigating from an inner page to a tab (e.g. completing a flow), still replace to avoid stacking tabs.

Update `appBack()`: if the current route is a non-home tab and the stack has only one entry (or is at root), navigate to `/` instead of doing nothing. Back from `/` = app exit (stack length ≤ 1, Flutter handles exit).

### Specific Changes

| File | Change |
|------|--------|
| `src/components/BottomNav.tsx` | `navigate(tab.path, { replace: true })` on line ~119 |
| `src/hooks/useFlutterBridge.ts` | Add `TAB_ROUTES` set; modify sync effect to replace stack top for tab-to-tab switches; update `appBack` to go home from non-home tabs |

### Expected Behavior
- Tab switches: no stack growth, stack top just changes
- Back from any tab → Home (`/`)
- Back from Home → exit (stack length ≤ 1)
- Inner pages (salon, booking, artist) still push/pop normally

