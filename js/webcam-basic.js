import { resolveInferenceConfig } from './asl-inference-config.js';

const config = resolveInferenceConfig(window.FinglyphAslConfig);
let stream = null;

function setStatus(message) {
    document.getElementById('camera-status').textContent = message;
}

function clearOverlay() {
    const canvas = document.getElementById('hand-overlay');
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
}

function setToggleState(state, label, { disabled = false, pressed = false } = {}) {
    const button = document.getElementById('camera-toggle');
    button.dataset.state = state;
    button.disabled = disabled;
    button.setAttribute('aria-pressed', String(pressed));
    button.setAttribute('aria-label', label);
    button.title = label;
    document.getElementById('camera-toggle-label').textContent = label;
}

async function startCamera() {
    const video = document.getElementById('webcam');

    if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('Camera not supported.');
        setToggleState('error', 'Try again');
        return;
    }

    setToggleState('starting', 'Starting…', { disabled: true });
    setStatus('Requesting camera access.');

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: config.camera.facingMode,
                width: { ideal: config.camera.width },
                height: { ideal: config.camera.height },
                frameRate: { ideal: 30 },
            },
        });
        video.srcObject = stream;
        await video.play();
        setToggleState('on', 'Stop camera', { pressed: true });
        setStatus('Camera on. Loading recognition.');
        window.dispatchEvent(new CustomEvent('finglyph:camera-started', {
            detail: { video },
        }));
    } catch (error) {
        console.error('Could not start webcam:', error);
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
        video.srcObject = null;
        const message = error.name === 'NotAllowedError'
            ? 'Camera permission denied.'
            : 'Camera unavailable. Try again.';
        setStatus(message);
        setToggleState('error', 'Try again');
    }
}

function stopCamera() {
    const video = document.getElementById('webcam');
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    clearOverlay();
    window.dispatchEvent(new Event('finglyph:camera-stopped'));
    setToggleState('off', 'Start camera');
    setStatus('Camera is off.');
}

window.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('camera-toggle');
    setToggleState('off', 'Start camera');
    button.addEventListener('click', () => {
        if (stream?.active) stopCamera();
        else startCamera();
    });
});
