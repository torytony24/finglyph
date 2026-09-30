import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm';
import { classifyLandmarks, loadClassifier } from './landmark-classifier.js';
import { resolveInferenceConfig } from './asl-inference-config.js';
import { LandmarkTemporalFilter, ProbabilityTemporalStabilizer } from './temporal-stabilization.js';
import { applyTemperature, applyURAmbiguityRule, energyScore, evaluateConfidencePolicy, loadConfidenceArtifacts } from './confidence-postprocessing.js';
import { createRawPredictionDebugOverlay } from './debug-prediction-overlay.js';

const config = resolveInferenceConfig(window.FinglyphAslConfig);
const MODEL_URL = config.model.classifierPath;
const LANDMARKER_URL = config.model.handLandmarkerPath;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${config.model.mediaPipeVersion}/wasm`;
// Change this list to change both the recognition order and the final arrangement.
const TARGETS = ['A', 'B', 'C', 'D', 'F'];
const HOLD_MS = config.temporal.debounceMs;
const CARD_ENTRANCE_MS = 420;
const FINAL_CARD_FLOAT_MS = 1000;
const FINAL_CARD_SETTLE_DELAY_MS = CARD_ENTRANCE_MS + FINAL_CARD_FLOAT_MS;
const FINAL_LAYOUT_MS = 1300;
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];

const el = {
    page: document.querySelector('.practice-page'),
    camera: document.querySelector('.camera-module'),
    video: document.getElementById('webcam'), canvas: document.getElementById('hand-overlay'),
    status: document.getElementById('camera-status'), retry: document.getElementById('camera-retry'),
    image: document.getElementById('guide-image'), letter: document.getElementById('guide-letter'),
    progress: document.getElementById('hold-progress'),
    found: document.getElementById('found-gestures'),
    guide: document.querySelector('.gesture-guide'), skip: document.querySelector('.skip-link'),
    debugNext: document.getElementById('debug-recognize-next'),
};
let landmarker, classifier, stream, animationId, targetIndex = 0, candidate, candidateAt = 0, lastHandAt = 0, running = false, completed = false, completionPending = false;
let layoutAnimations = [];
const landmarkFilter = new LandmarkTemporalFilter(config.temporal);
const probabilityStabilizer = new ProbabilityTemporalStabilizer(config.temporal);
let confidencePolicy = config.confidence;
let temperature = 1;
const rawDebug = createRawPredictionDebugOverlay(el.camera);

const target = () => TARGETS[targetIndex];
const status = text => { el.status.textContent = text; };
const progress = value => { el.progress.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`; };
function reset(message) { candidate = null; candidateAt = 0; progress(0); if (message) status(message); }
function resetTemporalState() { landmarkFilter.reset(); probabilityStabilizer.reset(); }

function predict(landmarks) {
    return classifyLandmarks(landmarks, classifier);
}

function draw(landmarks) {
    const ctx = el.canvas.getContext('2d'); ctx.clearRect(0, 0, el.canvas.width, el.canvas.height); if (!landmarks) return;
    ctx.strokeStyle = '#2fbf70'; ctx.fillStyle = '#fff'; ctx.lineWidth = Math.max(2, el.canvas.width / 260);
    CONNECTIONS.forEach(([from, to]) => { ctx.beginPath(); ctx.moveTo(landmarks[from].x * el.canvas.width, landmarks[from].y * el.canvas.height); ctx.lineTo(landmarks[to].x * el.canvas.width, landmarks[to].y * el.canvas.height); ctx.stroke(); });
    landmarks.forEach(point => { ctx.beginPath(); ctx.arc(point.x * el.canvas.width, point.y * el.canvas.height, ctx.lineWidth, 0, Math.PI * 2); ctx.fill(); });
}

function updateGuide() {
    if (!target()) { el.guide.hidden = true; return; }
    el.letter.textContent = target(); el.image.src = `assets/signs/${target()}.svg`;
}

function floatingPosition(index, count) {
    const preset = [
        { x: 0.13, y: 0.14 }, { x: 0.72, y: 0.13 }, { x: 0.12, y: 0.62 },
        { x: 0.72, y: 0.62 }, { x: 0.76, y: 0.36 },
    ];
    if (index < preset.length) return preset[index];

    const angle = (-Math.PI / 2) + ((index - preset.length) / Math.max(1, count - preset.length)) * Math.PI * 2;
    return { x: 0.5 + Math.cos(angle) * 0.34, y: 0.5 + Math.sin(angle) * 0.31 };
}

function positionCard(card, position) {
    card.style.left = `${position.x * 100}%`;
    card.style.top = `${position.y * 100}%`;
}

function addGesture(letter) {
    const card = document.createElement('div'); card.className = 'gesture-card';
    const content = document.createElement('div'); content.className = 'gesture-card__content';
    const image = document.createElement('img'); image.src = `assets/signs/${letter}.svg`; image.alt = `${letter} hand sign`;
    const label = document.createElement('span'); label.textContent = letter; content.append(image, label); card.append(content); el.found.append(card);
    positionCard(card, floatingPosition(targetIndex, TARGETS.length));

    // Start floating only after the card's entrance animation has completed.
    window.setTimeout(() => card.classList.add('is-floating'), CARD_ENTRANCE_MS);
}

