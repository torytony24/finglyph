import { classifyLandmarks, loadClassifier } from './landmark-classifier.js';
import { resolveInferenceConfig } from './asl-inference-config.js';
import { LandmarkTemporalFilter, ProbabilityTemporalStabilizer } from './temporal-stabilization.js';
import { applyTemperature, applyURAmbiguityRule, energyScore, evaluateConfidencePolicy, loadConfidenceArtifacts } from './confidence-postprocessing.js';
import { createRawPredictionDebugOverlay } from './debug-prediction-overlay.js';

const config = resolveInferenceConfig(window.FinglyphAslConfig);
const HOLD_DURATION_MS = config.temporal.debounceMs;
const RELEASE_DELAY_MS = config.temporal.releaseDelayMs;
const MEDIAPIPE_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${config.model.mediaPipeVersion}/+esm`;
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17],
];

let handLandmarker;
let classifierModel;
let isRecognizing = false;
let frameRequestId;
let candidateLetter = null;
let candidateStartedAt = 0;
let lockedLetter = null;
let lastHandSeenAt = 0;
const landmarkFilter = new LandmarkTemporalFilter(config.temporal);
const probabilityStabilizer = new ProbabilityTemporalStabilizer(config.temporal);
let confidencePolicy = config.confidence;
let temperature = 1;
const rawDebug = createRawPredictionDebugOverlay(document.getElementById('camera-panel'));

function status(message) {
    document.getElementById('camera-status').textContent = message;
}

function progress(value) {
    document.getElementById('hold-progress').style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
}

function showLetter(letter, confidence = null) {
    const label = document.getElementById('camera-letter');
    label.textContent = letter || '-';
    label.title = confidence === null ? '' : `${Math.round(confidence * 100)}%`;
}

async function prepareRecognizers() {
    if (!handLandmarker) {
        const { FilesetResolver, HandLandmarker } = await import(MEDIAPIPE_MODULE);
        const vision = await FilesetResolver.forVisionTasks(
            `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${config.model.mediaPipeVersion}/wasm`,
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: config.model.handLandmarkerPath, delegate: config.model.delegate },
            runningMode: 'VIDEO',
            numHands: config.model.numHands,
            minHandDetectionConfidence: config.model.minHandDetectionConfidence,
            minHandPresenceConfidence: config.model.minHandPresenceConfidence,
            minTrackingConfidence: config.model.minTrackingConfidence,
        });
    }

    if (!classifierModel) {
        const [model, artifacts] = await Promise.all([
            loadClassifier(config.model.classifierPath),
            loadConfidenceArtifacts(config.confidence, config.confidence),
        ]);
        classifierModel = model;
        temperature = artifacts.temperature;
        confidencePolicy = artifacts.policy;
        if (confidencePolicy.defaultThreshold >= config.temporal.exitThreshold) {
            config.temporal.entryThreshold = confidencePolicy.defaultThreshold;
        }
    }
}

function drawLandmarks(landmarks) {
    const canvas = document.getElementById('hand-overlay');
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks?.length) return;

    context.strokeStyle = '#00ff19';
    context.fillStyle = '#fff';
    context.lineWidth = Math.max(2, canvas.width / 250);
    HAND_CONNECTIONS.forEach(([from, to]) => {
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

function resetCandidate(message) {
    candidateLetter = null;
    candidateStartedAt = 0;
    progress(0);
    if (message) status(message);
}

function resetTemporalState() {
    landmarkFilter.reset();
    probabilityStabilizer.reset();
}

function updateCandidate(prediction, now) {
    if (!prediction?.letter) {
        if (candidateLetter) resetCandidate('Show your hand more clearly.');
        return;
    }

    const { letter, confidence } = prediction;
    lastHandSeenAt = now;
    showLetter(letter, confidence);

    if (letter !== candidateLetter) {
        candidateLetter = letter;
        candidateStartedAt = now;
        progress(0);
        status(`${letter} candidate: hold to type.`);
        window.FinglyphCameraInput?.showCandidate(letter);
        return;
    }

    if (letter === lockedLetter) {
        progress(1);
        status(`${letter} typed: release or change your hand to type again.`);
        return;
    }

    const heldFor = now - candidateStartedAt;
    progress(heldFor / HOLD_DURATION_MS);
    if (heldFor >= HOLD_DURATION_MS) {
        lockedLetter = letter;
        progress(1);
        status(`${letter} typed.`);
        window.FinglyphCameraInput?.commitLetter(letter);
    }
}

async function recognizeFrame(video) {
    if (!isRecognizing) return;
    const now = performance.now();

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const result = handLandmarker.detectForVideo(video, now);
        const rawLandmarks = result.landmarks?.[0];

        if (rawLandmarks) {
            lastHandSeenAt = now;
            const filteredLandmarks = landmarkFilter.update(rawLandmarks, now);
            drawLandmarks(filteredLandmarks);
            const rawPrediction = classifyLandmarks(filteredLandmarks, classifierModel);
            rawDebug.update(rawPrediction);
            const calibratedPrediction = applyURAmbiguityRule(
                applyTemperature(rawPrediction, temperature),
                confidencePolicy.uFromRAmbiguityMargin,
            );
            if (calibratedPrediction) calibratedPrediction.energy = energyScore(calibratedPrediction.logits, temperature);
            const stabilizedPrediction = probabilityStabilizer.update(calibratedPrediction);
            if (stabilizedPrediction && calibratedPrediction) stabilizedPrediction.energy = calibratedPrediction.energy;
            const decision = evaluateConfidencePolicy(stabilizedPrediction, confidencePolicy);
            updateCandidate(decision.accepted ? stabilizedPrediction : null, now);
        } else if (now - lastHandSeenAt >= RELEASE_DELAY_MS) {
            drawLandmarks(null);
            rawDebug.clear();
            resetCandidate('Looking for a hand.');
            lockedLetter = null;
            resetTemporalState();
        }
    }

    frameRequestId = requestAnimationFrame(() => recognizeFrame(video));
}

async function startRecognition(video) {
    try {
        status('Loading hand recognition.');
        await prepareRecognizers();
        if (!video.srcObject) return;
        const canvas = document.getElementById('hand-overlay');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        isRecognizing = true;
        status('Show an A-Z hand sign and hold it to type.');
        recognizeFrame(video);
    } catch (error) {
        console.error('Hand recognition failed:', error);
        status('Camera is on, but hand recognition could not load.');
    }
}

function stopRecognition() {
    isRecognizing = false;
    cancelAnimationFrame(frameRequestId);
    frameRequestId = undefined;
    candidateLetter = null;
    lockedLetter = null;
    resetTemporalState();
    progress(0);
    showLetter(null);
}

window.addEventListener('finglyph:camera-started', event => startRecognition(event.detail.video));
window.addEventListener('finglyph:camera-stopped', stopRecognition);
