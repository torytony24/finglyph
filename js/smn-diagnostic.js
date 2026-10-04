import { resolveInferenceConfig } from './asl-inference-config.js';
import { classifyLandmarks, loadClassifier } from './landmark-classifier.js';
import { LandmarkTemporalFilter } from './temporal-stabilization.js';
import { measureSThumbDepth } from './s-depth-disambiguation.js';

const config = resolveInferenceConfig();
const elements = Object.fromEntries(['label', 'start', 'record', 'download', 'stop', 'status', 'video', 'live', 'summary']
    .map(id => [id, document.getElementById(id)]));
const filter = new LandmarkTemporalFilter(config.temporal);
const samples = [];
let landmarker;
let classifier;
let stream;
let frameId;
let recording;
let lastFrameAt = 0;

function status(message) { elements.status.textContent = message; }
function score(prediction, letter) { return prediction.probabilities[prediction.labels.indexOf(letter)]; }
function percent(value) { return `${(value * 100).toFixed(1)}%`; }

function summaryFor(label) {
    const rows = samples.filter(sample => sample.label === label);
    if (!rows.length) return `${label}: 기록 없음`;
    const mean = key => rows.reduce((total, row) => total + row[key], 0) / rows.length;
    const topCounts = Object.fromEntries(['S', 'M', 'N'].map(letter => [letter, rows.filter(row => row.top === letter).length]));
    const other = rows.length - Object.values(topCounts).reduce((total, count) => total + count, 0);
    const depthPass = rows.filter(row => row.depthMatchesS).length;
    const depths = rows.map(row => row.depthRatio).sort((a, b) => a - b);
    const quantile = fraction => depths[Math.floor((depths.length - 1) * fraction)].toFixed(3);
    return `${label}: ${rows.length}프레임, 독립 기록 ${new Set(rows.map(row => row.recordingId)).size}회\n`
        + `  원점수 평균 S ${percent(mean('s'))} / M ${percent(mean('m'))} / N ${percent(mean('n'))}\n`
        + `  1순위 S ${topCounts.S} / M ${topCounts.M} / N ${topCounts.N} / 기타 ${other}\n`
        + `  S 깊이 조건 통과 ${depthPass}/${rows.length}, 깊이 비율 10%/중앙/90% ${quantile(0.1)} / ${quantile(0.5)} / ${quantile(0.9)}`;
}

function renderSummary() {
    elements.summary.textContent = ['S', 'M', 'N'].map(summaryFor).join('\n\n');
    elements.download.disabled = samples.length === 0;
}

function stopCamera() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = undefined;
    recording = undefined;
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    elements.video.srcObject = null;
    filter.reset();
    renderSummary();
    elements.start.disabled = false;
    elements.record.disabled = true;
    elements.stop.disabled = true;
    status('카메라가 종료되었습니다.');
}

function frame(now) {
    if (!stream) return;
    if (now - lastFrameAt >= 100 && elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        lastFrameAt = now;
        const raw = landmarker.detectForVideo(elements.video, now).landmarks?.[0];
        if (raw) {
            const filtered = filter.update(raw, now);
            const prediction = classifyLandmarks(filtered, classifier);
            const depth = measureSThumbDepth(filtered, config.sDepth.minThumbDepthRatio);
            if (prediction) {
                const s = score(prediction, 'S');
                const m = score(prediction, 'M');
                const n = score(prediction, 'N');
                elements.live.textContent = `모델 1순위: ${prediction.letter} ${percent(prediction.confidence)}\n`
                    + `원점수 S ${percent(s)} / M ${percent(m)} / N ${percent(n)}\n`
                    + `엄지 깊이 비율: ${depth.available ? depth.ratio.toFixed(3) : '측정 불가'} / S 깊이 판정: ${depth.matchesS ? '통과' : '미통과'}`;
                if (recording && now <= recording.endsAt && depth.available) {
                    samples.push({
                        id: `${recording.id}-${recording.frame++}`,
                        recordingId: recording.id,
                        label: recording.label,
                        timestampMs: Math.round(now - recording.startedAt),
                        landmarks: raw.map(({ x, y, z }) => ({ x, y, z })),
                        top: prediction.letter,
                        s, m, n,
                        depthRatio: depth.ratio,
                        depthMatchesS: depth.matchesS,
                    });
                }
            }
            elements.record.disabled = Boolean(recording);
        } else {
            filter.reset();
            elements.live.textContent = '손을 찾지 못했습니다.';
            elements.record.disabled = true;
        }
        if (recording && now > recording.endsAt) {
            const finished = recording;
            recording = undefined;
            elements.record.disabled = false;
            renderSummary();
            status(`${finished.label} 기록 완료. 손모양을 새로 만든 다음 다시 기록하세요.`);
        }
    }
    frameId = requestAnimationFrame(frame);
}

elements.start.addEventListener('click', async () => {
    elements.start.disabled = true;
    status('손 인식 모델을 불러오는 중입니다.');
    try {
        if (!landmarker) {
            const { FilesetResolver, HandLandmarker } = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${config.model.mediaPipeVersion}/+esm`);
            const vision = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${config.model.mediaPipeVersion}/wasm`);
            landmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: config.model.handLandmarkerPath, delegate: config.model.delegate },
                runningMode: 'VIDEO', numHands: 1,
                minHandDetectionConfidence: config.model.minHandDetectionConfidence,
                minHandPresenceConfidence: config.model.minHandPresenceConfidence,
                minTrackingConfidence: config.model.minTrackingConfidence,
            });
        }
        classifier ??= await loadClassifier(config.model.classifierPath);
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
            facingMode: config.camera.facingMode,
            width: { ideal: config.camera.width },
            height: { ideal: config.camera.height },
        } });
        elements.video.srcObject = stream;
        await elements.video.play();
        elements.stop.disabled = false;
        status('S, M, N을 각각 여러 번 기록하세요. 한 기록은 3초입니다.');
        frameId = requestAnimationFrame(frame);
    } catch (error) {
        console.error(error);
        stopCamera();
        status(`카메라를 시작하지 못했습니다: ${error.message}`);
    }
});

elements.record.addEventListener('click', () => {
    const startedAt = performance.now();
    const label = elements.label.value;
    recording = { id: `${label}-${Date.now()}`, label, startedAt, endsAt: startedAt + 3000, frame: 0 };
    elements.record.disabled = true;
    status(`${label} 손모양을 3초간 유지하세요.`);
});

elements.download.addEventListener('click', () => {
    const payload = { schema: 'finglyph-smn-diagnostic-v2', capturedAt: new Date().toISOString(), samples };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'finglyph-smn-diagnostic.json' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

elements.stop.addEventListener('click', stopCamera);
window.addEventListener('beforeunload', stopCamera);
