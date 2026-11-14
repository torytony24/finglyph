# Animation refinement

Current policy after user feedback: preserve the original expressive animations even when the browser reports reduced motion. Plan002 and its earlier reduced-motion verification describe a superseded implementation. Tutorial continuity, transform progress and200ms pointer navigation remain; keyboard navigation remains native.

Baseline: 59e46ca plus all accepted working-tree edits as of2026-11-14. Product: plain HTML/CSS/JS with CSS and WAAPI; playful hand-sign lettering. Frequent editor morphs are intentional product feedback; occasional navigation should be brief; rare explanatory onboarding keeps its authored longer timing. No motion framework or redesign.

All eight audit categories reviewed. Verified findings are planned below. Physical origin and existing glyph-disposal tokens are already appropriate. The deliberate glyph stop-motion, existing tutorial sequence, six-second intro loading minimum and normal alphabet hover are preserved. No additive animation opportunities were verified.

| Plan | Severity | Status | Dependencies |
| --- | --- | --- | --- |
|001 Tutorial layout continuity|HIGH|DONE|None|
|002 Reduced motion|MEDIUM|REVERTED per user feedback|001; touches shared tutorial effects|
|003 Navigation feedback|MEDIUM|DONE|Coordinate shared CSS with002|
|004 Recognition hold progress|MEDIUM|DONE|Coordinate tutorial/shared styles with002|
|005 WORLD-to-FINGLYPH handoff|MEDIUM|DONE|Keep plan002 retired; preserve expressive glyph motion|

Plans001,003,004 remain implemented. Plan002 is retired by explicit user feedback; do not reapply it.


## Verification ? 2026-11-14

- Default tutorial completed HELLO ? scattered WORLD (10 cards, camera visible) ? simultaneous rows ? FINGLYPH ? two green cards ? editor, with no page errors.
- At1280?720, retargeting350ms into alignment changed maximum discontinuity from405.75px on the copied baseline to0.000004px after transform FLIP. Recorded layout keyframes contain transform rather than animated left/top.
- Reduced-motion tutorial accepted five simulated letters, showed ten non-floating signs, used only200ms opacity WAAPI, preserved the original finale copy and reached the editor. Hold fractions0/.5/1 rendered exactly0%/50%/100% via scaleX, with no inline width writes.
- Rapid editor replacements finished as HUMAN / HANDS. Switching preference during ZEBRA morph finished with correct glyphs and no stuck state or page errors.
- Measured navigation: normal pointer205.1ms; reduced pointer1.3ms; keyboard0.8ms. Indicator alignment error0px (width rounding0.013px).
- Both intro modes advanced once with progress100 and eight preview glyphs. Normal entry retained480ms movement; reduced entry used200ms opacity-only keyframes. Resource readiness was mocked for this animation-isolation check; the six-second minimum remains unchanged.
- Normal alphabet hover still computes scale1.08, blur6px, opacity.35. Reduced hover computes no transform, no filter, opacity.7.
- Six HTML structures/copy are identical to the copied baseline after stripping cache query versions. Normal glyph frame count/timings and original hover block are unchanged. All local HTML resource paths exist. Six changed scripts pass node --check; git diff --check passes. Six integrated routes returnHTTP200.
- Camera recognition acceptance/progress was simulated for animation checks; model accuracy and physical-camera inference were not changed.

- Integrated-source check: actual viewport resize from1280x720 to960x600 during alignment produced0px discontinuity, completed both final words, and had0 fallback glyphs.


## Expressive-motion restoration

The active browser reported reduced motion=true. The added automatic fade substitution removed the core experience. Removed that substitution from shared glyph playback, tutorial WAAPI and CSS, intro CSS, alphabet hover and pointer navigation. The shared glyph script exactly matches the pre-refinement baseline. In the active reduced-motion browser, a Z glyph rendered multiple distinct shapes over approximately649ms and finished correctly. The default tutorial again ran1300ms alignment and1100ms word-card motion, reached HELLO/FINGLYPH green cards and entered the editor without page errors. Asset queries use motion-restored-20261114. Layout-continuity and progress-performance fixes are retained.

Confirmed with reduced-motion=true: all10 scattered signs floated,36 spatial WAAPI effects retained1300ms/1100ms timing, final words were HELLO and FINGLYPH, and no fallback glyphs appeared.

Plan005 completed: five signs morph in place, three tail signs reveal at independent destination slots with a synchronized45ms wave, cached geometry gates all changes, and the original500ms green-card pause remains. Verified full journey, reported reduced-motion=true, resize and delayed asset preparation.