function finalLayout() {
    const cards = [...el.found.querySelectorAll('.gesture-card')];
    if (!cards.length) return;

    layoutAnimations.forEach(animation => animation.cancel());
    layoutAnimations = [];
    const padding = Math.max(24, window.innerWidth * 0.07);
    const cardSize = Math.round(Math.min(130, Math.max(48, window.innerWidth * 0.11)));
    const gap = Math.round(Math.min(26, Math.max(12, window.innerWidth * 0.025)));
    const columns = Math.min(cards.length, Math.max(1, Math.floor((window.innerWidth - padding * 2 + gap) / (cardSize + gap))));
    const startX = padding;
    const startY = padding;
    const duration = FINAL_LAYOUT_MS;

    cards.forEach((card, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        const from = { left: card.offsetLeft, top: card.offsetTop };
        const to = { left: startX + column * (cardSize + gap), top: startY + row * (cardSize + gap) };
        card.style.setProperty('--settled-size', `${cardSize}px`);
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
    el.debugNext.disabled = true;
    el.debugNext.textContent = 'Debug: complete';
    el.camera.setAttribute('aria-hidden', 'true');
    el.guide.setAttribute('aria-hidden', 'true');
    el.page.classList.add('is-complete');
    stopCamera();
}

function completePractice() {
    if (completed) return;
    completed = true;
    beginCompletion();
    [...el.found.querySelectorAll('.gesture-card')].forEach(stopFloating);
    requestAnimationFrame(finalLayout);
}

function accept() {
    if (!target() || completed || completionPending) return;
    const completedLetter = target(); addGesture(completedLetter); targetIndex += 1; reset();
    if (target()) { updateGuide(); status(`Great. Now make the ${target()} hand sign.`); }
    else {
        status('Nice work.');
        beginCompletion();
        // The final card completes its entrance, then floats for one full
        // second before joining the final arrangement in either input mode.
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
    const now = performance.now();
    if (el.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const rawLandmarks = landmarker.detectForVideo(el.video, now).landmarks?.[0];
        if (rawLandmarks) {
            lastHandAt = now;
            const filteredLandmarks = landmarkFilter.update(rawLandmarks, now);
            draw(filteredLandmarks);
            const rawPrediction = predict(filteredLandmarks);
            rawDebug.update(rawPrediction);
            const calibratedPrediction = applyURAmbiguityRule(
                applyTemperature(rawPrediction, temperature),
                confidencePolicy.uFromRAmbiguityMargin,
            );
            if (calibratedPrediction) calibratedPrediction.energy = energyScore(calibratedPrediction.logits, temperature);
            const stabilizedPrediction = probabilityStabilizer.update(calibratedPrediction);
            if (stabilizedPrediction && calibratedPrediction) stabilizedPrediction.energy = calibratedPrediction.energy;
            const decision = evaluateConfidencePolicy(stabilizedPrediction, confidencePolicy);
            handlePrediction(decision.accepted ? stabilizedPrediction : null, now);
        } else if (now - lastHandAt > config.temporal.releaseDelayMs) {
            draw(null);
            rawDebug.clear();
            reset('Show your hand in the frame.');
            resetTemporalState();
        }
    }
    animationId = requestAnimationFrame(frame);
}

async function startCamera() {
    if (running || completed || completionPending) return; el.retry.hidden = true; status('Preparing the camera...');
    try {
        if (!landmarker) { const vision = await FilesetResolver.forVisionTasks(WASM_URL); landmarker = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: LANDMARKER_URL, delegate: config.model.delegate }, runningMode: 'VIDEO', numHands: config.model.numHands, minHandDetectionConfidence: config.model.minHandDetectionConfidence, minHandPresenceConfidence: config.model.minHandPresenceConfidence, minTrackingConfidence: config.model.minTrackingConfidence }); }
        if (!classifier) {
            const [model, artifacts] = await Promise.all([loadClassifier(MODEL_URL), loadConfidenceArtifacts(config.confidence, config.confidence)]);
            classifier = model; temperature = artifacts.temperature; confidencePolicy = artifacts.policy;
            if (confidencePolicy.defaultThreshold >= config.temporal.exitThreshold) config.temporal.entryThreshold = confidencePolicy.defaultThreshold;
        }
        if (completed || completionPending) return;
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: config.camera.facingMode, width: { ideal: config.camera.width }, height: { ideal: config.camera.height }, frameRate: { ideal: 30 } } });
        if (completed || completionPending) { stream.getTracks().forEach(track => track.stop()); return; }
        el.video.srcObject = stream; await el.video.play(); el.canvas.width = el.video.videoWidth; el.canvas.height = el.video.videoHeight; running = true; status(`Make the ${target()} hand sign.`); frame();
    } catch (error) {
        console.error('Tutorial camera failed:', error); status(error.name === 'NotAllowedError' ? 'Camera permission is needed for this practice.' : 'The camera could not start.'); el.retry.hidden = false;
    }
}

el.retry.addEventListener('click', startCamera);
el.debugNext.addEventListener('click', accept);
window.addEventListener('resize', () => { if (completed) finalLayout(); });
window.addEventListener('beforeunload', () => { running = false; cancelAnimationFrame(animationId); stream?.getTracks().forEach(track => track.stop()); });
updateGuide();
if (TARGETS.length) startCamera(); else completePractice();
