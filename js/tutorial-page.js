import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm';
import { classifyLandmarks, loadClassifier } from './landmark-classifier.js';
import { resolveInferenceConfig } from './asl-inference-config.js';
import { LandmarkTemporalFilter, ProbabilityTemporalStabilizer } from './temporal-stabilization.js';
import { applyTemperature, energyScore, evaluateConfidencePolicy, loadConfidenceArtifacts } from './confidence-postprocessing.js';

const config = resolveInferenceConfig(window.FinglyphAslConfig);
const MODEL_URL = config.model.classifierPath;
const LANDMARKER_URL = config.model.handLandmarkerPath;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${config.model.mediaPipeVersion}/wasm`;
const TARGETS = ['A', 'B', 'C', 'D', 'F'];
const HOLD_MS = config.temporal.debounceMs;
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];

const el = {
    video: document.getElementById('webcam'), canvas: document.getElementById('hand-overlay'),
    status: document.getElementById('camera-status'), retry: document.getElementById('camera-retry'),
    image: document.getElementById('guide-image'), letter: document.getElementById('guide-letter'),
    progress: document.getElementById('hold-progress'),
    found: document.getElementById('found-gestures'),
};
let landmarker, classifier, stream, animationId, targetIndex = 0, candidate, candidateAt = 0, lastHandAt = 0, running = false;
const landmarkFilter = new LandmarkTemporalFilter(config.temporal);
const probabilityStabilizer = new ProbabilityTemporalStabilizer(config.temporal);
let confidencePolicy = config.confidence;
let temperature = 1;

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
    if (!target()) { el.letter.textContent = 'done'; el.image.hidden = true; status('Nice work — the camera is ready.'); return; }
    el.letter.textContent = target(); el.image.src = `assets/signs/${target()}.svg`;
}

function addGesture(letter) {
    const card = document.createElement('div'); card.className = 'gesture-card';
    const content = document.createElement('div'); content.className = 'gesture-card__content';
    const image = document.createElement('img'); image.src = `assets/signs/${letter}.svg`; image.alt = `${letter} hand sign`;
    const label = document.createElement('span'); label.textContent = letter; content.append(image, label); card.append(content); el.found.append(card);

    // Start floating only after the card's entrance animation has completed.
    window.setTimeout(() => card.classList.add('is-floating'), 420);
}

function accept() {
    const completed = target(); addGesture(completed); targetIndex += 1; reset(); updateGuide();
    if (target()) status(`Great. Now make the ${target()} hand sign.`);
}

function handlePrediction(result, now) {
    if (!target()) return;
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
        const rawLandmarks = landmarker.detectForVideo(el.video, now).landmarks?.[0]; draw(rawLandmarks);
        if (rawLandmarks) {
            lastHandAt = now;
            const filteredLandmarks = landmarkFilter.update(rawLandmarks, now);
            const calibratedPrediction = applyTemperature(predict(filteredLandmarks), temperature);
            if (calibratedPrediction) calibratedPrediction.energy = energyScore(calibratedPrediction.logits, temperature);
            const stabilizedPrediction = probabilityStabilizer.update(calibratedPrediction);
            if (stabilizedPrediction && calibratedPrediction) stabilizedPrediction.energy = calibratedPrediction.energy;
            const decision = evaluateConfidencePolicy(stabilizedPrediction, confidencePolicy);
            handlePrediction(decision.accepted ? stabilizedPrediction : null, now);
        } else if (now - lastHandAt > config.temporal.releaseDelayMs) {
            reset('Show your hand in the frame.');
            resetTemporalState();
        }
    }
    animationId = requestAnimationFrame(frame);
}

async function startCamera() {
    if (running) return; el.retry.hidden = true; status('Preparing the camera…');
    try {
        if (!landmarker) { const vision = await FilesetResolver.forVisionTasks(WASM_URL); landmarker = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: LANDMARKER_URL, delegate: config.model.delegate }, runningMode: 'VIDEO', numHands: config.model.numHands, minHandDetectionConfidence: config.model.minHandDetectionConfidence, minHandPresenceConfidence: config.model.minHandPresenceConfidence, minTrackingConfidence: config.model.minTrackingConfidence }); }
        if (!classifier) {
            const [model, artifacts] = await Promise.all([loadClassifier(MODEL_URL), loadConfidenceArtifacts(config.confidence, config.confidence)]);
            classifier = model; temperature = artifacts.temperature; confidencePolicy = artifacts.policy;
            if (confidencePolicy.defaultThreshold >= config.temporal.exitThreshold) config.temporal.entryThreshold = confidencePolicy.defaultThreshold;
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: config.camera.facingMode, width: { ideal: config.camera.width }, height: { ideal: config.camera.height }, frameRate: { ideal: 30 } } });
        el.video.srcObject = stream; await el.video.play(); el.canvas.width = el.video.videoWidth; el.canvas.height = el.video.videoHeight; running = true; status(`Make the ${target()} hand sign.`); frame();
    } catch (error) {
        console.error('Tutorial camera failed:', error); status(error.name === 'NotAllowedError' ? 'Camera permission is needed for this practice.' : 'The camera could not start.'); el.retry.hidden = false;
    }
}

el.retry.addEventListener('click', startCamera);
window.addEventListener('beforeunload', () => { running = false; cancelAnimationFrame(animationId); stream?.getTracks().forEach(track => track.stop()); });
updateGuide(); startCamera();
