// Render equations across the Behind slides.
renderMathInElement(document.querySelector('.behind-page .info-content'), {
    delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
    ],
    throwOnError: false
});

const equation = document.querySelector('.behind-equation');
const equationFontSize = 14;

function fitEquation() {
    const rendered = equation?.querySelector('.katex-display > .katex');
    if (!rendered || !equation.clientWidth) return;

    let fontSize = equationFontSize;
    equation.style.fontSize = `${fontSize}px`;
    const availableWidth = equation.clientWidth - 2;
    for (let attempt = 0; attempt < 5 && rendered.scrollWidth > availableWidth; attempt += 1) {
        fontSize *= availableWidth / rendered.scrollWidth;
        equation.style.fontSize = `${fontSize}px`;
    }
}

fitEquation();
document.fonts?.ready.then(fitEquation);
window.addEventListener('resize', fitEquation);
