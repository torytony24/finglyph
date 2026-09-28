const HOLD_DURATION_MS = 900;
const RELEASE_DELAY_MS = 250;
const MIN_CONFIDENCE = 0.84;
const CLASSIFIER_PATH = 'assets/models/asl-landmark-model.json';
const HAND_LANDMARKER_PATH =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MEDIAPIPE_MODULE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm';
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
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_LANDMARKER_PATH, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.6,
        });
    }

    if (!classifierModel) {
        const response = await fetch(CLASSIFIER_PATH);
        if (!response.ok) throw new Error('Could not load the alphabet classifier.');
        classifierModel = hydrateClassifier(await response.json());
    }
}

function decodeFloat32(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Float32Array(bytes.buffer);
}

function hydrateClassifier(payload) {
    if (payload.format !== 'f32-base64-v1' || payload.labels?.length !== 26) {
        throw new Error('The alphabet classifier has an invalid format.');
    }

    return {
        labels: payload.labels,
        batchNorm: Object.fromEntries(
            Object.entries(payload.batchNorm)
                .map(([key, value]) => [key, typeof value === 'string' ? decodeFloat32(value) : value]),
        ),
        layers: payload.layers.map(layer => ({
            ...layer,
            kernel: decodeFloat32(layer.kernel),
            bias: decodeFloat32(layer.bias),
        })),
    };
}

function preprocessLandmarks(landmarks) {
    const wrist = landmarks[0];
    const values = landmarks.flatMap(point => [point.x - wrist.x, point.y - wrist.y]);
    const scale = Math.max(...values.map(Math.abs));
    return scale ? Float32Array.from(values, value => value / scale) : null;
}

function mish(value) {
    const softplus = value > 20 ? value : Math.log1p(Math.exp(value));
    return value * Math.tanh(softplus);
}

function applyDense(values, layer, activation) {
    const output = new Float32Array(layer.outputSize);
    output.set(layer.bias);

    for (let inputIndex = 0; inputIndex < layer.inputSize; inputIndex += 1) {
        const value = values[inputIndex];
        const offset = inputIndex * layer.outputSize;
        for (let outputIndex = 0; outputIndex < layer.outputSize; outputIndex += 1) {
            output[outputIndex] += value * layer.kernel[offset + outputIndex];
        }
    }

    if (activation) {
        for (let index = 0; index < output.length; index += 1) output[index] = mish(output[index]);
    }
    return output;
}

function classify(landmarks) {
    const input = preprocessLandmarks(landmarks);
    if (!input || !classifierModel) return null;

    const { gamma, beta, mean, variance, epsilon } = classifierModel.batchNorm;
    for (let index = 0; index < input.length; index += 1) {
        input[index] = gamma[index] * (input[index] - mean[index]) / Math.sqrt(variance[index] + epsilon) + beta[index];
    }

    let values = input;
    classifierModel.layers.forEach((layer, index) => {
        values = applyDense(values, layer, index < classifierModel.layers.length - 1);
    });

    const maximum = Math.max(...values);
    const exponentials = Float32Array.from(values, value => Math.exp(value - maximum));
    const total = exponentials.reduce((sum, value) => sum + value, 0);
    const bestIndex = exponentials.reduce((best, value, index) => value > exponentials[best] ? index : best, 0);
    return {
        letter: classifierModel.labels[bestIndex],
        confidence: exponentials[bestIndex] / total,
    };
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

function updateCandidate(prediction, now) {
    if (!prediction || prediction.confidence < MIN_CONFIDENCE) {
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
        const landmarks = result.landmarks?.[0];
        drawLandmarks(landmarks);

        if (landmarks) {
            updateCandidate(classify(landmarks), now);
        } else if (now - lastHandSeenAt >= RELEASE_DELAY_MS) {
            resetCandidate('Looking for a hand.');
            lockedLetter = null;
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
    progress(0);
    showLetter(null);
}

window.addEventListener('finglyph:camera-started', event => startRecognition(event.detail.video));
window.addEventListener('finglyph:camera-stopped', stopRecognition);
