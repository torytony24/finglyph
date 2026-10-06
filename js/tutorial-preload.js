import { resolveInferenceConfig } from './asl-inference-config.js';
import { loadClassifier } from './landmark-classifier.js';
import { loadConfidenceArtifacts } from './confidence-postprocessing.js';
import { loadHandLandmarkerModel } from './tutorial-model-cache.js';

const config = resolveInferenceConfig(window.FinglyphAslConfig);
const mediaPipeBase = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${config.model.mediaPipeVersion}`;

async function fetchComplete(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not preload ${url}: ${response.status}.`);
    await response.arrayBuffer();
}

async function preloadMediaPipe() {
    const { FilesetResolver } = await import(`${mediaPipeBase}/+esm`);
    const fileset = await FilesetResolver.forVisionTasks(`${mediaPipeBase}/wasm`);
    await Promise.all([
        fetchComplete(fileset.wasmLoaderPath),
        fetchComplete(fileset.wasmBinaryPath),
    ]);
}

export async function preloadTutorialResources() {
    const localAssets = [
        'tutorial_page.html',
        'css/tutorial_page.css?v=tutorial-preload-20261006',
        'js/tutorial-page.js?v=tutorial-preload-20261006',
        'js/tutorial-model-cache.js',
        'js/temporal-stabilization.js',
        'js/recognition-decision.js',
        'js/s-depth-disambiguation.js',
        'js/ur-crossing-disambiguation.js',
        'assets/thumbnail.png',
        ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => `assets/signs/${letter}.svg`),
    ];
    const results = await Promise.allSettled([
        preloadMediaPipe(),
        loadHandLandmarkerModel(config.model.handLandmarkerPath),
        loadClassifier(config.model.classifierPath),
        loadConfidenceArtifacts(config.confidence, config.confidence),
        ...localAssets.map(fetchComplete),
    ]);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) console.warn('Some tutorial resources could not be preloaded:', failures.map(result => result.reason));
    return failures.length === 0;
}
