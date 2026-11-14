# 002 — Respect reduced motion throughout the product

- **Status**: REVERTED - user requires the original expressive motion
- **Commit**: 59e46ca
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: js/script.js, js/tutorial-page.js, css/tutorial_page.css, css/start_page.css, css/info-pages.css, css/style.css; cache references

## Problem

`js/script.js:687` starts five-frame spatial morphs regardless of preference. `css/tutorial_page.css:71` only shortens camera, guide and Skip transitions; infinite floating, greeting/header/footer translations, and WAAPI transforms remain. Intro CSS replaces feedback with1ms playback. The alphabet hover has no reduced alternative.

## Target

Normal mode remains visually unchanged, including the intentional five-frame600ms stop-motion engine. Use `matchMedia('(prefers-reduced-motion: reduce)')` for JS decisions. In reduced mode use final sign shapes plus a gentle200ms opacity fade (`ease`), no spatial interpolation or stagger. Skip floating, translations, zoom and rotation; retain the approved sequence, original copy, reading pauses and useful loading progress. Tutorial WAAPI should branch to200ms opacity instead of transforms, with completion callbacks still firing. Avoid long invisible waits: match reduced visual durations in phase scheduling where applicable, while keeping meaningful reading holds and the existing six-second minimum resource-loading intro.

## Repo conventions to follow

Shared glyph helper is `window.FinglyphGlyphMorph` in js/script.js. Reuse `clearSlotTimer`/slot playback bookkeeping so disposal cancels a fade. Keep existing per-stylesheet reduced-motion queries and expand targeted selectors rather than a universal zero-duration reset.

## Steps

1. Add a shared-engine media-query check at playback time (after async geometry preparation). Render the final shape and fade it for200ms in reduced mode. Preserve stale-render tokens. Cancel reduced fades when their glyph is disposed; finish running spatial morphs safely if preference becomes reduce.
2. Tutorial: query the preference at effect creation, branch alignment and word-card FLIP to opacity-only200ms; keep backgrounds fading and phase callbacks functional. Disable scattered floating in CSS reduced rules.
3. Override greeting, preview/footer, finale, camera and guide motion in reduced CSS: final geometry can update instantly, with opacity/color feedback200ms and no translation/scale transitions. Preserve hidden states and header final position. Change entrance keyframes to fade-only in reduced mode.
4. Intro: fade-only200ms entry/exit; preserve animation names/events or update the exit listener accordingly so it advances exactly once.
5. Alphabet: add a reduced-motion-only override to remove hover scale and blur; keep a subtle opacity distinction. Do not alter the original normal-hover block (blur6px, opacity.35, scale1.08).
6. Synchronize cache query versions for every changed loaded CSS/JS and its preloader chain, consistently using `motion-polish-20261114`. HTML copy/structure must be unchanged.

## Boundaries

No global disabling of every animation. No dependency/library changes. Preserve original tutorial copy, Type anything, SVG assets, heading500, input16vw and normal choreography. Existing accepted pending changes are the baseline, not HEAD.

## Verification

- Mechanical: syntax-check changed JS, diff whitespace, compare normal engine frame-count/durations and normal alphabet-hover block to baseline.
- Feel check: emulate reduced motion before page load; exercise editor rapid typing/deletion, intro next, tutorial completion, navigation and alphabet hover. No floating/translation/zoom, final glyphs correct, gentle opacity retained, start button remains reachable. Toggle preference during an active morph and verify it finishes without stuck loading/morph classes. Normal mode still has its five-frame handmade morph.
- Done when both preference modes complete the full tutorial with correct words and preserved copy.


## Superseded by user feedback

The browser reports prefers-reduced-motion: reduce by default. Replacing the product's essential glyph morphs and tutorial movement with fades removed the intended experience. The automatic suppression introduced by this plan has been reverted. Full glyph morphs, floating, alignment, word-card movement, intro transitions and normal alphabet hover now remain active under that preference. The transform-based continuity and progress-bar performance fixes remain.
