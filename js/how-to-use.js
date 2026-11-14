window.addEventListener('DOMContentLoaded', () => {
    const previews = [...document.querySelectorAll('[data-morph-word]')];
    const morph = window.FinglyphGlyphMorph;
    const introSlide = document.querySelector('.how-to-use-slide--intro');
    const introWords = document.querySelector('.how-to-use-intro-words');
    const introCopy = document.querySelector('.how-to-use-intro-copy');

    function positionIntroWords() {
        if (!introSlide || !introWords || !introCopy) return;

        introWords.style.transform = '';
        const slideBounds = introSlide.getBoundingClientRect();
        const wordBounds = introWords.getBoundingClientRect();
        const copyBounds = introCopy.getBoundingClientRect();
        const headerHeight = document.querySelector('.top-fixed')?.getBoundingClientRect().height ?? 0;
        const centeredTop = slideBounds.top + (slideBounds.height - wordBounds.height - headerHeight) / 2;
        const clearTop = copyBounds.top - wordBounds.height - 20;
        const targetTop = Math.max(slideBounds.top + 16, Math.min(centeredTop, clearTop));

        introWords.style.transform = `translateY(${targetTop - wordBounds.top}px)`;
    }

    previews.forEach(preview => {
        morph?.renderWord(preview, preview.dataset.morphWord);
    });
    positionIntroWords();
    document.fonts?.ready.then(positionIntroWords);

    window.addEventListener('resize', () => {
        previews.forEach(preview => {
            morph?.sizeWordCard(preview.querySelector('.word-container'), preview.clientWidth);
        });
        positionIntroWords();
    });

    const scrollArea = document.querySelector('.info-content');
    const inputSlide = document.querySelector('.how-to-use-slide--input');
    const input = inputSlide?.querySelector('#howToUseTextInput');

    async function animateIllustrations() {
        if (!scrollArea || document.documentElement.classList.contains('is-mobile-device')) return;

        // Keep the original images as the no-script / failed-load fallback.
        const illustrations = await Promise.all([
            '.how-to-use-scroll-cue', '.how-to-use-30cm', '.how-to-use-paw'
        ].map(async selector => {
            const image = document.querySelector(selector);
            if (!image) return null;
            try {
                const response = await fetch(image.src);
                if (!response.ok) return null;
                const parsed = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
                if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') return null;
                const svg = document.importNode(parsed.documentElement, true);
                for (const { name, value } of image.attributes) {
                    if (name !== 'src' && name !== 'alt') svg.setAttribute(name, value);
                }
                svg.setAttribute('focusable', 'false');
                if (image.alt) {
                    svg.setAttribute('role', 'img');
                    svg.setAttribute('aria-label', image.alt);
                }
                image.replaceWith(svg);
                return svg;
            } catch {
                return null;
            }
        }));

        const svgNamespace = 'http://www.w3.org/2000/svg';
        const easeOut = 'cubic-bezier(0.23, 1, 0.32, 1)';
        const records = [];
        function groupPaths(svg, paths) {
            const group = document.createElementNS(svgNamespace, 'g');
            svg.append(group);
            group.append(...paths);
            return group;
        }
        function draw(path, duration, delay) {
            const length = path.getTotalLength() + 1;
            return path.animate([
                { strokeDasharray: `${length} ${length}`, strokeDashoffset: length },
                { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 }
            ], { duration, delay, easing: 'ease-out', fill: 'backwards' });
        }
        function pencilBoil(svg) {
            // These illustrations use only absolute M/L/C coordinates, so control points can
            // vary without changing commands, topology, or the original asset on disk.
            return [...svg.querySelectorAll('path')].map((path, pathIndex) => {
                const original = path.getAttribute('d');
                const frames = [original, ...[0, 1, 2].map(frame => {
                    let coordinate = 0;
                    return original.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, value => {
                        const offset = Math.sin(++coordinate * 1.7 + pathIndex * 2.1 + frame * 2.4) * 0.38;
                        return (Number(value) + offset).toFixed(3);
                    });
                }), original];
                const animation = document.createElementNS(svgNamespace, 'animate');
                Object.entries({
                    attributeName: 'd', values: frames.join(';'), keyTimes: '0;0.25;0.5;0.75;1',
                    dur: '0.56s', calcMode: 'discrete', repeatCount: 'indefinite', begin: 'indefinite'
                }).forEach(([name, value]) => animation.setAttribute(name, value));
                path.append(animation);
                return animation;
            });
        }
        function register(svg, play, boil = pencilBoil(svg)) {
            records.push({ svg, slide: svg.closest('.how-to-use-slide'), play, boil, animations: [], active: false });
        }

        const [scrollCue, distance, paw] = illustrations;
        if (scrollCue) {
            const paths = [...scrollCue.querySelectorAll('path')];
            const arrows = [0, 2, 4].map(index => groupPaths(scrollCue, paths.slice(index, index + 2)));
            register(scrollCue, () => arrows.flatMap((arrow, index) => {
                const delay = 150 + index * 170;
                return [
                    draw(arrow.children[0], 360, delay),
                    draw(arrow.children[1], 180, delay + 240),
                    arrow.animate([
                        { transform: 'translateY(0)' },
                        { transform: 'translateY(5px)', offset: 0.45 },
                        { transform: 'translateY(0)' }
                    ], { duration: 460, delay: delay + 450, easing: 'ease-in-out' })
                ];
            }));
        }

        if (distance) {
            // The source SVG contains seven laptop paths, the hand, then three arrow paths.
            const paths = [...distance.querySelectorAll('path')];
            const hand = groupPaths(distance, [paths[7]]);
            hand.style.transformBox = 'fill-box';
            hand.style.transformOrigin = '50% 80%';
            register(distance, () => [
                hand.animate([
                    { transform: 'translateX(-14px) rotate(-3deg)' },
                    { transform: 'translateX(2px) rotate(0.3deg)', offset: 0.75 },
                    { transform: 'translateX(0) rotate(0)' }
                ], { duration: 780, delay: 100, easing: easeOut, fill: 'backwards' }),
                ...paths.slice(8).map((path, index) => draw(path, index === 0 ? 500 : 180, [780, 1180, 1270][index])),
                // A single emphasis on the existing webcam dot follows one full second of stillness.
                paths[2].animate([{ strokeWidth: 2 }, { strokeWidth: 3 }, { strokeWidth: 2 }], {
                    duration: 360, delay: 1880, easing: 'ease-in-out'
                })
            ]);
        }

        if (paw) register(paw, () => []);

        const visibleSlides = new Set();
        let pageActive = true;
        function syncMotion() {
            for (let index = records.length - 1; index >= 0; index--) {
                const record = records[index];
                if (!record.svg.isConnected) {
                    record.animations.forEach(animation => animation.cancel());
                    if (record.active) record.boil.forEach(animation => animation.endElement());
                    records.splice(index, 1);
                    continue;
                }
                const active = pageActive && visibleSlides.has(record.slide) && !document.hidden;
                if (record.active === active) continue;
                record.active = active;
                record.animations.forEach(animation => animation.cancel());
                record.animations = active ? record.play() : [];
                record.boil.forEach(animation => active ? animation.beginElement() : animation.endElement());
            }
        }
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (entry.isIntersecting && entry.intersectionRatio >= 0.65) visibleSlides.add(entry.target);
                else visibleSlides.delete(entry.target);
            }
            syncMotion();
        }, { root: scrollArea, threshold: 0.65 });
        new Set(records.map(record => record.slide)).forEach(slide => observer.observe(slide));

        document.addEventListener('visibilitychange', syncMotion);
        window.addEventListener('pageshow', () => {
            pageActive = true;
            syncMotion();
        });
        window.addEventListener('pagehide', () => {
            pageActive = false;
            syncMotion();
        });
    }
    animateIllustrations();

    if (scrollArea && inputSlide && input) {
        function resetDemoInput() {
            input.value = '';
            window.FinglyphResizeInputToContent?.(input);
        }

        resetDemoInput();
        input.addEventListener('input', () => window.FinglyphResizeInputToContent?.(input));
        document.fonts?.ready.then(() => window.FinglyphResizeInputToContent?.(input));
        window.addEventListener('pageshow', resetDemoInput);

        let wasActive = false;

        function syncInputFocus() {
            const lastSlideTop = scrollArea.scrollHeight - scrollArea.clientHeight;
            const isActive = lastSlideTop > 0
                && scrollArea.scrollTop >= lastSlideTop - scrollArea.clientHeight * 0.1;

            if (isActive && !wasActive) {
                input.focus({ preventScroll: true });
            } else if (!isActive && wasActive && document.activeElement === input) {
                input.blur();
            }

            wasActive = isActive;
        }

        scrollArea.addEventListener('scroll', syncInputFocus, { passive: true });
        window.addEventListener('pageshow', syncInputFocus);
        syncInputFocus();
    }
});
