import {
    FilesetResolver,
    HandLandmarker,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm';

const HOLD_DURATION_MS = 900;
const RELEASE_DELAY_MS = 250;
const MIN_CONFIDENCE = 0.72;
const MODEL_PATH = 'assets/models/asl-keypoint-classifier.tflite';
const HAND_LANDMARKER_PATH =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17],
];

let handLandmarker;
let letterModel;
let isRunning = false;
let frameRequestId;
let candidateLetter = null;
let candidateStartedAt = 0;
let lockedLetter = null;
let lastHandSeenAt = 0;

const elements = {};

function setStatus(message) {
    elements.status.textContent = message;
}

function setProgress(value) {
    elements.progress.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
}

function setLetter(letter, confidence = null) {
    elements.letter.textContent = letter || '-';
    elements.letter.title = confidence === null ? '' : `${Math.round(confidence * 100)}%`;
}

function resetCandidate(message) {
    candidateLetter = null;
    candidateStartedAt = 0;
    setProgress(0);
    if (message) setStatus(message);
}

function normalizedLandmarks(landmarks) {
    const wrist = landmarks[0];
    const coordinates = [];

    landmarks.forEach(point => {
        coordinates.push(point.x - wrist.x, point.y - wrist.y);
    });

    const largestMagnitude = Math.max(...coordinates.map(Math.abs));
    if (!largestMagnitude) return null;
    return coordinates.map(value => value / largestMagnitude);
}

async function classify(landmarks) {
    const features = normalizedLandmarks(landmarks);
    if (!features || features.length !== 42) return null;

    const input = window.tf.tensor2d([features], [1, 42], 'float32');
    let prediction;

    try {
        prediction = letterModel.predict(input);
        const scores = await prediction.data();
        let index = 0;

        for (let scoreIndex = 1; scoreIndex < scores.length; scoreIndex += 1) {
            if (scores[scoreIndex] > scores[index]) index = scoreIndex;
        }

        return { letter: LETTERS[index], confidence: scores[index] };
    } finally {
        input.dispose();
        if (prediction) prediction.dispose();
    }
}

function updateCandidate(prediction, now) {
    if (!prediction || prediction.confidence < MIN_CONFIDENCE) {
        if (candidateLetter) resetCandidate('Show your hand more clearly.');
        return;
    }

    const { letter, confidence } = prediction;
    lastHandSeenAt = now;
    setLetter(letter, confidence);

    if (letter !== candidateLetter) {
        candidateLetter = letter;
        candidateStartedAt = now;
        setProgress(0);
        setStatus(`${letter} candidate: hold to type.`);
        window.FinglyphCameraInput.showCandidate(letter);
        return;
    }

    if (letter === lockedLetter) {
        setProgress(1);
        setStatus(`${letter} typed: release or change your hand to type again.`);
        return;
    }

    const heldFor = now - candidateStartedAt;
    setProgress(heldFor / HOLD_DURATION_MS);
    const remaining = Math.max(0, Math.ceil((HOLD_DURATION_MS - heldFor) / 100) / 10);
    setStatus(`${letter} candidate: hold ${remaining}s.`);

    if (heldFor >= HOLD_DURATION_MS) {
        lockedLetter = letter;
        setProgress(1);
        setStatus(`${letter} typed.`);
        window.FinglyphCameraInput.commitLetter(letter);
    }
}

function handleNoHand(now) {
    if (now - lastHandSeenAt < RELEASE_DELAY_MS) return;

    if (candidateLetter || lockedLetter) {
        resetCandidate('Looking for a hand.');
        lockedLetter = null;
    }
}

function resizeCanvas() {
    const { video, canvas } = elements;
    if (!video.videoWidth || !video.videoHeight) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
}

function drawLandmarks(landmarks) {
    const { canvas } = elements;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks?.length) return;

    context.strokeStyle = '#00ff19';
    context.fillStyle = '#ffffff';
    context.lineWidth = Math.max(2, canvas.width / 250);

    HAND_CONNECTIONS.forEach(([from, to]) => {
        const first = landmarks[from];
        const second = landmarks[to];
        context.beginPath();
        context.moveTo(first.x * canvas.width, first.y * canvas.height);
        context.lineTo(second.x * canvas.width, second.y * canvas.height);
        context.stroke();
    });

    landmarks.forEach(point => {
        context.beginPath();
        context.arc(point.x * canvas.width, point.y * canvas.height, context.lineWidth, 0, Math.PI * 2);
        context.fill();
    });
}

async function processFrame() {
    if (!isRunning) return;

    const now = performance.now();
    const { video } = elements;

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const result = handLandmarker.detectForVideo(video, now);
        const landmarks = result.landmarks?.[0];

        drawLandmarks(landmarks);

        if (landmarks) {
            const prediction = await classify(landmarks);
            updateCandidate(prediction, now);
        } else {
            handleNoHand(now);
        }
    }

    frameRequestId = window.requestAnimationFrame(processFrame);
}

async function loadRecognitionTools() {
    if (!window.tf || !window.tflite) {
        throw new Error('Recognition libraries did not load. Check the network connection.');
    }

    if (!handLandmarker) {
        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: HAND_LANDMARKER_PATH,
                delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.6,
        });
    }

    if (!letterModel) {
        await window.tf.setBackend('cpu');
        await window.tf.ready();
        letterModel = await window.tflite.loadTFLiteModel(MODEL_PATH);
    }
}

async function startCamera() {
    if (isRunning) return;

    elements.toggle.disabled = true;
    elements.toggle.textContent = 'Loading...';
    setStatus('Preparing camera and recognition models.');

    try {
        await loadRecognitionTools();
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        });

        elements.video.srcObject = stream;
        await elements.video.play();
        resizeCanvas();
        isRunning = true;
        elements.toggle.textContent = 'Stop camera';
        setStatus('Show a hand sign. The preview changes immediately.');
        processFrame();
    } catch (error) {
        console.error('Webcam recognition setup failed:', error);
        setStatus(error.message || 'Could not start the camera. Check its permission.');
        elements.toggle.textContent = 'Try again';
    } finally {
        elements.toggle.disabled = false;
    }
}

function stopCamera() {
    isRunning = false;
    if (frameRequestId) window.cancelAnimationFrame(frameRequestId);
    frameRequestId = undefined;

    const stream = elements.video.srcObject;
    stream?.getTracks().forEach(track => track.stop());
    elements.video.srcObject = null;
    elements.canvas.getContext('2d').clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    resetCandidate('Camera is off.');
    lockedLetter = null;
    setLetter(null);
    elements.toggle.textContent = 'Start camera';
}

function setup() {
    Object.assign(elements, {
        video: document.getElementById('webcam'),
        canvas: document.getElementById('hand-overlay'),
        toggle: document.getElementById('camera-toggle'),
        letter: document.getElementById('camera-letter'),
        status: document.getElementById('camera-status'),
        progress: document.getElementById('hold-progress'),
    });

    elements.toggle.addEventListener('click', () => {
        if (isRunning) stopCamera();
        else startCamera();
    });
    elements.video.addEventListener('loadedmetadata', resizeCanvas);
}

window.addEventListener('DOMContentLoaded', setup);
