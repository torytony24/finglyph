import { classifyLandmarks, loadClassifier } from './landmark-classifier.js';
import { resolveInferenceConfig } from './asl-inference-config.js';
import { LandmarkTemporalFilter, ProbabilityTemporalStabilizer } from './temporal-stabilization.js';
import { applyTemperature, energyScore, loadConfidenceArtifacts } from './confidence-postprocessing.js';
import { measureSThumbDepth } from './s-depth-disambiguation.js';
import { measureURFingerCrossing } from './ur-crossing-disambiguation.js';
import { chooseRecognitionCandidate } from './recognition-decision.js';
import { loadHandLandmarkerModel } from './tutorial-model-cache.js';

const config = resolveInferenceConfig(window.FinglyphAslConfig);
const MODEL_URL = config.model.classifierPath;
const LANDMARKER_URL = config.model.handLandmarkerPath;
const MEDIAPIPE_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${config.model.mediaPipeVersion}/+esm`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${config.model.mediaPipeVersion}/wasm`;
// Change this list to change both the recognition order and the final arrangement.
const TARGETS = ['H','E','L','L','O'];
const FINAL_WORD = 'FINGLYPH';
const HOLD_MS = config.temporal.debounceMs;
const RELEASE_DELAY_MS = config.temporal.releaseDelayMs;
const CARD_ENTRANCE_MS = 420;
const FINAL_CARD_FLOAT_MS = 1000;
const FINAL_CARD_SETTLE_DELAY_MS = CARD_ENTRANCE_MS + FINAL_CARD_FLOAT_MS;
const FINAL_LAYOUT_MS = 1300;
const FINAL_WORD_START_DELAY_MS = FINAL_LAYOUT_MS + 100;
const FINAL_WORD_LETTER_INTERVAL_MS = 700;
const WORD_CARD_START_DELAY_MS = 900;
const WORD_CARD_MORPH_MS = 1100;
const GREETING_REVEAL_MS = 600;
const GREETING_HOLD_MS = 1100;
const BRAND_COLLAPSE_MS = 900;
const BRAND_HOLD_MS = 900;
const MAIN_PREVIEW_TRANSITION_MS = 1150;
const MAIN_PREVIEW_HOLD_MS = 1000;
const FINAL_BLUR_MS = 900;
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];
const HAND_BONE_COLOR = getComputedStyle(document.documentElement)
    .getPropertyValue('--fill-color')
    .trim() || '#f4f4f4';

const el = {
    page: document.querySelector('.practice-page'),
    camera: document.querySelector('.camera-module'),
    video: document.getElementById('webcam'), canvas: document.getElementById('hand-overlay'),
    status: document.getElementById('camera-status'), retry: document.getElementById('camera-retry'),
    image: document.getElementById('guide-image'), letter: document.getElementById('guide-letter'),
    progress: document.getElementById('hold-progress'),
    found: document.getElementById('found-gestures'),
    greeting: document.querySelector('.tutorial-greeting'),
    tagline: document.querySelector('.tutorial-tagline'),
    start: document.querySelector('.tutorial-finale-start'),
    footerPreview: document.querySelector('.tutorial-footer-preview'),
    inputPreview: document.querySelector('.tutorial-input-preview'),
    guide: document.querySelector('.gesture-guide'), skip: document.querySelector('.skip-link'),
};
document.fonts?.ready.then(() => window.FinglyphResizeInputToContent?.(el.inputPreview));
let landmarker, classifier, stream, animationId, targetIndex = 0, candidate, candidateAt = 0, lastHandAt = 0, running = false, starting = false, completed = false, completionPending = false;
let useCpuLandmarker = false;
let layoutAnimations = [];
let previousGestureLetter = 'A';
const landmarkFilter = new LandmarkTemporalFilter(config.temporal);
const probabilityStabilizer = new ProbabilityTemporalStabilizer(config.temporal);
let confidencePolicy = config.confidence;
let temperature = 1;

