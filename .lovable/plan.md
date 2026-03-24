

## Problem

The previous fix added `touch-action: pan-x` to `.scrollbar-hide`, which prevents vertical touch events on horizontal scroll containers. This likely broke pull-to-refresh entirely since those containers block vertical gesture propagation. Meanwhile, pull-to-refresh is only a visual placeholder — the actual logic comes from Flutter's WebView bridge.

## Root Cause

- `touch-action: pan-x` on horizontal containers tells the browser "only allow horizontal panning here" — meaning any vertical swipe starting on a carousel/chip row is completely ignored, and the pull-to-refresh gesture never fires.
- The real issue is that horizontal scroll containers should allow **both** horizontal scrolling and vertical overscroll passthrough, just not trigger pull-to-refresh *during* an active horizontal swipe.

## Plan

### 1. Fix `.scrollbar-hide` in `src/index.css`
- **Remove** `touch-action: pan-x` (too restrictive — kills vertical gestures entirely)
- **Keep** `overscroll-behavior: contain` (prevents scroll chaining from horizontal containers without blocking pull-to-refresh on the main scroll container)

### 2. Add a custom pull-to-refresh component in `src/components/PullToRefresh.tsx`
- Replace the passive placeholder with an active touch-gesture handler on the main scroll container (`#scroll-container`)
- Track `touchstart` / `touchmove` / `touchend`:
  - Record start X/Y on `touchstart`
  - On first significant `touchmove`, determine direction: if horizontal delta > vertical delta, **abort** (let horizontal scroll happen naturally)
  - Only activate pull indicator when: scroll position is at top AND gesture is predominantly vertical (downward)
  - Use a **threshold of ~60px** vertical pull before triggering refresh
- On trigger: call `window.flutterRefresh?.()` (Flutter bridge) or fall back to `window.location.reload()`
- Show the spinner/indicator during pull with rubber-band translate effect

### 3. Integrate in `src/App.tsx`
- Wrap the `#scroll-container` div with the `PullToRefresh` component (or attach it as a wrapper around the scroll area)

### Technical Details
- The direction lock (horizontal vs vertical) is determined in the first ~10px of movement, standard for mobile gesture disambiguation
- `overscroll-behavior: contain` on `.scrollbar-hide` ensures nested horizontal scrolls don't chain to the parent, so the pull-to-refresh only activates from the main vertical scroll container
- The component uses passive touch listeners where possible for performance, with `{ passive: false }` only on the `touchmove` that needs `preventDefault` during an active pull

