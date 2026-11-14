# Keep the tutorial camera clear of the gesture guide

Written against: `59e46cae1558261022bbb4a8e13f2ed13b287829`

Status: Implemented by the coordinating agent and verified with its reported browser measurements on 2026-11-14. The audit agent reopened the implementation to reconcile this plan; it did not modify product source.

## Evidence chain

- Surface: [tutorial_page.html](../tutorial_page.html), the active hand-sign practice state, including its retry state.
- Problem: The coordinating agent measured the rendered page at CSS viewport 1280 × 400: `.camera-module` bottom = 344.25px, `.gesture-guide` top = 308px, a 36.25px overlap. At 1280 × 750 these regions are separated by 139px.
- Design evidence: [css/tutorial_page.css](../css/tutorial_page.css), initial lines 4, 8–17, establishes a centered camera module, a 420px maximum width, a 16:10 frame, and a separate guide anchored 30px above the bottom. The existing separate composition at normal height is the governing exemplar. Preserve that composition instead of repositioning its parts.
- Owner: `.camera-module` sizing in [css/tutorial_page.css](../css/tutorial_page.css), with geometry measurement in [js/tutorial-page.js](../js/tutorial-page.js) if needed.
- Runtime path: [tutorial_page.html](../tutorial_page.html), initial lines 19–35, renders both regions and loads the stylesheet and tutorial module.
- Scope and affected surfaces: Tutorial practice only; camera opened, camera permission failure, and retry visible/hidden.
- Uncertainty: None about the measured overlap. Actual retry outer height depends on the rendered font and visibility and must be measured rather than assumed.

## Design decision

Limit the camera's existing width by the height available above the current gesture guide. Maintain the camera module's existing center and its frame's 16:10 ratio. Leave the guide's position unchanged. Reuse the guide's computed column gap, currently 12px, as clearance instead of introducing another spacing value. The correction has no effect when the original camera dimensions already fit.

## Reuse

- Existing `.camera-module` width ceiling of 420px and viewport-width bound of `calc(100vw - 48px)`.
- Existing `.camera-frame` aspect ratio of `16 / 10`.
- Existing `.practice-page` centered composition and `.gesture-guide` positioning, including the existing narrow-width branch.
- Existing `.gesture-guide` computed `columnGap` as the clearance between camera and guide.
- Exemplar: Normal-height tutorial practice at 1280 × 750.
- No new shared primitive, package, component, illustration, or visual style is required.

## Changes

1. [js/tutorial-page.js](../js/tutorial-page.js)
   - `fitPracticeCamera` measures the page's vertical center and the guide's actual top in the same coordinate system while practice is visible. The implemented maximum total camera-module height is `2 * (guide.top - page.top - page.height / 2 - gap)`, where `gap` is the guide's computed column gap; no new guessed spacing value is introduced.
   - Measure the retry button's actual rendered outer height, including its vertical margins, only when displayed. Subtract this from the total allowance to derive the frame's maximum height.
   - Convert the positive frame-height allowance into width using 16/10, then constrain the original width without increasing it. A CSS custom property owned by this tutorial is sufficient to communicate the result.
   - The implementation recalculates on initial layout, font readiness, viewport resizing, and the existing retry state assignments at camera-start and its finally block; no continuous animation-frame measurement loop was added.
   - Completed, completion-pending, and hidden-guide states are guarded. No measurement observer was added.
2. [css/tutorial_page.css](../css/tutorial_page.css)
   - Add the derived width bound to `.camera-module` while retaining both existing width bounds.
   - Preserve the camera frame's ratio, assets, border radius, color, status text, guide sizing, guide position, Skip position, and completion animation.

## Scope

- Inherit: Tutorial camera sizing only.
- Verify: Normal camera, permission failure, retry visible/hidden, resize while waiting for camera permission, and successful completion/Skip transitions.
- Exclude: Editor camera, recognition logic, camera permissions behavior, gesture semantics, all copy, centered Hello sequence, navigation, alphabet hover blur/enlargement, and other page layouts.
- Preserve the four pre-existing uncommitted files and changes: [css/style.css](../css/style.css), [css/info-pages.css](../css/info-pages.css), [css/tutorial_page.css](../css/tutorial_page.css), and [js/script.js](../js/script.js). In particular, preserve brand weight 500, 38px header controls, input base width 16vw clamped to 200–420px with content growth up to 500px, and restored tutorial/Type anything copy.

## Validation

- Product: Users can see the camera and gesture instructions together in a short desktop window, including when retry is offered.
- Interface: At 1280 × 400 and 1280 × 500, after layout settles, assert `camera.bottom <= guide.top` in both retry states. At 1280 × 750, assert the original 420px camera width and centered composition remain. Also inspect the existing narrow-width branch and resizing between these sizes.
- System: Use current guide geometry and actual retry height; do not duplicate breakpoint-specific guide dimensions in JavaScript.
- Repository: `git diff --check` → no whitespace errors; `node --input-type=module --check < js/tutorial-page.js` from a shell supporting input redirection → no syntax errors. On PowerShell use `Get-Content -Raw js/tutorial-page.js | node --input-type=module --check`.

### Recorded verification

Browser results supplied by the implementing/coordinating agent, using actual CSS viewports:

| Viewport | Camera width | Camera bottom | Guide top | Clearance |
| --- | --- | --- | --- | --- |
| 1280 × 400, retry visible | 265.59375px | 295.984375px | 308px | 12.015625px |
| 1280 × 500 | 420px | Measured by coordinator | Measured by coordinator | 13.75px |
| 1280 × 750 | 420px | Measured by coordinator | Measured by coordinator | 138.75px |
| 500 × 720 | 420px | Not separately reported | Not separately reported | Not separately reported |

The short-height overlap is removed, while normal-height and narrow-window camera width remains 420px where space permits. Source reconciliation confirmed measured retry outer height, the 16:10 ratio, the existing width bounds, and the lifecycle guards/calls. The audit agent did not independently rerun browser or repository checks; repository commands above remain the executor's check list, not additional claimed results.

## Stop conditions

- Stop expanding scope if the available viewport is too small to preserve readable camera status and instructions even after frame sizing; report that limit instead of inventing a new layout.
- Recheck the evidence if the camera or guide ownership/composition changes during implementation.

## Design documentation

- None. No additional governance or design-document changes are requested.
