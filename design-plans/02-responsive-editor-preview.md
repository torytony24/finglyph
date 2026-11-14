# Match the tutorial's editor preview to the existing responsive editor

Written against: `59e46cae1558261022bbb4a8e13f2ed13b287829`

Status: Implemented by the coordinating agent and verified with its reported browser measurements on 2026-11-14. The audit agent reopened the implementation to reconcile this plan; it did not modify product source.

## Evidence chain

- Surface: [tutorial_page.html](../tutorial_page.html), the `.practice-page.is-main-preview` phase that previews the [main_page.html](../main_page.html) editor.
- Problem: The coordinating agent measured the actual editor at CSS viewport 500 × 720: title font 48px, left 16px, top 20px, header height 129.1875px, footer padding 20px 16px. The tutorial preview continues to use a 66px title, left 36px/top 24px, 127px header height, 36px content gutters, and footer padding 36px.
- Design evidence: The existing responsive editor is the governing exemplar, specifically [css/style.css](../css/style.css), initial lines 538–575. The tutorial deliberately moves its brand, cards, and footer into an editor composition via `.is-main-preview`, [css/tutorial_page.css](../css/tutorial_page.css), initial lines 20–46, and `startMainPreview`, [js/tutorial-page.js](../js/tutorial-page.js), initial lines 238–244.
- Owner: Tutorial preview presentation in [css/tutorial_page.css](../css/tutorial_page.css); brand/card coordinate calculations in [js/tutorial-page.js](../js/tutorial-page.js).
- Runtime path: [tutorial_page.html](../tutorial_page.html) renders the greeting, cards, and footer; the tutorial module adds `.is-main-preview`, computes header shifts, and resizes its input through the existing shared helper.
- Scope and affected surfaces: Tutorial editor preview, its card staging calculations, and resize while the preview is active. The actual editor remains the reference and is not redesigned.
- Uncertainty: None for the measured mismatch. Verify the current editor's actual header height at each test width rather than relying solely on rounded arithmetic.

## Design decision

Apply the existing editor's responsive typography and geometry to the corresponding tutorial preview. Preserve the original centered 66px Hello/Finglyph introduction. Scope responsive brand font changes to `.is-main-preview` and compute the destination after those styles apply.

## Reuse

- Existing tutorial `--main-gutter` and `--main-header-height` tokens.
- Existing editor narrow breakpoint of 767px, title `clamp(32px, 10vw, 48px)` with line-height 1.15, horizontal gutter 16px, title top 20px, footer padding 20px 16px, and 38px header-control height.
- Introduce a tutorial-local header-top token with desktop value 24px and narrow value 20px so CSS and coordinate calculation express the same destination. Do not create a new shared component or import the global editor stylesheet into the tutorial.
- Exemplar: [css/style.css](../css/style.css), its normal and narrow editor compositions.

## Changes

1. [css/tutorial_page.css](../css/tutorial_page.css)
   - Keep desktop preview defaults: gutter 36px, header height 127px, title 66px/79px, title top 24px, footer vertical padding 36px, and brand weight 500.
   - At widths up to 767px, resolve the preview gutter to 16px, title destination top to 20px, and preview footer padding to 20px 16px.
   - Only in `.is-main-preview`, use the editor's responsive title font and line-height. Keep the centered introduction unchanged, including its original 66px greeting, Playfair Hello, wording, and timing.
   - Resolve the narrow preview header height from the existing editor composition: top 20px + title line box + gap 16px + controls 38px. Check actual rounding against the editor, including the measured 129.1875px at width 500.
   - Keep the existing card padding, green strip, row-gap formula, input typography/background, and animation treatment.
2. [js/tutorial-page.js](../js/tutorial-page.js)
   - Replace `updateHeaderShift`'s hardcoded x36/y24 with resolved tutorial gutter and header-top values.
   - Add `.is-main-preview` before measuring the brand's destination offsets so the responsive preview font is already active. Preserve the intended move animation and existing finale delay.
   - Derive the horizontal origin and available width in `finalCardPosition` and `setWordCardLayout` from the same resolved gutter instead of hardcoding 36 and 72. Preserve current card-size ceilings, row-gap behavior, and default desktop results.
   - Recompute the resolved geometry when resizing the active preview. Continue using the existing shared `FinglyphResizeInputToContent` helper.

## Scope

- Inherit: Tutorial preview brand, matching card gutters, and preview footer geometry.
- Verify: Centered greeting, brand collapse, card alignment/morph, preview movement, finale, and resize during the preview.
- Exclude: Main editor redesign, extra navigation or controls in the preview, copy changes, alphabet hover blur/enlargement, recognition, introduction restyling, and unrelated pages.
- Preserve the four existing uncommitted changes in [css/style.css](../css/style.css), [css/info-pages.css](../css/info-pages.css), [css/tutorial_page.css](../css/tutorial_page.css), and [js/script.js](../js/script.js). Maintain h1/brand weight 500, aligned 38px controls, input width 16vw clamped to 200–420px with content growth up to 500px, and original tutorial/Type anything copy.

## Validation

- Product: The tutorial's editor-preview phase has the same brand/card/input geometry as the editor at the same viewport width.
- Interface: Compare actual editor and preview at 500 × 720, 800 × 750, and 1280 × 750. At width 500 verify brand left 16px/top 20px/font 48px, header height approximately 129.1875px, and footer padding 20px 16px. At widths 800 and 1280 preserve the existing 66px title, x36/y24, and 127px header. Verify the original centered Hello remains 66px before preview in every case.
- System: Reuse the tutorial's resolved gutter and header-top values for CSS and JavaScript rather than separate width tests or duplicated x coordinates. Do not alter shared editor sizing or introduce a parallel component system.
- Repository: `git diff --check` → no whitespace errors; PowerShell `Get-Content -Raw js/tutorial-page.js | node --input-type=module --check` → no syntax errors. Inspect the final diff to confirm existing changes remain and alphabet hover CSS is untouched.

### Recorded verification

The coordinating agent exercised the full Skip → editor preview → finale → start → editor path at an actual CSS viewport of 500 × 720 and reported no page errors. The original centered greeting remains 66px, and the original tagline is intact.

| Property | Tutorial preview | Actual editor |
| --- | --- | --- |
| Brand font size | 48px | 48px |
| Brand left/top | 16.203px / 20.406px | 16px / 20px |
| First card left/top | 16px / 153.2px | 16px / 153.1875px |
| Input left/top | 16px / 664px | 16px / 664px |
| Input width/height | 200px / 36px | 200px / 36px |
| Footer padding | 20px 16px | 20px 16px |

The small brand-coordinate difference reflects subpixel offset rounding; the reported difference is below half a CSS pixel. Source reconciliation confirmed the preview class is applied before destination measurement, shared `mainLayoutMetrics` resolves `--main-gutter` and `--main-header-top`, and responsive greeting sizing is scoped to `.is-main-preview`. Normal-width 66px/79px defaults, 36px gutter, 24px header top, and 127px header height remain in source. The audit agent did not independently rerun browser or repository checks; the broader viewport and repository commands above remain the executor's check list, not additional claimed results.

## Stop conditions

- Re-measure and reconcile if the actual editor's responsive exemplar changes; do not force stale measured values.
- Stop expanding scope if matching the preview would require altering the original greeting, designer assets, copy, or recognition flow.

## Design documentation

- None. No additional governance or design-document changes are requested.
