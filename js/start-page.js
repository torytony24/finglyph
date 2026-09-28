// Change this value (milliseconds) to change the first-step loading time.
const INTRO_DURATION_MS = 6000;

const progressBar = document.querySelector('.tutorial-progress');
const progressFill = document.querySelector('.tutorial-progress__fill');
const introStep = document.querySelector('.tutorial-step--intro');
const nextStep = document.querySelector('.tutorial-step--next');
const practiceButton = document.querySelector('[data-go-to-practice]');

let isAdvancing = false;

function advanceTutorial() {
    if (isAdvancing) return;

    isAdvancing = true;
    progressFill.style.transform = 'scaleX(1)';
    progressBar.setAttribute('aria-valuenow', '100');
    introStep.classList.add('is-transitioning');
}

function runIntroLoadingBar(startTime) {
    const elapsed = performance.now() - startTime;
    const completion = Math.min(elapsed / INTRO_DURATION_MS, 1);

    progressFill.style.transform = `scaleX(${completion})`;
    progressBar.setAttribute('aria-valuenow', String(Math.round(completion * 100)));

    if (completion < 1) {
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
    window.dispatchEvent(new Event('tutorial:step-complete'));
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
