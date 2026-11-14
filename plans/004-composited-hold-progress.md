# 004 — Keep recognition progress out of layout

- **Status**: DONE
- **Commit**: 59e46ca
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: js/hand-recognition.js, css/style.css, js/tutorial-page.js, css/tutorial_page.css

## Problem

`js/hand-recognition.js:40` and the tutorial `progress` function repeatedly update hold-fill width; both fill CSS rules transition width80ms while recognition/drawing already occupy the main thread.

## Target

Fill has fixed width100%, `transform:scaleX(0)` and `transform-origin:left center`. Update inline `transform:scaleX(clampedFraction)` instead of width, retaining80ms linear smoothing and existing reset/completion semantics. In reduced mode this state feedback can update directly without positional motion.

## Repo conventions to follow

The intro loading bar already uses transform scaleX, so copy that pattern without changing track geometry, colors, thresholds, text or timing.

## Steps

1. Locate both exact hold-fill selectors and every JS write. Convert them together; do not touch track widths.
2. Keep value clamping/reset behavior; remove any stale inline width writes.
3. Update affected cache references consistently with plan002.

## Boundaries

Do not change recognition models, thresholds, camera settings, temporal filtering or overlay drawing. No new dependencies.

## Verification

- Syntax-check both scripts; diff whitespace.
- At fractions0, .5 and1 fill geometry is empty, half and full without changing track size. Reset returns0. Inspect styles to confirm transform rather than width changes. Both normal and reduced tutorial flows complete.
- Done when fill behavior is identical and repeated updates no longer animate layout width.
