// Keep the intro visible for at least six seconds while tutorial assets load.
const INTRO_DURATION_MS = 6000;
const MAX_INTRO_DURATION_MS = 15000;

const progressBar = document.querySelector('.tutorial-progress');
const progressFill = document.querySelector('.tutorial-progress__fill');
const introStep = document.querySelector('.tutorial-step--intro');
const nextStep = document.querySelector('.tutorial-step--next');
const practiceButton = document.querySelector('[data-go-to-practice]');
const morphPreview = document.querySelector('[data-morph-preview]');

let isAdvancing = false;
let resourcesReady = false;

const preloading = document.documentElement.classList.contains('is-mobile-device')
    ? Promise.resolve()
    : import('./tutorial-preload.js?v=tutorial-preload-20261006')
        .then(({ preloadTutorialResources }) => preloadTutorialResources());
preloading.catch(error => console.warn('Tutorial preload failed:', error)).finally(() => {
    resourcesReady = true;
});

function advanceTutorial() {
    if (isAdvancing) return;

    isAdvancing = true;
    progressFill.style.transform = 'scaleX(1)';
    progressBar.setAttribute('aria-valuenow', '100');
    introStep.classList.add('is-transitioning');
}

function runIntroLoadingBar(startTime) {
    const elapsed = performance.now() - startTime;
    const canAdvance = elapsed >= INTRO_DURATION_MS
        && (resourcesReady || elapsed >= MAX_INTRO_DURATION_MS);
    const completion = canAdvance ? 1 : Math.min(elapsed / INTRO_DURATION_MS, 0.95);

    progressFill.style.transform = `scaleX(${completion})`;
    progressBar.setAttribute('aria-valuenow', String(Math.round(completion * 100)));

    if (!canAdvance) {
        window.requestAnimationFrame(() => runIntroLoadingBar(startTime));
        return;
    }

    advanceTutorial();
}

introStep.addEventListener('animationend', (event) => {
    if (event.target !== introStep || event.animationName !== 'tutorial-step-out') {
        return;
    }

    introStep.hidden = true;
    nextStep.hidden = false;
    window.FinglyphGlyphMorph?.renderWord(
        morphPreview,
        'finglyph',
    );
    window.dispatchEvent(new Event('tutorial:step-complete'));
});

window.addEventListener('resize', () => {
    window.FinglyphGlyphMorph?.sizeWordCard(
        morphPreview.querySelector('.word-container'),
        morphPreview.clientWidth,
    );
});

practiceButton.addEventListener('click', () => {
    window.location.assign('tutorial_page.html');
});

// The timer starts as soon as this script is parsed on page entry.
runIntroLoadingBar(performance.now());

// Call this from the final tutorial step when the user has completed it.
window.completeTutorial = function completeTutorial() {
    window.location.assign('main_page.html');
};
