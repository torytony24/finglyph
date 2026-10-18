import { classifyLandmarks } from './landmark-classifier.js';
import { applyTemperature, energyScore, evaluateConfidencePolicy } from './confidence-postprocessing.js';
import { measureSThumbDepth, selectSDepthCandidate } from './s-depth-disambiguation.js';
import { measureURFingerCrossing, selectURCrossingCandidate } from './ur-crossing-disambiguation.js';

/** Shared final selection for the main page and tutorial. */
export function chooseRecognitionCandidate(rawPrediction, sDepth, urCrossing, stabilizedPrediction, confidencePolicy) {
    const geometricS = selectSDepthCandidate(rawPrediction, sDepth);
    if (geometricS) return geometricS;
    const geometricUR = selectURCrossingCandidate(rawPrediction, urCrossing);
    if (geometricUR) return geometricUR;
    return evaluateConfidencePolicy(stabilizedPrediction, confidencePolicy, { sDepth }).accepted
        ? stabilizedPrediction
        : null;
}

/** Keep calibration and temporal evidence identical for both camera pages. */
export function recognizeFilteredLandmarks(landmarks, {
    classifier, probabilityStabilizer, minThumbDepthRatio, temperature, confidencePolicy,
}) {
    const rawPrediction = classifyLandmarks(landmarks, classifier);
    const sDepth = measureSThumbDepth(landmarks, minThumbDepthRatio);
    const urCrossing = measureURFingerCrossing(landmarks);
    const calibratedPrediction = applyTemperature(rawPrediction, temperature);
    if (calibratedPrediction) calibratedPrediction.energy = energyScore(calibratedPrediction.logits, temperature);
    const stabilizedPrediction = probabilityStabilizer.update(calibratedPrediction);
    if (stabilizedPrediction && calibratedPrediction) stabilizedPrediction.energy = calibratedPrediction.energy;
    return chooseRecognitionCandidate(rawPrediction, sDepth, urCrossing, stabilizedPrediction, confidencePolicy);
}
