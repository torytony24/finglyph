import { softmax } from './landmark-classifier.js';

export const DEFAULT_CONFIDENCE_POLICY = Object.freeze({
    defaultThreshold: 0.85,
    top2Margin: 0.15,
    perClassThresholds: {},
    maxEnergy: null,
});

function bestIndex(values) { return values.reduce((best, value, index) => value > values[best] ? index : best, 0); }

export function applyTemperature(prediction, temperature = 1) {
    if (!prediction?.logits?.length || !(temperature > 0)) return prediction;
    const probabilities = softmax(prediction.logits, temperature);
    const index = bestIndex(probabilities);
    return { ...prediction, index, letter: prediction.labels[index], confidence: probabilities[index], probabilities, temperature };
}

export function energyScore(logits, temperature = 1) {
    if (!logits?.length || !(temperature > 0)) return null;
    const scaled = Array.from(logits, value => value / temperature);
    const maximum = Math.max(...scaled);
    const logSumExp = maximum + Math.log(scaled.reduce((sum, value) => sum + Math.exp(value - maximum), 0));
    return -temperature * logSumExp;
}

export function top2Margin(probabilities) {
    if (!probabilities?.length) return null;
    let first = -Infinity; let second = -Infinity;
    probabilities.forEach(value => { if (value > first) { second = first; first = value; } else if (value > second) second = value; });
    return first - second;
}

export function evaluateConfidencePolicy(prediction, policy = DEFAULT_CONFIDENCE_POLICY) {
    if (!prediction?.letter) return { accepted: false, reason: 'hysteresis' };
    const threshold = policy.perClassThresholds?.[prediction.letter] ?? policy.defaultThreshold;
    const margin = top2Margin(prediction.probabilities);
    if (prediction.confidence < threshold) return { accepted: false, reason: 'confidence', threshold, margin };
    if (margin === null || margin <= policy.top2Margin) return { accepted: false, reason: 'margin', threshold, margin };
    if (Number.isFinite(policy.maxEnergy) && (!Number.isFinite(prediction.energy) || prediction.energy > policy.maxEnergy)) return { accepted: false, reason: 'ood-energy', threshold, margin };
    return { accepted: true, threshold, margin };
}

async function readOptionalJson(url) {
    if (!url) return null;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return response.json();
}

/** Only validated calibration artifacts alter runtime confidence. */
export async function loadConfidenceArtifacts({ calibrationPath, policyPath }, defaults = DEFAULT_CONFIDENCE_POLICY) {
    const [calibration, storedPolicy] = await Promise.all([readOptionalJson(calibrationPath), readOptionalJson(policyPath)]);
    const temperature = calibration?.status === 'calibrated' && calibration.temperature > 0 ? calibration.temperature : 1;
    const policy = { ...defaults, ...(storedPolicy?.status === 'calibrated' ? storedPolicy : {}) };
    if (calibration?.status === 'calibrated' && calibration.recommendedDefaultThreshold >= 0 && calibration.recommendedDefaultThreshold <= 1) {
        policy.defaultThreshold = calibration.recommendedDefaultThreshold;
    }
    return { temperature, policy, calibrationStatus: calibration?.status ?? 'missing', policyStatus: storedPolicy?.status ?? 'missing' };
}
