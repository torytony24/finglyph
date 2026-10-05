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
