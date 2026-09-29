/** Inference-only landmark and probability temporal filters. */

const MIN_DT_SECONDS = 1 / 240;
const MAX_DT_SECONDS = 1;

function alphaForCutoff(cutoff, dtSeconds) {
    const safeCutoff = Math.max(cutoff, 1e-6);
    const tau = 1 / (2 * Math.PI * safeCutoff);
    return 1 / (1 + tau / dtSeconds);
}

function validLandmarks(landmarks) {
    return Array.isArray(landmarks) && landmarks.length === 21
        && landmarks.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function cloneLandmarks(landmarks) {
    return landmarks.map(point => ({ ...point }));
}

/**
 * Filters full normalized MediaPipe landmarks before 42-D feature extraction.
 * The original result object is never mutated, so drawing can remain raw.
 */
export class LandmarkTemporalFilter {
    constructor(config) {
        this.config = config;
        this.reset();
    }

    reset() {
        this.previousRaw = null;
        this.previousFiltered = null;
        this.previousDerivative = null;
        this.previousTimestampMs = null;
    }

    update(landmarks, timestampMs) {
        if (!validLandmarks(landmarks)) return null;
        if (this.config.landmarkFilter === 'none') return cloneLandmarks(landmarks);
        if (!Number.isFinite(timestampMs) || !this.previousRaw) {
            this.previousRaw = cloneLandmarks(landmarks);
            this.previousFiltered = cloneLandmarks(landmarks);
            this.previousDerivative = landmarks.map(() => ({ x: 0, y: 0, z: 0 }));
            this.previousTimestampMs = timestampMs;
            return cloneLandmarks(landmarks);
        }

        const dtSeconds = Math.min(MAX_DT_SECONDS, Math.max(MIN_DT_SECONDS, (timestampMs - this.previousTimestampMs) / 1000));
        const next = landmarks.map((point, index) => {
            const previousRaw = this.previousRaw[index];
            const previousFiltered = this.previousFiltered[index];
            const previousDerivative = this.previousDerivative[index];
            const result = { ...point };

            ['x', 'y', 'z'].forEach(axis => {
                if (!Number.isFinite(point[axis])) return;
                if (this.config.landmarkFilter === 'ema') {
                    result[axis] = this.config.landmarkEmaAlpha * point[axis]
                        + (1 - this.config.landmarkEmaAlpha) * previousFiltered[axis];
                    return;
                }

                const derivative = (point[axis] - previousRaw[axis]) / dtSeconds;
                const derivativeAlpha = alphaForCutoff(this.config.oneEuroDerivativeCutoff, dtSeconds);
                const filteredDerivative = derivativeAlpha * derivative + (1 - derivativeAlpha) * previousDerivative[axis];
                const cutoff = this.config.oneEuroMinCutoff + this.config.oneEuroBeta * Math.abs(filteredDerivative);
                const valueAlpha = alphaForCutoff(cutoff, dtSeconds);
                result[axis] = valueAlpha * point[axis] + (1 - valueAlpha) * previousFiltered[axis];
                previousDerivative[axis] = filteredDerivative;
            });
            return result;
        });

        this.previousRaw = cloneLandmarks(landmarks);
        this.previousFiltered = cloneLandmarks(next);
        this.previousTimestampMs = timestampMs;
        return next;
    }
}

function topIndex(values) {
    return values.reduce((best, value, index) => value > values[best] ? index : best, 0);
}

/** Smooths model probabilities, votes over frames, then applies hysteresis. */
export class ProbabilityTemporalStabilizer {
    constructor(config) {
        this.config = config;
        this.reset();
    }

    reset() {
        this.emaProbabilities = null;
        this.votes = [];
        this.activeIndex = null;
    }

    entryThreshold(label) {
        return this.config.entryThresholdByClass?.[label] ?? this.config.entryThreshold;
    }

    exitThreshold(label) {
        return this.config.exitThresholdByClass?.[label] ?? this.config.exitThreshold;
    }

    update(prediction) {
        if (!prediction?.probabilities?.length) return null;
        const probabilities = prediction.probabilities;
        if (!this.emaProbabilities || this.emaProbabilities.length !== probabilities.length) {
            this.emaProbabilities = new Float32Array(probabilities);
        } else {
            const alpha = this.config.probabilityEmaAlpha;
            for (let index = 0; index < probabilities.length; index += 1) {
                this.emaProbabilities[index] = alpha * probabilities[index] + (1 - alpha) * this.emaProbabilities[index];
            }
        }

        const smoothedIndex = topIndex(this.emaProbabilities);
        this.votes.push(smoothedIndex);
        if (this.votes.length > this.config.majorityVoteFrames) this.votes.shift();
        const voteCounts = new Uint16Array(probabilities.length);
        this.votes.forEach(index => { voteCounts[index] += 1; });
        let votedIndex = smoothedIndex;
        for (let index = 0; index < voteCounts.length; index += 1) {
            if (voteCounts[index] > voteCounts[votedIndex]
                || (voteCounts[index] === voteCounts[votedIndex] && this.emaProbabilities[index] > this.emaProbabilities[votedIndex])) {
                votedIndex = index;
            }
        }
        const votedConfidence = this.emaProbabilities[votedIndex];
        const hasMajority = voteCounts[votedIndex] >= Math.ceil(this.config.majorityVoteFrames / 2);

        const votedLabel = prediction.labels?.[votedIndex];
        if (this.activeIndex === null) {
            if (hasMajority && votedConfidence >= this.entryThreshold(votedLabel)) this.activeIndex = votedIndex;
        } else if (this.emaProbabilities[this.activeIndex] < this.exitThreshold(prediction.labels?.[this.activeIndex])) {
            this.activeIndex = null;
            if (hasMajority && votedConfidence >= this.entryThreshold(votedLabel)) this.activeIndex = votedIndex;
        }

        return {
            // Preserve the class-index mapping for downstream pair/group checks.
            labels: prediction.labels,
            rawIndex: prediction.index,
            rawLetter: prediction.letter,
            rawConfidence: prediction.confidence,
            smoothedIndex,
            smoothedLetter: prediction.labels?.[smoothedIndex] ?? prediction.letter,
            votedIndex,
            votedLetter: prediction.labels?.[votedIndex] ?? prediction.letter,
            votedConfidence,
            hasMajority,
            activeIndex: this.activeIndex,
            letter: this.activeIndex === null ? null : prediction.labels?.[this.activeIndex] ?? prediction.letter,
            confidence: this.activeIndex === null ? 0 : this.emaProbabilities[this.activeIndex],
            probabilities: new Float32Array(this.emaProbabilities),
        };
    }
}

/** Counts label transitions for reproducible raw-vs-stabilized jitter reports. */
export function summarizePredictionTransitions(labels) {
    let changes = 0;
    for (let index = 1; index < labels.length; index += 1) {
        if (labels[index] !== labels[index - 1]) changes += 1;
    }
    return {
        frames: labels.length,
        changes,
        changeRatePercent: labels.length > 1 ? Number((changes / (labels.length - 1) * 100).toFixed(2)) : 0,
    };
}
