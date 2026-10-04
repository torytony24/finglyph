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
    sDepth: {
        // Provisional boundary from one S/M/N recording per class; recheck across sessions.
        minThumbDepthRatio: -0.03,
    },
    temporal: {
        landmarkFilter: 'one-euro', // 'one-euro', 'ema', or 'none'
        oneEuroMinCutoff: 1.0,
        oneEuroBeta: 0.02,
        oneEuroDerivativeCutoff: 1.0,
        landmarkEmaAlpha: 0.35,
        probabilityEmaAlpha: 0.35,
        // Longer evidence window reduces accidental confirmations.
        majorityVoteFrames: 15,
        entryThreshold: 0.80,
        exitThreshold: 0.60,
        debounceMs: 1000,
        releaseDelayMs: 250,
        // J/Z remain static-sign inference only; no sequential recognizer is used.
        entryThresholdByClass: {
            C: 0.75,
            E: 0.60,
            L: 0.60,
            J: 0.60,
            M: 0.50,
            N: 0.50,
            O: 0.60,
            P: 0.45,
            R: 0.50,
            S: 0.50,
            T: 0.50,
            U: 0.50,
            V: 0.50,
            X: 0.70,
            Z: 0.70,
        },
        exitThresholdByClass: {
            E: 0.50,
            L: 0.50,
            J: 0.50,
            M: 0.40,
            N: 0.40,
            O: 0.50,
            P: 0.35,
            R: 0.40,
            S: 0.40,
            T: 0.40,
            U: 0.40,
            V: 0.40,
            X: 0.60,
            Z: 0.60,
        },
    },
    confidence: {
        calibrationPath: 'assets/models/asl-calibration.json',
        policyPath: 'assets/models/asl-decision-policy.json',
        defaultThreshold: 0.80,
        top2Margin: 0.10,
        perClassThresholds: {
            C: 0.75,
            E: 0.60,
            L: 0.60,
            J: 0.60,
            M: 0.50,
            N: 0.50,
            O: 0.60,
            P: 0.45,
            R: 0.50,
            S: 0.50,
            T: 0.50,
            U: 0.50,
            V: 0.50,
            X: 0.70,
            Z: 0.70,
        },
        // Higher within-group margins reject visually ambiguous static signs.
        confusionGroupMargins: [
            { letters: ['A', 'E'], minMargin: 0.25 },
            { letters: ['M', 'N', 'S', 'T'], minMargin: 0.08 },
            { letters: ['U', 'V'], minMargin: 0.12 },
        ],
        top2MarginByClass: {
            M: 0.08,
            N: 0.08,
            P: 0.08,
            S: 0.08,
            T: 0.08,
        },
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
        sDepth: mergeSection(DEFAULT_ASL_INFERENCE_CONFIG.sDepth, overrides.sDepth),
        temporal: mergeSection(DEFAULT_ASL_INFERENCE_CONFIG.temporal, overrides.temporal),
        confidence: mergeSection(DEFAULT_ASL_INFERENCE_CONFIG.confidence, overrides.confidence),
    };
    const temporal = config.temporal;
    if (!(config.sDepth.minThumbDepthRatio >= -1 && config.sDepth.minThumbDepthRatio <= 1)) throw new Error('Invalid S depth policy.');
    if (!['one-euro', 'ema', 'none'].includes(temporal.landmarkFilter)) throw new Error('Invalid landmarkFilter.');
    if (!(temporal.landmarkEmaAlpha > 0 && temporal.landmarkEmaAlpha <= 1)) throw new Error('landmarkEmaAlpha must be in (0, 1].');
    if (!(temporal.probabilityEmaAlpha > 0 && temporal.probabilityEmaAlpha <= 1)) throw new Error('probabilityEmaAlpha must be in (0, 1].');
    if (!Number.isInteger(temporal.majorityVoteFrames) || temporal.majorityVoteFrames < 1 || temporal.majorityVoteFrames > 60) throw new Error('majorityVoteFrames must be 1..60.');
    if (!(temporal.entryThreshold >= temporal.exitThreshold && temporal.entryThreshold <= 1 && temporal.exitThreshold >= 0)) throw new Error('Invalid hysteresis thresholds.');
    if (!(temporal.debounceMs >= 0 && temporal.releaseDelayMs >= 0)) throw new Error('Temporal durations must be non-negative.');
    if (!(config.confidence.defaultThreshold >= 0 && config.confidence.defaultThreshold <= 1 && config.confidence.top2Margin >= 0)) throw new Error('Invalid confidence policy.');
    for (const [letter, threshold] of Object.entries(temporal.entryThresholdByClass ?? {})) {
        const exit = temporal.exitThresholdByClass?.[letter] ?? temporal.exitThreshold;
        if (!/^[A-Z]$/.test(letter) || !(threshold >= exit && threshold <= 1 && exit >= 0)) throw new Error(`Invalid class hysteresis for ${letter}.`);
    }
    for (const [letter, threshold] of Object.entries(config.confidence.perClassThresholds ?? {})) {
        if (!/^[A-Z]$/.test(letter) || !(threshold >= 0 && threshold <= 1)) throw new Error(`Invalid class threshold for ${letter}.`);
    }
    for (const [letter, margin] of Object.entries(config.confidence.top2MarginByClass ?? {})) {
        if (!/^[A-Z]$/.test(letter) || !(margin >= 0 && margin <= 1)) throw new Error(`Invalid class margin for ${letter}.`);
    }
    if ((config.confidence.confusionGroupMargins ?? []).some(group => !Array.isArray(group.letters) || !(group.minMargin >= 0 && group.minMargin <= 1))) throw new Error('Invalid confusion-group margin.');
    return config;
}
