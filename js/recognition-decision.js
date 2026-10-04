import { evaluateConfidencePolicy } from './confidence-postprocessing.js';
import { selectSDepthCandidate } from './s-depth-disambiguation.js';
import { selectURCrossingCandidate } from './ur-crossing-disambiguation.js';

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
