# 005 - Make WORLD become FINGLYPH in one coherent wave

- **Status**: DONE
- **Commit**: 59e46ca plus the current accepted working tree
- **Severity**: MEDIUM
- **Category**: Physicality, choreography, asynchronous continuity
- **Estimated scope**: js/tutorial-page.js, one additive helper in js/script.js, dependent cache references

## Recon and problem

This is plain JS/CSS/WAAPI, with no animation library. The product is an expressive hand-sign lettering tool. This rare explanatory transition is allowed longer timing than utility UI. The five-frame engine uses [260,120,100,120]ms holds intentionally. Preserve that engine and the already approved onboarding sequence.

`js/tutorial-page.js:morphWorldIntoBrand` creates all three extra signs from the last WORLD card:

```js
const source = SCATTER_WORD[Math.min(index, SCATTER_WORD.length - 1)];
card.style.left = lastCard.style.left;
card.style.top = lastCard.style.top;
finalLayout();
```

Consequently Y/P/H all start as fully opaque D shapes in the same place and fan out while the first five signs independently morph. Different asynchronous geometry preparation times can undermine the45ms wave. The1300ms layout tween also outlasts most600ms morph playback, leaving unnecessary tail travel.

## Target

Keep HELLO fixed. Keep the existing five WORLD cards in their aligned slots and morph them to F/I/N/G/L with45ms per-letter stagger. Introduce Y/P/H at their own final slots, using the native editor's predecessor chain L->Y, Y->P, P->H. Their presence should fade in over200ms with `cubic-bezier(0.23,1,0.32,1)` and the same per-letter45ms delay; keep the real five-frame shape morph, never replace it with a plain fade. No scale-from-zero, blur or extra decoration. Remove the common-D launch point and the redundant layout pass on this one stage.

Prepare the eight required transition geometries before replacing visible WORLD glyphs, ideally during the existing1300ms two-row alignment and650ms reading pause. Geometry must be ready as a batch so hydration order cannot create visible arrival races. Keep the existing500ms pause before the green-card morph after the last real sign animation finishes.

## Repo conventions

`window.FinglyphGlyphMorph.renderTransition` in js/script.js already reuses `prepareMorphGeometry` and its promise cache. Add a small `prepareTransitions` method that only warms that cache for an array of source/target pairs. Do not change `playMorph`, render frames, SVG assets, hydration/disposal tokens, or any editor behavior.

`waitForGestureAnimations` already waits for pending/loading morphs and layout effects; preserve its sequencing. `finalLayout` already handles resize with rendered-state FLIP; preserve it for alignment and resize, but do not run no-op1300ms animations just to introduce the three final slots.

## Steps

1. Add the cache-warming helper to the existing shared public object; use the exact same geometry function/cache as normal hydration. Return a promise; preparation failures must fall back to existing hydration/fallback behavior without aborting the tutorial.
2. Define the eight source/target pairs once: W->F, O->I, R->N, L->G, D->L, L->Y, Y->P, P->H. Start warming at the beginning of `alignWordRows` while preserving its existing animation/read pause. Gate the brand mutation on preparation completion, guard stage ownership, and avoid unhandled rejections or duplicate completion.
3. Reuse the five existing row1 cards and render their intended morphs with index*45ms delays. Append only three row1 cards at columns5,6,7 using `settle:true`, their own final positions, and predecessor-chain sources. Do not assign the D card's coordinates to them.
4. Reveal the three new wrappers via200ms opacity WAAPI with index*45ms delay and fill both. Cancel the fill effect after completion so the existing opaque settled base remains. Make sure it cannot expose unhydrated content or outlive the sign animation that gates the next phase. Do not add a spatial tween or run `finalLayout` here unless an actual resize requires it.
5. Preserve the green-card transition, original copy, final greeting and editor entry. Keep all expressive animation active even with prefers-reduced-motion=reduce: this is an explicit user requirement after a regression. Do not reintroduce plan002.
6. Bump only changed JS references and their dependency/preloader chain to `world-brand-flow-20261114`. Existing HTML content/structure and unchanged style versions remain intact.

## Boundaries

No dependencies, new UI, glyph geometry changes, camera/model/recognition changes, changes to HELLO/WORLD input/scatter/alignment, or arbitrary timing changes elsewhere. All current pending edits are the baseline, not HEAD. Do not touch original hover, heading500, input16vw or user copy.

## Verification

- Mechanical: node --check for changed JS; git diff --check. Compare `playMorph`, frame constants and existing HTML structure/copy to the copied current baseline.
- Feel check: start with aligned HELLO/WORLD. Confirm no extra opaque signs pile up over D; columns5/6/7 are at their own distinct final coordinates. Existing five signs stay put while changing shape. Observe a left-to-right45ms wave; new tail letters blend into that same rhythm. Inspect frames at slow playback and verify no late blank glyph pops or dead1300ms drift.
- Exercise full Skip and simulated accepted-input paths, normal and reported reduced-motion environments, and resize during the brand phase. Final output must remain HELLO(5)/FINGLYPH(8), with green backgrounds, original finale and editor entry; no stuck/loading states, duplicate cards, fallback glyphs or page errors.
- Done when the brand handoff is visually continuous and the entire original journey completes.

## Implementation verification

- Implemented only the eight-pair cache warm-up, in-place WORLD handoff, and three destination-slot opacity reveals. Tail reveals wait for glyph hydration and finish before the next phase can proceed.
- Shared `playMorph`, five-frame durations, all unrelated tutorial stages, styles and assets remain unchanged against the copied current baseline.
- Browser feel checks and full-path verification are pending parent-agent validation.


## Verified outcome

- Before: Y/P/H all began at the last D coordinates with opacity1 and sourceD.
- After: the five existing cards retain their DOM identity and their rendered positions (0px movement); three distinct tail slots begin at opacity0 with sourcesL/Y/P and targetY/P/H.
- Brand-stage WAAPI contains only three200ms opacity effects with225/270/315ms delays; no redundant1300ms transform pass. Native five-frame600ms morph playback is byte-for-byte unchanged.
- Reported reduced-motion=true still retains the full expressive sequence, per explicit user requirement. No suppression policy was reintroduced.
- Full accepted-input path shows HELLO+WORLD around the visible camera, completes HELLO/FINGLYPH green cards, preserves finale copy and enters the editor without page errors or fallback glyphs.
- Resizing during brand entry from1024x576 to768x480 leaves all three tail cards visible (opacity1), hydrated and correctly completed.
- Delaying Y.svg by2600ms per intercepted request keeps the original WORLD row visible until the whole geometry batch is ready; brand begins with0 blank/0 loading slots and finishes both word cards.
- Four changed JS scripts pass node --check; git diff --check passes. Every CSS file, every HTML structure/copy after stripping version strings, and original playMorph implementation match the copied baseline.