const target = () => TARGETS[targetIndex];
const status = text => { el.status.textContent = text; };
const progress = value => { el.progress.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`; };
function reset(message) { candidate = null; candidateAt = 0; progress(0); if (message) status(message); }
function resetTemporalState() { landmarkFilter.reset(); probabilityStabilizer.reset(); }

function draw(landmarks) {
    const canvas = el.canvas;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks?.length) return;

    context.strokeStyle = HAND_BONE_COLOR;
    context.fillStyle = HAND_BONE_COLOR;
    context.lineWidth = Math.max(2, canvas.width / 250);
    CONNECTIONS.forEach(([from, to]) => {
        context.beginPath();
        context.moveTo(landmarks[from].x * canvas.width, landmarks[from].y * canvas.height);
        context.lineTo(landmarks[to].x * canvas.width, landmarks[to].y * canvas.height);
        context.stroke();
    });
    landmarks.forEach(point => {
        context.beginPath();
        context.arc(point.x * canvas.width, point.y * canvas.height, context.lineWidth, 0, Math.PI * 2);
        context.fill();
    });
}

function updateGuide() {
    if (!target()) { el.guide.hidden = true; return; }
    el.letter.textContent = target(); el.image.src = `assets/signs/${target()}.svg`;
}

function floatingPosition(index, count, card) {
    const page = el.page.getBoundingClientRect();
    const camera = el.camera.getBoundingClientRect();
    const guide = el.guide.getBoundingClientRect();
    const width = el.page.clientWidth;
    const height = el.page.clientHeight;
    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    const cameraLeft = camera.left - page.left;
    const cameraRight = camera.right - page.left;
    const sideOffset = Math.min(28, Math.max(0, (cameraLeft - cardWidth) / 4));
    const leftSide = (cameraLeft - cardWidth) / 2;
    const rightSide = cameraRight + (width - cameraRight - cardWidth) / 2;
    const lowerTop = Math.min(height * 0.59, guide.top - page.top - cardHeight - 30);
    const upperCenterTop = Math.max(24, camera.top - page.top - cardHeight - 24);
    const stagger = Math.min(1, width / 1400);
    // Keep each sign in its own clear area, but vary both axes to avoid a grid.
    const preset = [
        { left: leftSide - sideOffset - 8 * stagger, top: height * 0.17 },
        { left: rightSide + sideOffset - 37 * stagger, top: height * 0.095 },
        { left: leftSide + sideOffset + 45 * stagger, top: lowerTop - 36 * stagger },
        { left: rightSide - sideOffset - 42 * stagger, top: lowerTop },
        { left: (width - cardWidth) / 2 + 54 * stagger, top: upperCenterTop - 6 * stagger },
    ];
    if (index < preset.length) {
        const position = preset[index];
        return {
            x: Math.min(Math.max(position.left, 24), Math.max(24, width - cardWidth - 24)) / width,
            y: Math.min(Math.max(position.top, 24), Math.max(24, height - cardHeight - 24)) / height,
        };
    }

    const angle = (-Math.PI / 2) + ((index - preset.length) / Math.max(1, count - preset.length)) * Math.PI * 2;
    return { x: 0.5 + Math.cos(angle) * 0.34, y: 0.5 + Math.sin(angle) * 0.31 };
}

function positionCard(card, position) {
    card.style.left = `${position.x * 100}%`;
    card.style.top = `${position.y * 100}%`;
}

function finalCardPosition(row, column) {
    const availableWidth = Math.max(0, el.page.clientWidth - 72);
    const gap = 12;
    // Fit the eight-sign row once so every individual glyph stays the same size
    // through floating, alignment, and reveal; word-card morphing handles the shrink.
    const cardSize = Math.max(
        48,
        Math.floor(Math.min(
            205,
            (availableWidth - gap * (FINAL_WORD.length - 1)) / FINAL_WORD.length,
        )),
    );
    const rowGap = Math.min(24, Math.max(12, window.innerHeight * 0.022));

    return {
        left: 36 + column * (cardSize + gap),
        top: 24 + row * (cardSize + rowGap),
        cardSize,
    };
}

function addGesture(letter, { row = 0, column = targetIndex, settle = false } = {}) {
    const card = document.createElement('div'); card.className = 'gesture-card';
    card.setAttribute('role', 'img'); card.setAttribute('aria-label', `${letter} hand sign`);
    card.dataset.layoutRow = String(row);
    card.dataset.layoutColumn = String(column);
    const content = document.createElement('div'); content.className = 'gesture-card__content';
    const glyph = document.createElement('span'); glyph.className = 'gesture-card__glyph'; glyph.setAttribute('aria-hidden', 'true');
    content.append(glyph); card.append(content); el.found.append(card);
    const position = finalCardPosition(row, column);
    card.style.setProperty('--gesture-size', `${position.cardSize}px`);
    window.FinglyphGlyphMorph?.renderTransition(glyph, previousGestureLetter, letter);
    previousGestureLetter = letter;
    if (settle) {
        card.style.setProperty('--settled-size', `${position.cardSize}px`);
        card.classList.add('is-settling');
        card.style.left = `${position.left}px`;
        card.style.top = `${position.top}px`;
    } else {
        positionCard(card, floatingPosition(targetIndex, TARGETS.length, card));
        window.setTimeout(() => card.classList.add('is-floating'), CARD_ENTRANCE_MS);
    }

    return card;
}

function revealFinalWord(index = 0) {
    if (!completed || el.found.classList.contains('is-word-output') || index >= FINAL_WORD.length) return;
    if (!el.found.querySelector(`.gesture-card[data-layout-row="1"][data-layout-column="${index}"]`)) {
        addGesture(FINAL_WORD[index], { row: 1, column: index, settle: true });
    }
    if (index + 1 < FINAL_WORD.length) {
        window.setTimeout(() => revealFinalWord(index + 1), FINAL_WORD_LETTER_INTERVAL_MS);
    } else {
        waitForSignMorphs();
    }
}

function waitForSignMorphs() {
    if (el.found.classList.contains('is-word-output')) return;
    if (el.found.querySelector('.gesture-card .glyph-slot.is-morphing')) {
        window.setTimeout(waitForSignMorphs, 100);
        return;
    }
    window.setTimeout(morphRowsIntoWordCards, WORD_CARD_START_DELAY_MS);
}

function setWordCardLayout(card) {
    window.FinglyphGlyphMorph?.sizeWordCard(card, el.page.clientWidth - 72);
}

function collectWordRow(word, row) {
    const cards = [...el.found.querySelectorAll(`.gesture-card[data-layout-row="${row}"]`)]
        .sort((first, second) => Number(first.dataset.layoutColumn) - Number(second.dataset.layoutColumn));
    if (cards.length !== [...word].length) return null;

    const glyphs = cards.map(card => card.querySelector('.gesture-card__glyph > .glyph-slot'));
    if (glyphs.some(glyph => !glyph)) return null;

    return { word, row, cards, glyphs, sourcePositions: glyphs.map(glyph => glyph.getBoundingClientRect()) };
}

function updateHeaderShift() {
    const brand = el.greeting.querySelector('.tutorial-greeting__brand');
    brand.style.setProperty('--header-shift-x', `${36 - brand.offsetLeft}px`);
    brand.style.setProperty('--header-shift-y', `${24 - brand.offsetTop}px`);
}

function revealFinaleCopy() {
    if (!el.page.classList.contains('is-finale') || el.page.classList.contains('is-finale-copy-visible')) return;
    el.page.classList.add('is-finale-copy-visible');
    el.start.removeAttribute('aria-hidden');
    el.start.removeAttribute('tabindex');
}

function showFinale() {
    if (!el.page.classList.contains('is-main-preview') || el.page.classList.contains('is-finale')) return;
    el.page.classList.add('is-finale');
    window.setTimeout(revealFinaleCopy, FINAL_BLUR_MS);
}

function startMainPreview() {
    if (el.page.classList.contains('is-main-preview')) return;
    updateHeaderShift();
    window.FinglyphResizeInputToContent?.(el.inputPreview);
    el.page.classList.add('is-main-preview');
    el.footerPreview.removeAttribute('aria-hidden');
    window.setTimeout(showFinale, MAIN_PREVIEW_TRANSITION_MS + MAIN_PREVIEW_HOLD_MS);
}

function transitionToBrand() {
    if (el.greeting.classList.contains('is-brand-only')) return;
    const hello = el.greeting.querySelector('.tutorial-greeting__hello');
    const mark = el.greeting.querySelector('.tutorial-greeting__mark');
    // Freeze each disappearing span at its rendered width so collapsing it
    // moves the remaining word smoothly into the exact center.
    hello.style.width = `${hello.getBoundingClientRect().width}px`;
    mark.style.width = `${mark.getBoundingClientRect().width}px`;
    void el.greeting.offsetWidth;
    hello.setAttribute('aria-hidden', 'true');
    mark.setAttribute('aria-hidden', 'true');
    el.greeting.setAttribute('aria-label', 'Finglyph');
    el.greeting.classList.add('is-brand-only');
    el.tagline.removeAttribute('aria-hidden');
    el.tagline.classList.add('is-visible');
    window.setTimeout(startMainPreview, BRAND_COLLAPSE_MS + BRAND_HOLD_MS);
}

function showGreeting() {
    if (el.greeting.classList.contains('is-visible')) return;
    el.greeting.removeAttribute('aria-hidden');
    el.greeting.classList.add('is-visible');
    window.setTimeout(transitionToBrand, GREETING_REVEAL_MS + GREETING_HOLD_MS);
}

function morphRowsIntoWordCards() {
    if (el.found.classList.contains('is-word-output')) return;
    // Measure both rows before changing the layout, then move every glyph in
    // one frame so neither row jumps ahead of the other.
    const rows = [collectWordRow(TARGETS.join(''), 0), collectWordRow(FINAL_WORD, 1)];
    if (rows.some(row => !row)) return;

    el.found.classList.add('is-word-output');
    let completedCards = 0;

    rows.forEach(row => {
        const wordCard = document.createElement('div');
        wordCard.className = 'word-container tutorial-word-card is-morphing';
        wordCard.dataset.layoutRow = String(row.row);
        wordCard.dataset.word = row.word;
        wordCard.setAttribute('role', 'img');
        wordCard.setAttribute('aria-label', `${row.word.toLowerCase()} hand-sign card`);
        setWordCardLayout(wordCard);

        const background = document.createElement('div');
        background.className = 'tutorial-word-card__background';
        background.setAttribute('aria-hidden', 'true');
        wordCard.append(background, ...row.glyphs);
        el.found.append(wordCard);
        row.cards.forEach(card => card.remove());

        row.glyphs.forEach((glyph, index) => {
            const from = row.sourcePositions[index];
            const to = glyph.getBoundingClientRect();
            const animation = glyph.animate([
                {
                    transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
                    transformOrigin: 'top left',
                },
                { transform: 'none', transformOrigin: 'top left' },
            ], { duration: WORD_CARD_MORPH_MS, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'both' });
            animation.onfinish = () => animation.cancel();
        });

        const backgroundAnimation = background.animate([
            { transform: 'scaleX(0)', opacity: 0, offset: 0 },
            { transform: 'scaleX(0)', opacity: 0, offset: 0.42 },
            { transform: 'scaleX(1)', opacity: 1, offset: 1 },
        ], { duration: WORD_CARD_MORPH_MS, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'both' });
        backgroundAnimation.onfinish = () => {
            background.style.transform = 'scaleX(1)';
            background.style.opacity = '1';
            wordCard.classList.remove('is-morphing');
            backgroundAnimation.cancel();
            completedCards += 1;
            if (completedCards === rows.length) showGreeting();
        };
    });
}

function finalLayout() {
    const cards = [...el.found.querySelectorAll('.gesture-card')];
    const wordCards = [...el.found.querySelectorAll('.tutorial-word-card')];
    if (!cards.length && !wordCards.length) return;

    layoutAnimations.forEach(animation => animation.cancel());
    layoutAnimations = [];
    wordCards.forEach(setWordCardLayout);
    if (!cards.length) return;

    const duration = FINAL_LAYOUT_MS;

    cards.forEach(card => {
        const row = Number(card.dataset.layoutRow) || 0;
        const column = Number(card.dataset.layoutColumn) || 0;
        const position = finalCardPosition(row, column);
        const from = { left: card.offsetLeft, top: card.offsetTop };
        const to = { left: position.left, top: position.top };
        card.style.setProperty('--gesture-size', `${position.cardSize}px`);
        card.style.setProperty('--settled-size', `${position.cardSize}px`);
        card.classList.add('is-settling');
        card.style.left = `${to.left}px`;
        card.style.top = `${to.top}px`;

        // Explicit pixel keyframes preserve the observed floating position as
        // the start of the motion, including the final card created this turn.
        const animation = card.animate([
            { left: `${from.left}px`, top: `${from.top}px` },
            { left: `${to.left}px`, top: `${to.top}px` },
        ], { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
        layoutAnimations.push(animation);
        animation.onfinish = () => {
            animation.cancel();
            layoutAnimations = layoutAnimations.filter(active => active !== animation);
        };
    });
}

function repositionFloatingCards() {
    const size = finalCardPosition(0, 0).cardSize;
    el.found.querySelectorAll('.gesture-card[data-layout-row="0"]').forEach(card => {
        card.style.setProperty('--gesture-size', `${size}px`);
        positionCard(card, floatingPosition(Number(card.dataset.layoutColumn), TARGETS.length, card));
    });
}

function stopFloating(card) {
    const content = card.querySelector('.gesture-card__content');
    content.style.transform = getComputedStyle(content).transform;
    card.classList.remove('is-floating');
    card.classList.add('is-settling');
    requestAnimationFrame(() => { content.style.transform = ''; });
}

function stopCamera() {
    running = false;
    cancelAnimationFrame(animationId);
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    el.video.srcObject = null;
}

function beginCompletion() {
    if (completionPending) return;
    completionPending = true;
    el.skip.hidden = true;
}

function hideCameraForCompletion() {
    el.camera.setAttribute('aria-hidden', 'true');
    el.guide.setAttribute('aria-hidden', 'true');
    el.page.classList.add('is-complete');
    stopCamera();
}

function completePractice() {
    if (completed) return;
    completed = true;
    beginCompletion();
    hideCameraForCompletion();
    [...el.found.querySelectorAll('.gesture-card')].forEach(stopFloating);
    requestAnimationFrame(finalLayout);
    window.setTimeout(revealFinalWord, FINAL_WORD_START_DELAY_MS);
}

function skipRecognition() {
    if (completed || completionPending) return;
    beginCompletion();
    el.guide.setAttribute('aria-hidden', 'true');
    el.guide.style.visibility = 'hidden';
    el.retry.hidden = true;
    for (; targetIndex < TARGETS.length; targetIndex += 1) {
        addGesture(target());
    }
    reset('Continuing tutorial...');
    window.setTimeout(completePractice, FINAL_CARD_SETTLE_DELAY_MS);
}

function accept() {
    if (!target() || completed || completionPending) return;
    const completedLetter = target(); addGesture(completedLetter); targetIndex += 1; reset();
    if (target()) { updateGuide(); status(`Great. Now make the ${target()} hand sign.`); }
    else {
        status('Nice work.');
        beginCompletion();
        // Keep the camera visible while the final card enters and floats for
        // one full second, then hide it as the cards move into their final layout.
        window.setTimeout(completePractice, FINAL_CARD_SETTLE_DELAY_MS);
    }
}

function handlePrediction(result, now) {
    if (!target() || completed || completionPending) return;
    if (!result?.letter) { if (candidate) reset('Show your hand clearly.'); return; }
    lastHandAt = now;
    if (result.letter !== target()) { if (candidate || Math.floor(now / 800) !== Math.floor((now - 16) / 800)) status(`Try the ${target()} hand sign.`); reset(); return; }
    if (candidate !== result.letter) { candidate = result.letter; candidateAt = now; progress(0); status(`That looks like ${result.letter}. Hold it there.`); return; }
    const held = now - candidateAt; progress(held / HOLD_MS); if (held >= HOLD_MS) accept();
}

function frame() {
    if (!running) return;
    if (completionPending) { animationId = requestAnimationFrame(frame); return; }
    const now = performance.now();
    if (el.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && el.video.videoWidth > 0) {
        if (el.canvas.width !== el.video.videoWidth || el.canvas.height !== el.video.videoHeight) {
            el.canvas.width = el.video.videoWidth;
            el.canvas.height = el.video.videoHeight;
        }
        let rawLandmarks;
        try {
            rawLandmarks = landmarker.detectForVideo(el.video, now).landmarks?.[0];
        } catch (error) {
            console.error('Tutorial hand recognition failed:', error);
            running = false;
            useCpuLandmarker = true;
            try { landmarker?.close?.(); } catch (closeError) { console.warn('Could not close hand recognition:', closeError); }
            landmarker = undefined;
            status('Hand recognition stopped. Try camera again.');
            el.retry.hidden = false;
            return;
        }
        if (rawLandmarks) {
            lastHandAt = now;
            const filteredLandmarks = landmarkFilter.update(rawLandmarks, now);
            draw(filteredLandmarks);
            const rawPrediction = classifyLandmarks(filteredLandmarks, classifier);
            const sDepth = measureSThumbDepth(filteredLandmarks, config.sDepth.minThumbDepthRatio);
            const urCrossing = measureURFingerCrossing(filteredLandmarks);
            const calibratedPrediction = applyTemperature(rawPrediction, temperature);
            if (calibratedPrediction) calibratedPrediction.energy = energyScore(calibratedPrediction.logits, temperature);
            const stabilizedPrediction = probabilityStabilizer.update(calibratedPrediction);
            if (stabilizedPrediction && calibratedPrediction) stabilizedPrediction.energy = calibratedPrediction.energy;
            const candidate = chooseRecognitionCandidate(rawPrediction, sDepth, urCrossing, stabilizedPrediction, confidencePolicy);
            handlePrediction(candidate, now);
        } else if (now - lastHandAt >= RELEASE_DELAY_MS) {
            draw(null);
            reset('Show your hand in the frame.');
            resetTemporalState();
        }
    }
    animationId = requestAnimationFrame(frame);
}

async function prepareRecognition() {
    if (!landmarker) {
        const [{ FilesetResolver, HandLandmarker }, modelBuffer] = await Promise.all([
            import(MEDIAPIPE_MODULE),
            loadHandLandmarkerModel(LANDMARKER_URL),
        ]);
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const options = {
            baseOptions: { modelAssetBuffer: modelBuffer.slice(), delegate: useCpuLandmarker ? 'CPU' : config.model.delegate },
            runningMode: 'VIDEO',
            numHands: config.model.numHands,
            minHandDetectionConfidence: config.model.minHandDetectionConfidence,
            minHandPresenceConfidence: config.model.minHandPresenceConfidence,
            minTrackingConfidence: config.model.minTrackingConfidence,
        };
        try {
            landmarker = await HandLandmarker.createFromOptions(vision, options);
        } catch (error) {
            if (options.baseOptions.delegate !== 'GPU') throw error;
            console.warn('Tutorial GPU hand recognition unavailable; trying CPU:', error);
            useCpuLandmarker = true;
            options.baseOptions.delegate = 'CPU';
            options.baseOptions.modelAssetBuffer = modelBuffer.slice();
            landmarker = await HandLandmarker.createFromOptions(vision, options);
        }
    }
    if (!classifier) {
        const [model, artifacts] = await Promise.all([loadClassifier(MODEL_URL), loadConfidenceArtifacts(config.confidence, config.confidence)]);
        classifier = model; temperature = artifacts.temperature; confidencePolicy = artifacts.policy;
        if (confidencePolicy.defaultThreshold >= config.temporal.exitThreshold) config.temporal.entryThreshold = confidencePolicy.defaultThreshold;
    }
}

function cameraErrorMessage(error, phase) {
    if (phase === 'recognition') return 'Camera is on, but hand recognition could not load. Try again.';
    if (phase === 'playback') return 'Camera opened, but video could not play. Try again.';
    if (!navigator.mediaDevices?.getUserMedia && !window.isSecureContext) return 'Use HTTPS or localhost to access the camera.';
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') return 'Allow camera access in your browser and system settings, then try again.';
    if (error.name === 'NotFoundError') return 'No camera found. Connect one and try again.';
    if (error.name === 'NotReadableError') return 'Camera is busy or unavailable. Close other camera apps and try again.';
    return 'The camera could not start. Try again.';
}

async function startCamera() {
    if (starting || running || completed || completionPending) return;
    starting = true;
    el.retry.hidden = true;
    let phase = 'camera';
    try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia is unavailable');
        if (!stream?.active) {
            status('Requesting camera access...');
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: config.camera.facingMode, width: { ideal: config.camera.width }, height: { ideal: config.camera.height }, frameRate: { ideal: 30 } } });
        }
        if (completed || completionPending) { stopCamera(); return; }
        phase = 'playback';
        if (el.video.srcObject !== stream) el.video.srcObject = stream;
        if (el.video.paused) await el.video.play();
        if (completed || completionPending) { stopCamera(); return; }
        el.canvas.width = el.video.videoWidth;
        el.canvas.height = el.video.videoHeight;
        phase = 'recognition';
        status('Camera on. Loading hand recognition...');
        await prepareRecognition();
        if (completed || completionPending) return;
        running = true;
        status(`Make the ${target()} hand sign.`);
        frame();
    } catch (error) {
        if (completed || completionPending) return;
        console.error('Tutorial camera failed:', error);
        status(cameraErrorMessage(error, phase));
        el.retry.hidden = false;
    } finally {
        starting = false;
    }
}

el.retry.addEventListener('click', startCamera);
el.skip.addEventListener('click', skipRecognition);
el.start.addEventListener('click', () => { if (el.page.classList.contains('is-finale-copy-visible')) window.location.assign('main_page.html'); });
window.addEventListener('resize', () => { if (completed) finalLayout(); else repositionFloatingCards(); if (el.page.classList.contains('is-main-preview')) updateHeaderShift(); });
window.addEventListener('beforeunload', () => { running = false; cancelAnimationFrame(animationId); stream?.getTracks().forEach(track => track.stop()); });
updateGuide();
if (TARGETS.length) startCamera(); else completePractice();
