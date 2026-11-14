# 003 — Make navigation feedback prompt

- **Status**: DONE
- **Commit**: 59e46ca
- **Severity**: MEDIUM
- **Category**: Easing/duration, performance
- **Estimated scope**: css/style.css, js/nav-menu.js; related cache versions

## Problem

`js/nav-menu.js:22` waits350ms before navigation; `css/style.css:172` animates indicator `left` for350ms and link color for350ms. This is ordinary UI feedback, not an explanatory sequence.

## Target

Indicator uses `transform: translateX(0/100%/200%)` for its three equal-width segments, with200ms `cubic-bezier(0.23,1,0.32,1)` (playbook UI ease-out). Pointer navigation delay is at most200ms. Keyboard-triggered navigation proceeds natively with no artificial delay. Pointer animation remains active regardless of the OS motion preference, per subsequent user feedback. Keep colors, pill geometry and current-page mapping.

## Repo conventions to follow

Keep delegated click handling, modifier/button/download/target guards, timer cancellation, selected data attributes and aria-current CSS selectors. Put the curve/duration in scoped reusable CSS custom properties if useful; do not invent a separate theme.

## Steps

1. Change indicator CSS and all current-page selectors to transform positioning; retain the static left0 anchor.
2. Change the JS target to inline transform, remove350ms wait and use200ms for pointer feedback. Retain cancellation on rapid alternate-link clicks.
3. Return early for event.detail===0 so keyboard/programmatic activation follows native navigation. Keep visible focus and meaningful reduced color/opacity feedback.
4. Match link color timing to200ms and update all nav-menu/style cache references.

## Boundaries

Do not change links, labels, active-page semantics, nav size or header alignment. No page-wide entrance effects and no new libraries. Navigation must continue without JS.

## Verification

- `node --check js/nav-menu.js`; `git diff --check`.
- Feel check all three destinations by pointer and keyboard. Confirm indicator aligns exactly with each third and old→new selection remains interruptible. Delay ≤200ms plus browser scheduling; keyboard no scheduled wait. Modifier clicks keep native behavior.
- Done when current states and page destinations are correct in normal and reduced modes.
