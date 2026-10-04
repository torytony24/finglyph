/** Use relative depth only for the S/M/N ambiguity; the classifier remains x/y-only. */
export function measureSThumbDepth(landmarks, minThumbDepthRatio) {
    const indices = [0, 4, 5, 8, 9, 12, 17];
    if (!Array.isArray(landmarks) || landmarks.length !== 21
        || indices.some(index => !landmarks[index]
            || !Number.isFinite(landmarks[index].x)
            || !Number.isFinite(landmarks[index].y)
            || !Number.isFinite(landmarks[index].z))) {
        return { available: false, matchesS: false, ratio: null };
    }

    const distance = (a, b) => Math.hypot(landmarks[a].x - landmarks[b].x, landmarks[a].y - landmarks[b].y);
    const palmScale = Math.max(distance(0, 9), distance(5, 17));
    if (palmScale < 1e-6) return { available: false, matchesS: false, ratio: null };

    // MediaPipe z decreases toward the camera. Use the nearer of the two
    // fingertips as a conservative reference; the boundary is empirical and
    // can be negative when camera angle puts the index fingertip slightly ahead.
    const ratio = (Math.min(landmarks[8].z, landmarks[12].z) - landmarks[4].z) / palmScale;
    return { available: true, matchesS: ratio >= minThumbDepthRatio, ratio };
}

/** A depth-confirmed S is a separate geometric decision, not a fake softmax. */
export function selectSDepthCandidate(prediction, depth) {
    if (!depth?.matchesS || !['M', 'N', 'S'].includes(prediction?.letter)) return null;
    const sIndex = prediction.labels?.indexOf('S') ?? -1;
    if (sIndex < 0 || !prediction.probabilities?.length) return null;
    return { letter: 'S', confidence: prediction.probabilities[sIndex], source: 's-depth' };
}
