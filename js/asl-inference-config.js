/**
 * Versioned, inference-only defaults. Override selected nested values by
 * assigning window.FinglyphAslConfig before the application module loads, or
 * by passing overrides to resolveInferenceConfig in tests/tools.
 */
export const DEFAULT_ASL_INFERENCE_CONFIG = Object.freeze({
    model: {
        classifierPath: 'assets/models/asl-landmark-model.json',
        handLandmarkerPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        mediaPipeVersion: '1.0.1',
        delegate: 'GPU',
        numHands: 1,
        minHandDetectionConfidence: 0.7,
        minHandPresenceConfidence: 0.7,
        minTrackingConfidence: 0.7,
    },
    camera: { facingMode: 'user', width: 1280, height: 720 },
    temporal: {
        landmarkFilter: 'one-euro', // 'one-euro', 'ema', or 'none'
        oneEuroMinCutoff: 1.0,
        oneEuroBeta: 0.02,
        oneEuroDerivativeCutoff: 1.0,
        landmarkEmaAlpha: 0.35,
        probabilityEmaAlpha: 0.35,
        majorityVoteFrames: 7,
        entryThreshold: 0.85,
        exitThreshold: 0.70,
        debounceMs: 300,
        releaseDelayMs: 250,
    },
    confidence: {
        calibrationPath: 'assets/models/asl-calibration.json',
        policyPath: 'assets/models/asl-decision-policy.json',
        defaultThreshold: 0.85,
        top2Margin: 0.15,
        perClassThresholds: {},
        maxEnergy: null,
    },
});

function mergeSection(defaults, override) {
    return { ...defaults, ...(override && typeof override === 'object' ? override : {}) };
}

/** Returns a detached, shallowly validated config safe for one recognizer. */
export function resolveInferenceConfig(overrides = {}) {
    const config = {
        model: mergeSection(DEFAULT_ASL_INFERENCE_CONFIG.model, overrides.model),
        camera: mergeSection(DEFAULT_ASL_INFERENCE_CONFIG.camera, overrides.camera),
        temporal: mergeSection(DEFAULT_ASL_INFERENCE_CONFIG.temporal, overrides.temporal),
        confidence: mergeSection(DEFAULT_ASL_INFERENCE_CONFIG.confidence, overrides.confidence),
    };
    const temporal = config.temporal;
    if (!['one-euro', 'ema', 'none'].includes(temporal.landmarkFilter)) throw new Error('Invalid landmarkFilter.');
    if (!(temporal.landmarkEmaAlpha > 0 && temporal.landmarkEmaAlpha <= 1)) throw new Error('landmarkEmaAlpha must be in (0, 1].');
    if (!(temporal.probabilityEmaAlpha > 0 && temporal.probabilityEmaAlpha <= 1)) throw new Error('probabilityEmaAlpha must be in (0, 1].');
    if (!Number.isInteger(temporal.majorityVoteFrames) || temporal.majorityVoteFrames < 1 || temporal.majorityVoteFrames > 60) throw new Error('majorityVoteFrames must be 1..60.');
    if (!(temporal.entryThreshold >= temporal.exitThreshold && temporal.entryThreshold <= 1 && temporal.exitThreshold >= 0)) throw new Error('Invalid hysteresis thresholds.');
    if (!(temporal.debounceMs >= 0 && temporal.releaseDelayMs >= 0)) throw new Error('Temporal durations must be non-negative.');
    if (!(config.confidence.defaultThreshold >= 0 && config.confidence.defaultThreshold <= 1 && config.confidence.top2Margin >= 0)) throw new Error('Invalid confidence policy.');
    return config;
}
