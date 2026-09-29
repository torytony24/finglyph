// DEBUG ONLY: remove this module import and update/clear calls to disable it.
function topTwo(probabilities) {
    let first = 0;
    let second = 1;
    if (probabilities[second] > probabilities[first]) [first, second] = [second, first];
    for (let index = 2; index < probabilities.length; index += 1) {
        if (probabilities[index] > probabilities[first]) {
            second = first;
            first = index;
        } else if (probabilities[index] > probabilities[second]) {
            second = index;
        }
    }
    return [first, second];
}

/** A self-contained, temporary raw-model diagnostics panel. */
export function createRawPredictionDebugOverlay(container) {
    const panel = document.createElement('pre');
    panel.dataset.debugPrediction = 'true';
    panel.setAttribute('aria-live', 'off');
    panel.style.cssText = [
        'position:absolute', 'z-index:10', 'top:8px', 'left:8px', 'margin:0',
        'padding:6px 8px', 'border-radius:4px', 'background:rgba(0,0,0,.72)',
        'color:#7dff9e', 'font:12px/1.45 ui-monospace,monospace', 'pointer-events:none',
    ].join(';');
    panel.textContent = 'RAW\nwaiting for hand...';
    container.append(panel);

    return {
        update(prediction) {
            if (!prediction?.probabilities?.length) {
                panel.textContent = 'RAW\ninvalid landmarks';
                return;
            }
            const [first, second] = topTwo(prediction.probabilities);
            panel.textContent = [
                'RAW MODEL (after landmark filter)',
                'before probability EMA/vote',
                `top1: ${prediction.labels[first]}  ${(prediction.probabilities[first] * 100).toFixed(1)}%`,
                `top2: ${prediction.labels[second]}  ${(prediction.probabilities[second] * 100).toFixed(1)}%`,
                `margin: ${((prediction.probabilities[first] - prediction.probabilities[second]) * 100).toFixed(1)}%`,
            ].join('\n');
        },
        clear() {
            panel.textContent = 'RAW\nwaiting for hand...';
        },
    };
}
