import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm';

const MODEL_URL = 'assets/models/asl-landmark-model.json';
const LANDMARKER_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const TARGETS = ['F', 'I', 'N', 'G', 'L', 'Y', 'P', 'H'];
const HOLD_MS = 750;
const MIN_CONFIDENCE = .84;
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];

const el = {
    video: document.getElementById('webcam'), canvas: document.getElementById('hand-overlay'),
    status: document.getElementById('camera-status'), retry: document.getElementById('camera-retry'),
    image: document.getElementById('guide-image'), letter: document.getElementById('guide-letter'),
    progress: document.getElementById('hold-progress'),
    found: document.getElementById('found-gestures'),
};
let landmarker, classifier, stream, animationId, targetIndex = 0, candidate, candidateAt = 0, lastHandAt = 0, running = false;

const target = () => TARGETS[targetIndex];
const status = text => { el.status.textContent = text; };
const progress = value => { el.progress.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`; };
function reset(message) { candidate = null; candidateAt = 0; progress(0); if (message) status(message); }

function bytes(encoded) {
    const binary = atob(encoded); const values = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) values[i] = binary.charCodeAt(i);
    return new Float32Array(values.buffer);
}

function loadClassifier(payload) {
    if (payload.format !== 'f32-base64-v1' || payload.labels?.length !== 26) throw new Error('Invalid hand-sign model.');
    return {
        labels: payload.labels,
        batchNorm: Object.fromEntries(Object.entries(payload.batchNorm).map(([key, value]) => [key, typeof value === 'string' ? bytes(value) : value])),
        layers: payload.layers.map(layer => ({ ...layer, kernel: bytes(layer.kernel), bias: bytes(layer.bias) })),
    };
}

function predict(landmarks) {
    const wrist = landmarks[0]; const raw = landmarks.flatMap(point => [point.x - wrist.x, point.y - wrist.y]);
    const scale = Math.max(...raw.map(Math.abs)); if (!scale || !classifier) return null;
    let values = Float32Array.from(raw, value => value / scale);
    const { gamma, beta, mean, variance, epsilon } = classifier.batchNorm;
    for (let i = 0; i < values.length; i += 1) values[i] = gamma[i] * (values[i] - mean[i]) / Math.sqrt(variance[i] + epsilon) + beta[i];
    classifier.layers.forEach((layer, layerIndex) => {
        const output = new Float32Array(layer.outputSize); output.set(layer.bias);
        for (let i = 0; i < layer.inputSize; i += 1) for (let j = 0; j < layer.outputSize; j += 1) output[j] += values[i] * layer.kernel[i * layer.outputSize + j];
        if (layerIndex < classifier.layers.length - 1) for (let i = 0; i < output.length; i += 1) { const softplus = output[i] > 20 ? output[i] : Math.log1p(Math.exp(output[i])); output[i] *= Math.tanh(softplus); }
        values = output;
    });
    const max = Math.max(...values); const scores = Float32Array.from(values, value => Math.exp(value - max)); const total = scores.reduce((sum, value) => sum + value, 0);
    const index = scores.reduce((best, value, i) => value > scores[best] ? i : best, 0);
    return { letter: classifier.labels[index], confidence: scores[index] / total };
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
    if (!result || result.confidence < MIN_CONFIDENCE) { if (candidate) reset('Show your hand clearly.'); return; }
    lastHandAt = now;
    if (result.letter !== target()) { if (candidate || Math.floor(now / 800) !== Math.floor((now - 16) / 800)) status(`Try the ${target()} hand sign.`); reset(); return; }
    if (candidate !== result.letter) { candidate = result.letter; candidateAt = now; progress(0); status(`That looks like ${result.letter}. Hold it there.`); return; }
    const held = now - candidateAt; progress(held / HOLD_MS); if (held >= HOLD_MS) accept();
}

function frame() {
    if (!running) return;
    const now = performance.now();
    if (el.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const landmarks = landmarker.detectForVideo(el.video, now).landmarks?.[0]; draw(landmarks);
        if (landmarks) handlePrediction(predict(landmarks), now);
        else if (now - lastHandAt > 250) reset('Show your hand in the frame.');
    }
    animationId = requestAnimationFrame(frame);
}

async function startCamera() {
    if (running) return; el.retry.hidden = true; status('Preparing the camera…');
    try {
        if (!landmarker) { const vision = await FilesetResolver.forVisionTasks(WASM_URL); landmarker = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: LANDMARKER_URL, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: .6, minHandPresenceConfidence: .6, minTrackingConfidence: .6 }); }
        if (!classifier) { const response = await fetch(MODEL_URL); if (!response.ok) throw new Error('Model unavailable'); classifier = loadClassifier(await response.json()); }
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
        el.video.srcObject = stream; await el.video.play(); el.canvas.width = el.video.videoWidth; el.canvas.height = el.video.videoHeight; running = true; status(`Make the ${target()} hand sign.`); frame();
    } catch (error) {
        console.error('Tutorial camera failed:', error); status(error.name === 'NotAllowedError' ? 'Camera permission is needed for this practice.' : 'The camera could not start.'); el.retry.hidden = false;
    }
}

el.retry.addEventListener('click', startCamera);
window.addEventListener('beforeunload', () => { running = false; cancelAnimationFrame(animationId); stream?.getTracks().forEach(track => track.stop()); });
updateGuide(); startCamera();
