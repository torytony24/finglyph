const FINGER_POINTS = [5, 6, 7, 8, 9, 10, 11, 12];

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Compare the index/middle finger order along the line between their knuckles. */
export function measureURFingerCrossing(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length !== 21
        || FINGER_POINTS.some(index => !landmarks[index]
            || !Number.isFinite(landmarks[index].x)
            || !Number.isFinite(landmarks[index].y))) {
        return { kind: 'uncertain', tipOrder: null, dipOrder: null, tipGap: null };
    }

    const base = { x: landmarks[9].x - landmarks[5].x, y: landmarks[9].y - landmarks[5].y };
    const baseSquared = base.x * base.x + base.y * base.y;
    if (baseSquared < 1e-5) return { kind: 'uncertain', tipOrder: null, dipOrder: null, tipGap: null };
    const projectedOrder = (indexPoint, middlePoint) => (
        (middlePoint.x - indexPoint.x) * base.x + (middlePoint.y - indexPoint.y) * base.y
    ) / baseSquared;
    const pipOrder = projectedOrder(landmarks[6], landmarks[10]);
    const dipOrder = projectedOrder(landmarks[7], landmarks[11]);
    const tipOrder = projectedOrder(landmarks[8], landmarks[12]);
    const tipGap = distance(landmarks[8], landmarks[12]) / Math.sqrt(baseSquared);
    const indexPath = distance(landmarks[5], landmarks[6]) + distance(landmarks[6], landmarks[7]) + distance(landmarks[7], landmarks[8]);
    const middlePath = distance(landmarks[9], landmarks[10]) + distance(landmarks[10], landmarks[11]) + distance(landmarks[11], landmarks[12]);
    const indexExtension = indexPath > 0 ? distance(landmarks[5], landmarks[8]) / indexPath : 0;
    const middleExtension = middlePath > 0 ? distance(landmarks[9], landmarks[12]) / middlePath : 0;
    const indexVector = { x: landmarks[8].x - landmarks[5].x, y: landmarks[8].y - landmarks[5].y };
    const middleVector = { x: landmarks[12].x - landmarks[9].x, y: landmarks[12].y - landmarks[9].y };
    const vectorLength = Math.hypot(indexVector.x, indexVector.y) * Math.hypot(middleVector.x, middleVector.y);
    const alignment = vectorLength > 0
        ? (indexVector.x * middleVector.x + indexVector.y * middleVector.y) / vectorLength
        : -1;

    let kind = 'uncertain';
    if (pipOrder >= 0.25 && indexExtension >= 0.55 && middleExtension >= 0.55) {
        if (dipOrder <= -0.12 || tipOrder <= -0.12) kind = 'R';
        else if (dipOrder >= 0.12 && tipOrder >= 0.12 && tipGap <= 1.5 && alignment >= 0.7) kind = 'U';
    }
    return { kind, tipOrder, dipOrder, tipGap };
}

/** Geometry only overrides a model prediction already in the R/U pair. */
export function selectURCrossingCandidate(prediction, crossing) {
    if (!['R', 'U'].includes(prediction?.letter) || !['R', 'U'].includes(crossing?.kind)) return null;
    const index = prediction.labels?.indexOf(crossing.kind) ?? -1;
    if (index < 0 || !prediction.probabilities?.length) return null;
    return { letter: crossing.kind, confidence: prediction.probabilities[index], source: 'ur-crossing' };
}
