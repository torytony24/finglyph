import { ASL_FEATURE_SPEC, preprocessLandmarks } from './landmark-preprocessing.js';

export const ASL_CLASSIFIER_SPEC = Object.freeze({
    format: 'f32-base64-v1',
    labels: 26,
    inputSize: ASL_FEATURE_SPEC.featureCount,
    batchNormEpsilon: 0.001,
});

function decodeFloat32(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Float32Array(bytes.buffer);
}

function assertLength(values, expected, name) {
    if (values.length !== expected) {
        throw new Error(`Invalid ${name} length: expected ${expected}, got ${values.length}.`);
    }
}

/** Hydrates and validates the JSON export without changing model weights. */
export function hydrateClassifier(payload) {
    if (payload?.format !== ASL_CLASSIFIER_SPEC.format || payload.labels?.length !== ASL_CLASSIFIER_SPEC.labels) {
        throw new Error('The alphabet classifier has an invalid format.');
    }

    const batchNorm = Object.fromEntries(
        Object.entries(payload.batchNorm || {})
            .map(([key, value]) => [key, typeof value === 'string' ? decodeFloat32(value) : value]),
    );
    const { gamma, beta, mean, variance, epsilon } = batchNorm;
    [gamma, beta, mean, variance].forEach((values, index) => {
        assertLength(values, ASL_CLASSIFIER_SPEC.inputSize, ['gamma', 'beta', 'mean', 'variance'][index]);
    });
    if (!Number.isFinite(epsilon) || epsilon <= 0) {
        throw new Error('The alphabet classifier has an invalid BatchNorm epsilon.');
    }

    const layers = payload.layers.map((layer, index) => {
        const hydrated = {
            ...layer,
            kernel: decodeFloat32(layer.kernel),
            bias: decodeFloat32(layer.bias),
        };
        const expectedInput = index === 0
            ? ASL_CLASSIFIER_SPEC.inputSize
            : payload.layers[index - 1].outputSize;
        if (hydrated.inputSize !== expectedInput) {
            throw new Error(`Invalid classifier layer ${index} input size.`);
        }
        assertLength(hydrated.kernel, hydrated.inputSize * hydrated.outputSize, `layer ${index} kernel`);
        assertLength(hydrated.bias, hydrated.outputSize, `layer ${index} bias`);
        return hydrated;
    });
    if (!layers.length || layers.at(-1).outputSize !== payload.labels.length) {
        throw new Error('The alphabet classifier has invalid output dimensions.');
    }

    return { labels: payload.labels, batchNorm, layers };
}

export async function loadClassifier(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load alphabet classifier: ${response.status}.`);
    return hydrateClassifier(await response.json());
}

function mish(value) {
    const softplus = value > 20 ? value : Math.log1p(Math.exp(value));
    return value * Math.tanh(softplus);
}

function applyDense(values, layer, activation) {
    const output = new Float32Array(layer.outputSize);
    output.set(layer.bias);
    for (let inputIndex = 0; inputIndex < layer.inputSize; inputIndex += 1) {
        const value = values[inputIndex];
        const offset = inputIndex * layer.outputSize;
        for (let outputIndex = 0; outputIndex < layer.outputSize; outputIndex += 1) {
            output[outputIndex] += value * layer.kernel[offset + outputIndex];
        }
    }
    if (activation) {
        for (let index = 0; index < output.length; index += 1) output[index] = mish(output[index]);
    }
    return output;
}

export function softmax(logits, temperature = 1) {
    if (!(temperature > 0)) throw new Error('Softmax temperature must be positive.');
    const maximum = Math.max(...logits);
    const exponentials = Float32Array.from(logits, value => Math.exp((value - maximum) / temperature));
    const total = exponentials.reduce((sum, value) => sum + value, 0);
    return Float32Array.from(exponentials, value => value / total);
}

/** Runs the unchanged BatchNorm -> Dense/Mish -> Softmax model. */
export function classifyFeatures(features, classifier) {
    if (!(features instanceof Float32Array) || features.length !== ASL_CLASSIFIER_SPEC.inputSize || !classifier) {
        return null;
    }

    const values = new Float32Array(features);
    const { gamma, beta, mean, variance, epsilon } = classifier.batchNorm;
    for (let index = 0; index < values.length; index += 1) {
        values[index] = gamma[index] * (values[index] - mean[index]) / Math.sqrt(variance[index] + epsilon) + beta[index];
    }

    let output = values;
    classifier.layers.forEach((layer, index) => {
        output = applyDense(output, layer, index < classifier.layers.length - 1);
    });
    const probabilities = softmax(output);
    const index = probabilities.reduce((best, value, current) => value > probabilities[best] ? current : best, 0);
    return {
        letter: classifier.labels[index],
        confidence: probabilities[index],
        index,
        labels: classifier.labels,
        logits: output,
        probabilities,
    };
}

export function classifyLandmarks(landmarks, classifier) {
    const features = preprocessLandmarks(landmarks);
    if (!features) return null;
    return { ...classifyFeatures(features, classifier), features };
}
