/**
 * The exact 42-value feature contract used by asl-landmark-model.json.
 *
 * Landmark order is the MediaPipe HandLandmarker normalized-landmark order
 * (wrist = index 0). z, handedness, and world landmarks are deliberately not
 * included: the deployed classifier was trained on x/y only.
 */
export const ASL_FEATURE_SPEC = Object.freeze({
    landmarkCount: 21,
    featureCount: 42,
    coordinateOrder: 'x,y',
    origin: 'landmark[0] (wrist)',
    scale: 'max(abs(x - wrist.x), abs(y - wrist.y)) over all 21 landmarks',
    geometricEpsilon: null,
});

function isFiniteCoordinate(value) {
    return Number.isFinite(value);
}

/**
 * Converts MediaPipe normalized image landmarks to the model's fixed feature
 * vector. The input landmarks themselves are never mutated.
 *
 * @param {Array<{x: number, y: number}>} landmarks MediaPipe indices 0..20.
 * @returns {Float32Array|null} A 42-value vector, or null for invalid/flat input.
 */
export function preprocessLandmarks(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length !== ASL_FEATURE_SPEC.landmarkCount) {
        return null;
    }

    const wrist = landmarks[0];
    if (!wrist || !isFiniteCoordinate(wrist.x) || !isFiniteCoordinate(wrist.y)) {
        return null;
    }

    // Keep intermediate arithmetic in JavaScript Number precision, then cast
    // once at the output boundary. This matches the original inference code.
    const values = new Array(ASL_FEATURE_SPEC.featureCount);
    let scale = 0;

    for (let index = 0; index < landmarks.length; index += 1) {
        const point = landmarks[index];
        if (!point || !isFiniteCoordinate(point.x) || !isFiniteCoordinate(point.y)) {
            return null;
        }

        const x = point.x - wrist.x;
        const y = point.y - wrist.y;
        values[index * 2] = x;
        values[index * 2 + 1] = y;
        scale = Math.max(scale, Math.abs(x), Math.abs(y));
    }

    // There was no geometric epsilon in the original model contract. A hand
    // with zero extent cannot produce a meaningful scale-invariant feature.
    if (!Number.isFinite(scale) || scale === 0) return null;

    return Float32Array.from(values, value => value / scale);
}
