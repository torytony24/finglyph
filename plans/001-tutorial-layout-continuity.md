# 001 — Preserve tutorial layout continuity

- **Status**: DONE
- **Commit**: 59e46ca
- **Severity**: HIGH
- **Category**: Interruptibility, performance
- **Estimated scope**: js/tutorial-page.js, css/tutorial_page.css

## Problem

`js/tutorial-page.js:428` cancels active layout animations before reading each card's starting coordinates. Its inline coordinates already hold the previous destination, so resizing interrupts with a jump. The existing keyframes animate `left` and `top` for 1300ms. `css/tutorial_page.css:18` permanently advertises `will-change: top, left`.

Current implementation excerpts:

```js
layoutAnimations.forEach(animation => animation.cancel());
const from = { left: card.offsetLeft, top: card.offsetTop };
{ left: `${from.left}px`, top: `${from.top}px` }
```

## Target

Keep the exact HELLO → scattered WORLD → two simultaneous rows → FINGLYPH → green-card sequence and normal 1300ms alignment. Snapshot every card's rendered rectangle BEFORE cancellation; apply all new positions/sizes; measure destination rectangles; animate inverse `translate(...) scale(...)` to identity with WAAPI. Use existing `cubic-bezier(.2,.8,.2,1)` to preserve the approved explanatory character; the playbook allows longer explanatory motion. Keep actual layout coordinates fixed during playback. Resizing must begin at the interrupted visual position.

## Repo conventions to follow

`morphRowsIntoWordCards` already implements measured transform FLIP in this file. Continue tracking `layoutAnimations` and cancelling completed fill effects, with `waitForGestureAnimations` gating subsequent phases.

## Steps

1. Batch-read card rectangles before cancelling old effects.
2. Batch-write target coordinates, settled sizes and classes, then measure all destination rectangles. Avoid read/write interleaving per card.
3. Animate transform only, with top-left origin and the existing timing; preserve rendered size across resize with scale ratios. Do not retarget from old inline destinations.
4. Remove permanent top/left will-change. Ensure entrance scaling does not conflict with settled-card FLIP; settled cards must have a stable opaque base state.
5. Keep both row starts in one rendering update. Keep normal glyph morph and all authored layout sizes.

## Boundaries

No dependencies, content changes, new decoration, new choreography or unrelated layout changes. Preserve palette, glyph SVGs, heading500, input16vw and original finale. Coordinate with plan002 in these same files.

## Verification

- Mechanical: `node --check js/tutorial-page.js`; `git diff --check`.
- Feel check: exercise Skip and simulated accepted HELLO, verify ten scattered cards with visible centered camera, two rows, thirteen final signs and two green cards. Resize 350–650ms into alignment; compare card rectangles immediately before/after retarget (under 2px discontinuity). Inspect WAAPI keyframes: transform, not animated left/top. Slow playback and verify both rows move together and complete before brand morph.
- Done when the approved flow reaches the editor and interrupted alignment remains continuous.
