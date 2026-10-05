const DEFAULT_WORDS = ['hello', 'finglyph'];

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIGNS_PATH = 'assets/signs';
const FIST_LETTER = 'A';

// Keep the same discrete stop-motion settings as morph_demo.html.
const FRAME_COUNT = 5;
// Duration of frames 0..3 before advancing. The longer first hold makes
// the A/fist pose unmistakable before the hand starts opening.
const FRAME_DURATIONS = [260, 120, 100, 120];
const CONTOUR_POINTS = 256;
const DETAIL_SOURCE_END = 0.5;
const DETAIL_TARGET_START = 0.5;
const PASTE_STAGGER = 45;

const templateCache = new Map();
const geometryCache = new Map();
const slotTimers = new WeakMap();

let uniqueId = 0;
let renderedRecords = [];
let staging;
let currentWords = [];

const CARD_SIZE = {
    gap: 5,
    referenceGlyphCount: 5,
    referenceCardWidthRatio: 0.226,
    horizontalPaddingRatio: 0.21,
    viewportWidthRatio: 0.82,
};

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function lerp(from, to, amount) {
    return from + (to - from) * amount;
}

function smoothstep(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

function nextId(prefix) {
    uniqueId += 1;
    return `${prefix}-${uniqueId}`;
}

function signUrl(character) {
    return `${SIGNS_PATH}/${encodeURIComponent(character.toUpperCase())}.svg`;
}

function prepareSvgTemplate(svg) {
    if (svg.querySelector('[data-role="outer"]')) return;

    // Illustrator exports contain ordinary SVG shapes instead of the older
    // data-role markers. Use their largest filled shape as the morph contour.
    const shapes = [...svg.querySelectorAll('path, polygon, polyline')]
        .filter(shape => !shape.closest('defs'));
    const largest = shapes.reduce((best, shape) => {
        if (getComputedStyle(shape).fill === 'none') return best;
        const box = shape.getBBox();
        const area = box.width * box.height;
        return area > best.area ? { shape, area } : best;
    }, { shape: null, area: 0 }).shape;
    if (!largest) throw new Error('The hand-sign SVG has no filled shape to morph.');

    let outer = largest;
    if (outer.localName !== 'path') {
        const points = Array.from(outer.points, point => `${point.x} ${point.y}`);
        if (points.length < 3) throw new Error('The hand-sign SVG has an invalid outer polygon.');
        const path = document.createElementNS(SVG_NS, 'path');
        for (const attribute of outer.attributes) {
            if (attribute.name !== 'points') path.setAttribute(attribute.name, attribute.value);
        }
        path.setAttribute('d', `M ${points.join(' L ')} Z`);
        outer.replaceWith(path);
        outer = path;
    }
    outer.setAttribute('data-role', 'outer');
    svg.dataset.plainSignAsset = 'true';
}

async function loadSvgTemplate(character) {
    const cacheKey = character.toUpperCase();

    if (!templateCache.has(cacheKey)) {
        const request = (async () => {
            const url = signUrl(cacheKey);
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Could not find SVG file: ${cacheKey}.svg`);
            }

            const svgText = await response.text();
            const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');

            if (parsed.querySelector('parsererror')) {
                throw new Error(`Could not read SVG: ${cacheKey}.svg`);
            }

            const svg = document.importNode(parsed.documentElement, true);
            svg.setAttribute('aria-hidden', 'true');
            staging.appendChild(svg);
            prepareSvgTemplate(svg);
            return svg;
        })().catch(error => {
            templateCache.delete(cacheKey);
            throw error;
        });

        templateCache.set(cacheKey, request);
    }

    return templateCache.get(cacheKey);
}

function readViewBox(svg) {
    const values = (svg.getAttribute('viewBox') || '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);

    if (values.length !== 4 || values.some(value => !Number.isFinite(value))
        || values[2] <= 0 || values[3] <= 0) {
        throw new Error('Each hand-sign SVG must define a valid viewBox.');
    }

    const [x, y, width, height] = values;
    return {
        value: `${x} ${y} ${width} ${height}`,
        x, y, width, height,
    };
}

function samplePath(path, count) {
    if (typeof path.getTotalLength !== 'function') {
        throw new Error('data-role="outer" must be a path element.');
    }

    const length = path.getTotalLength();
    const points = [];

    for (let index = 0; index < count; index += 1) {
        const point = path.getPointAtLength(length * index / count);
        points.push({ x: point.x, y: point.y });
    }

    return points;
}

function contourError(source, target) {
    let error = 0;

    for (let index = 0; index < source.length; index += 1) {
        const dx = source[index].x - target[index].x;
        const dy = source[index].y - target[index].y;
        error += dx * dx + dy * dy;
    }

    return error / source.length;
}

function rotateArray(array, offset) {
    return [...array.slice(offset), ...array.slice(0, offset)];
}

function findBestShift(source, target) {
    let bestPoints = target;
    let bestError = Infinity;

    for (let shift = 0; shift < target.length; shift += 1) {
        const candidate = rotateArray(target, shift);
        const error = contourError(source, candidate);

        if (error < bestError) {
            bestError = error;
            bestPoints = candidate;
        }
    }

    return { points: bestPoints, error: bestError };
}

function alignContours(source, target) {
    const forward = findBestShift(source, target);
    const reverse = findBestShift(source, [...target].reverse());
    return forward.error <= reverse.error ? forward.points : reverse.points;
}

function interpolatePoints(source, target, amount) {
    return source.map((point, index) => ({
        x: lerp(point.x, target[index].x, amount),
        y: lerp(point.y, target[index].y, amount),
    }));
}

function pointsToPath(points) {
    if (!points.length) return '';

    const commands = points.map((point, index) => {
        const command = index === 0 ? 'M' : 'L';
        return `${command} ${point.x} ${point.y}`;
    });

    return `${commands.join(' ')} Z`;
}

function detailSourceAmount(time) {
    if (time >= DETAIL_SOURCE_END) return 0;
    return 1 - smoothstep(time / DETAIL_SOURCE_END);
}

function detailTargetAmount(time) {
    if (time <= DETAIL_TARGET_START) return 0;
    return smoothstep((time - DETAIL_TARGET_START) / (1 - DETAIL_TARGET_START));
}

async function prepareMorphGeometry(sourceCharacter, targetCharacter) {
    const sourceKey = sourceCharacter.toUpperCase();
    const targetKey = targetCharacter.toUpperCase();
    const transitionKey = `${sourceKey}→${targetKey}`;

    if (!geometryCache.has(transitionKey)) {
        const request = (async () => {
            const [sourceSvg, targetSvg] = await Promise.all([
                loadSvgTemplate(sourceKey),
                loadSvgTemplate(targetKey),
            ]);

            const sourceOuter = sourceSvg.querySelector('[data-role="outer"]');
            const targetOuter = targetSvg.querySelector('[data-role="outer"]');

            if (!sourceOuter || !targetOuter) {
                throw new Error(
                    `Could not find data-role="outer" in ${sourceKey}.svg or ${targetKey}.svg.`,
                );
            }

            const sourcePoints = samplePath(sourceOuter, CONTOUR_POINTS);
            const sampledTarget = samplePath(targetOuter, CONTOUR_POINTS);

            return {
                sourceSvg,
                targetSvg,
                sourceUrl: signUrl(sourceKey),
                targetUrl: signUrl(targetKey),
                sourcePlain: sourceSvg.dataset.plainSignAsset === 'true',
                targetPlain: targetSvg.dataset.plainSignAsset === 'true',
                sourceViewBox: readViewBox(sourceSvg),
                targetViewBox: readViewBox(targetSvg),
                sourcePoints,
                targetPoints: alignContours(sourcePoints, sampledTarget),
                fill: sourceOuter.getAttribute('fill') || getComputedStyle(sourceOuter).fill || '#e9fea3',
            };
        })().catch(error => {
            geometryCache.delete(transitionKey);
            throw error;
        });

        geometryCache.set(transitionKey, request);
    }

    return geometryCache.get(transitionKey);
}

function createDetailItem(source, fitGroup, defs, side) {
    const clone = source.cloneNode(true);
    const originalTransform = clone.getAttribute('transform');
    const kind = source.dataset.kind || 'line';

    clone.removeAttribute('transform');

    const placementGroup = document.createElementNS(SVG_NS, 'g');
    if (originalTransform) placementGroup.setAttribute('transform', originalTransform);
    fitGroup.appendChild(placementGroup);

    const clippingGroup = document.createElementNS(SVG_NS, 'g');
    const movingGroup = document.createElementNS(SVG_NS, 'g');
    movingGroup.appendChild(clone);
    clippingGroup.appendChild(movingGroup);
    placementGroup.appendChild(clippingGroup);

    const bbox = clone.getBBox();
    const clipId = nextId('detail-clip');
    const clipPath = document.createElementNS(SVG_NS, 'clipPath');
    const clipRect = document.createElementNS(SVG_NS, 'rect');

    clipPath.setAttribute('id', clipId);
    clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    clippingGroup.setAttribute('clip-path', `url(#${clipId})`);

    return {
        kind,
        side,
        bbox,
        clipRect,
        movingGroup,
        nailAxis: bbox.width >= bbox.height ? 'x' : 'y',
    };
}

function createDetails(sourceSvg, outputSvg, defs, side) {
    const detailGroup = document.createElementNS(SVG_NS, 'g');
    outputSvg.appendChild(detailGroup);

    return [...sourceSvg.querySelectorAll('[data-role="detail"]')]
        .map(detail => createDetailItem(detail, detailGroup, defs, side));
}

function renderLine(item, amount) {
    const { bbox, clipRect } = item;

    if (bbox.width >= bbox.height) {
        const width = bbox.width * amount;
        clipRect.setAttribute('x', bbox.x + (bbox.width - width) / 2);
        clipRect.setAttribute('y', bbox.y - 1);
        clipRect.setAttribute('width', Math.max(0, width));
        clipRect.setAttribute('height', bbox.height + 2);
    } else {
        const height = bbox.height * amount;
        clipRect.setAttribute('x', bbox.x - 1);
        clipRect.setAttribute('y', bbox.y + (bbox.height - height) / 2);
        clipRect.setAttribute('width', bbox.width + 2);
        clipRect.setAttribute('height', Math.max(0, height));
    }
}

function renderNail(item, amount) {
    const { bbox, clipRect, movingGroup, nailAxis, side } = item;
    const padding = 0.2;

    clipRect.setAttribute('x', bbox.x - padding);
    clipRect.setAttribute('y', bbox.y - padding);
    clipRect.setAttribute('width', bbox.width + padding * 2);
    clipRect.setAttribute('height', bbox.height + padding * 2);

    const hiddenAmount = 1 - amount;
    const direction = side === 'source' ? 1 : -1;
    const dx = nailAxis === 'x' ? direction * hiddenAmount * (bbox.width + 1) : 0;
    const dy = nailAxis === 'y' ? direction * hiddenAmount * (bbox.height + 1) : 0;
    movingGroup.setAttribute('transform', `translate(${dx} ${dy})`);
}

function renderDetails(details, amount) {
    details.forEach(detail => {
        if (detail.kind === 'nail') {
            renderNail(detail, amount);
        } else {
            renderLine(detail, amount);
        }
    });
}

function createSvgSnapshot(url, viewBox, outputSvg) {
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('href', url);
    image.setAttribute('x', viewBox.x);
    image.setAttribute('y', viewBox.y);
    image.setAttribute('width', viewBox.width);
    image.setAttribute('height', viewBox.height);
    image.setAttribute('pointer-events', 'none');
    outputSvg.appendChild(image);
    return image;
}

function createMorphState(geometry, character, slot) {
    const outputSvg = document.createElementNS(SVG_NS, 'svg');
    outputSvg.classList.add('morph-glyph');
    outputSvg.setAttribute('viewBox', geometry.targetViewBox.value);
    outputSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    outputSvg.setAttribute('role', 'img');
    outputSvg.setAttribute('aria-label', `${character.toUpperCase()} hand sign`);

    const defs = document.createElementNS(SVG_NS, 'defs');
    const outerOutput = document.createElementNS(SVG_NS, 'path');
    outerOutput.setAttribute('fill', geometry.fill);

    outputSvg.appendChild(defs);
    outputSvg.appendChild(outerOutput);
    slot.replaceChildren(outputSvg);

    const sourceDetails = createDetails(
        geometry.sourceSvg,
        outputSvg,
        defs,
        'source',
    );
    const targetDetails = createDetails(
        geometry.targetSvg,
        outputSvg,
        defs,
        'target',
    );
    const sourceSnapshot = geometry.sourcePlain
        ? createSvgSnapshot(geometry.sourceUrl, geometry.sourceViewBox, outputSvg)
        : null;
    const targetSnapshot = geometry.targetPlain
        ? createSvgSnapshot(geometry.targetUrl, geometry.targetViewBox, outputSvg)
        : null;

    return {
        sourcePoints: geometry.sourcePoints,
        targetPoints: geometry.targetPoints,
        outerOutput,
        sourceDetails,
        targetDetails,
        sourceSnapshot,
        targetSnapshot,
    };
}

function renderFrame(state, frameIndex) {
    const safeFrame = Math.max(0, Math.min(FRAME_COUNT - 1, frameIndex));
    const time = safeFrame / (FRAME_COUNT - 1);
    const shapeAmount = smoothstep(time);
    const points = interpolatePoints(state.sourcePoints, state.targetPoints, shapeAmount);

    state.outerOutput.setAttribute('d', pointsToPath(points));
    renderDetails(state.sourceDetails, detailSourceAmount(time));
    renderDetails(state.targetDetails, detailTargetAmount(time));
    if (state.sourceSnapshot) state.sourceSnapshot.setAttribute('opacity', detailSourceAmount(time));
    if (state.targetSnapshot) state.targetSnapshot.setAttribute('opacity', detailTargetAmount(time));
}

function clearSlotTimer(slot) {
    const playback = slotTimers.get(slot);

    if (playback) {
        playback.cancelled = true;

        if (playback.timeoutId !== null) {
            window.clearTimeout(playback.timeoutId);
        }

        playback.rafIds.forEach(id => window.cancelAnimationFrame(id));
        slot.classList.remove('is-morphing');
        slotTimers.delete(slot);
    }
}

function playMorph(state, slot, delay = 0) {
    clearSlotTimer(slot);

    let frame = 0;
    const playback = {
        cancelled: false,
        timeoutId: null,
        rafIds: [],
    };

    slotTimers.set(slot, playback);
    renderFrame(state, frame);

    const advance = () => {
        if (playback.cancelled) return;

        frame += 1;
        renderFrame(state, frame);

        if (frame >= FRAME_COUNT - 1) {
            slotTimers.delete(slot);
            slot.classList.remove('is-morphing');
            return;
        }

        playback.timeoutId = window.setTimeout(
            advance,
            FRAME_DURATIONS[frame],
        );
    };

    slot.classList.add('is-morphing');

    // Two animation frames guarantee that frame 0 (the fist) is painted.
    // Starting from a timer alone can skip that paint when several glyphs
    // finish their SVG preparation in the same event-loop turn.
    playback.rafIds.push(window.requestAnimationFrame(() => {
        playback.rafIds.push(window.requestAnimationFrame(() => {
            if (playback.cancelled) return;

            playback.timeoutId = window.setTimeout(
                advance,
                FRAME_DURATIONS[0] + delay,
            );
        }));
    }));
}

function createFallbackSVG(character) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const rect = document.createElementNS(SVG_NS, 'rect');
    const text = document.createElementNS(SVG_NS, 'text');

    svg.classList.add('morph-glyph', 'glyph-fallback');
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${character.toUpperCase()} fallback character`);

    rect.setAttribute('x', '.08');
    rect.setAttribute('y', '.08');
    rect.setAttribute('width', '.84');
    rect.setAttribute('height', '.84');
    rect.setAttribute('rx', '.08');
    rect.setAttribute('fill', '#e9fea3');

    text.setAttribute('x', '.5');
    text.setAttribute('y', '.54');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-size', '.38');
    text.setAttribute('font-family', 'Inter, Arial, Helvetica, sans-serif');
    text.setAttribute('fill', '#2c6239');
    text.textContent = character.toUpperCase();

    svg.append(rect, text);
    return svg;
}

async function hydrateGlyph(
    slot,
    sourceCharacter,
    targetCharacter,
    shouldAnimate,
    delay = 0,
) {
    const token = nextId('glyph');
    slot.dataset.renderToken = token;
    slot.classList.add('is-loading');

    try {
        const geometry = await prepareMorphGeometry(sourceCharacter, targetCharacter);

        if (slot.dataset.renderToken !== token) return;

        const state = createMorphState(geometry, targetCharacter, slot);
        const isSamePose = sourceCharacter.toUpperCase() === targetCharacter.toUpperCase();

        if (shouldAnimate && !isSamePose) {
            playMorph(state, slot, delay);
        } else {
            renderFrame(state, FRAME_COUNT - 1);
        }
    } catch (error) {
        if (slot.dataset.renderToken !== token) return;
        console.error('Could not prepare SVG morph:', error);
        slot.replaceChildren(createFallbackSVG(targetCharacter));
        slot.classList.add('has-error');
        slot.title = error.message;
    } finally {
        if (slot.dataset.renderToken === token) {
            slot.classList.remove('is-loading');
        }
    }
}

// Kept public so non-editor screens can show the exact same sign-card preview.
window.FinglyphGlyphMorph = {
    getWordCardMetrics(availableWidth) {
        return calculateWordCardMetrics(availableWidth);
    },

    sizeWordCard(card, availableWidth) {
        return applyWordCardMetrics(card, availableWidth);
    },

    renderTransition(container, sourceCharacter, targetCharacter, { animate = true, delay = 0 } = {}) {
        const source = String(sourceCharacter || '').toUpperCase();
        const target = String(targetCharacter || '').toUpperCase();

        if (!container || !staging || !/^[A-Z]$/.test(source) || !/^[A-Z]$/.test(target)) {
            return false;
        }

        const record = createGlyphRecord(target, source);
        container.replaceChildren(record.slot);
        hydrateGlyph(record.slot, source, target, animate, delay);
        return true;
    },

    renderWord(container, word, { animate = true, glyphSize } = {}) {
        if (!container || !staging) return;

        const characters = [...filterWord(String(word || ''))];
        const wordContainer = document.createElement('div');
        wordContainer.className = 'word-container';
        wordContainer.setAttribute('role', 'img');
        wordContainer.setAttribute('aria-label', `${word} hand-sign card`);
        applyWordCardMetrics(wordContainer, container.clientWidth);
        if (glyphSize != null) wordContainer.style.setProperty('--glyph-size', `${glyphSize}px`);

        const records = characters.map((character, index) => {
            const sourceCharacter = index > 0 ? characters[index - 1] : FIST_LETTER;
            const record = createGlyphRecord(character, sourceCharacter);
            wordContainer.appendChild(record.slot);
            return record;
        });

        container.replaceChildren(wordContainer);

        records.forEach((record, index) => {
            hydrateGlyph(
                record.slot,
                record.sourceCharacter,
                record.character,
                animate,
                index * PASTE_STAGGER,
            );
        });
    },
};

function createGlyphRecord(character, sourceCharacter) {
    const slot = document.createElement('span');
    slot.className = 'glyph-slot';
    slot.dataset.letter = character.toUpperCase();
    slot.dataset.sourceLetter = sourceCharacter.toUpperCase();
    return { character, sourceCharacter, slot };
}

function disposeRecord(record) {
    clearSlotTimer(record.slot);
    record.slot.dataset.renderToken = nextId('disposed');
}

function filterWord(word) {
    return word.replace(/[^a-zA-Z~!@&?.,]/g, '');
}

function parseWords(inputValue) {
    return inputValue
        .split(/\s+/)
        .map(filterWord)
        .filter(Boolean);
}

function flattenWords(words) {
    return words.flatMap(word => [...word]);
}

function calculateWordCardMetrics(availableWidth) {
    const viewportWidth = window.innerWidth;
    const referenceGapWidth = (CARD_SIZE.referenceGlyphCount - 1) * CARD_SIZE.gap;
    // Five glyphs, four gaps, and both side paddings make up 22.6vw.
    const glyphSize = Math.max(1, (
        viewportWidth * CARD_SIZE.referenceCardWidthRatio - referenceGapWidth
    ) / (CARD_SIZE.referenceGlyphCount + 2 * CARD_SIZE.horizontalPaddingRatio));
    const maxCardWidth = Math.floor(Math.min(
        availableWidth,
        viewportWidth * CARD_SIZE.viewportWidthRatio,
    ));

    return {
        maxCardWidth,
        glyphSize,
        gap: CARD_SIZE.gap,
    };
}

function applyWordCardMetrics(card, availableWidth) {
    if (!card) return;
    const metrics = calculateWordCardMetrics(availableWidth);
    card.style.setProperty('--glyph-size', `${metrics.glyphSize}px`);
    card.style.setProperty('--card-glyph-gap', `${metrics.gap}px`);
    card.style.setProperty('--card-max-width', `${metrics.maxCardWidth}px`);
    return metrics;
}

function updateCardSizing(words) {
    const output = document.getElementById('output');
    if (!output || !words.length) return;

    const availableWidth = output.clientWidth;
    words.forEach((_, index) => {
        const wordContainer = output.children[index];
        applyWordCardMetrics(wordContainer, availableWidth);
    });
}

function showPlaceholder(output) {
    const placeholder = document.createElement('span');
    placeholder.className = 'output-placeholder';
    placeholder.textContent = 'Type anything...';
    output.replaceChildren(placeholder);
}

function reconcileOutput(words, animateNew) {
    const output = document.getElementById('output');
    currentWords = words;
    const characters = flattenWords(words);
    const oldCharacters = renderedRecords.map(record => record.character);
    const nextRecords = new Array(characters.length);
    const pending = [];

    let prefixLength = 0;
    while (
        prefixLength < characters.length
        && prefixLength < oldCharacters.length
        && characters[prefixLength] === oldCharacters[prefixLength]
    ) {
        nextRecords[prefixLength] = renderedRecords[prefixLength];
        prefixLength += 1;
    }

    let suffixLength = 0;
    while (
        suffixLength < characters.length - prefixLength
        && suffixLength < oldCharacters.length - prefixLength
        && characters[characters.length - 1 - suffixLength]
            === oldCharacters[oldCharacters.length - 1 - suffixLength]
    ) {
        nextRecords[characters.length - 1 - suffixLength]
            = renderedRecords[oldCharacters.length - 1 - suffixLength];
        suffixLength += 1;
    }

    const reusedSlots = new Set(nextRecords.filter(Boolean).map(record => record.slot));
    renderedRecords.forEach(record => {
        if (!reusedSlots.has(record.slot)) disposeRecord(record);
    });

    for (let index = prefixLength; index < characters.length - suffixLength; index += 1) {
        const sourceCharacter = index > 0 ? characters[index - 1] : FIST_LETTER;
        const record = createGlyphRecord(characters[index], sourceCharacter);
        nextRecords[index] = record;
        pending.push(record);
    }

    renderedRecords = nextRecords;

    if (!characters.length) {
        showPlaceholder(output);
        return;
    }

    const fragment = document.createDocumentFragment();
    let recordIndex = 0;

    words.forEach(word => {
        const wordContainer = document.createElement('div');
        wordContainer.className = 'word-container';
        wordContainer.setAttribute('role', 'listitem');
        wordContainer.setAttribute('aria-label', word);

        for (const character of word) {
            wordContainer.appendChild(nextRecords[recordIndex].slot);
            recordIndex += 1;
        }

        fragment.appendChild(wordContainer);
    });

    output.replaceChildren(fragment);
    updateCardSizing(words);

    pending.forEach((record, index) => {
        hydrateGlyph(
            record.slot,
            record.sourceCharacter,
            record.character,
            animateNew,
            index * PASTE_STAGGER,
        );
    });

    requestAnimationFrame(() => {
        updateCardSizing(currentWords);
        const lastWord = output.lastElementChild;
        if (lastWord) lastWord.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
}

function handleInput(event) {
    const words = parseWords(event.currentTarget.value);
    reconcileOutput(words, true);
}

window.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('textInput');
    staging = document.getElementById('morph-staging');

    if (!staging) return;
    if (!input || !document.getElementById('output')) return;

    input.value = DEFAULT_WORDS.join(' ');
    reconcileOutput(DEFAULT_WORDS, true);

    // The fist is used only when there is no previous character yet.
    loadSvgTemplate(FIST_LETTER).catch(() => {});

    input.addEventListener('input', handleInput);
    window.addEventListener('resize', () => updateCardSizing(currentWords));
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault(); 

            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? input.value.length;
            const value = input.value;

            // Insert a space at the cursor position.
            input.value = value.slice(0, start) + ' ' + value.slice(end);

            // Move the cursor after the inserted space.
            input.selectionStart = input.selectionEnd = start + 1;

            // Dispatch input so reconcileOutput() updates the output.
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
});







// ===== Automatically resize the input field =====
const textInput = document.getElementById('textInput');

function resizeInputToContent(input) {
    const minimumText = 'mmmmmmmmmmmm';
    const maxWidth = 500;
    const padding = 32; 
    
    const temp = document.createElement('span');
    const style = getComputedStyle(input);
    
    temp.style.cssText = `
        font-size: ${style.fontSize};
        font-family: ${style.fontFamily};
        font-weight: ${style.fontWeight};
        letter-spacing: ${style.letterSpacing};
        visibility: hidden;
        position: absolute;
        white-space: pre;
        padding: 0;
    `;
    
    document.body.appendChild(temp);

    temp.textContent = minimumText;
    const minWidth = temp.offsetWidth + padding;
    // Measure the placeholder when the input is empty.
    temp.textContent = input.value || input.placeholder;
    
    let newWidth = temp.offsetWidth + padding;
    document.body.removeChild(temp);
    
    // Keep the width within the minimum and maximum limits.
    newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
    input.style.width = newWidth + 'px';
}

window.FinglyphResizeInputToContent = resizeInputToContent;

function resizeInput() {
    resizeInputToContent(textInput);
}

// Resize whenever the value changes.
if (textInput) {
    textInput.addEventListener('input', resizeInput);

    // Resize once when the page loads.
    window.addEventListener('DOMContentLoaded', resizeInput);
    document.fonts?.ready.then(resizeInput);
}



(function initWebcam() {
    // Webcam ownership is handled by webcam-basic.js.
    return;
    const video = document.getElementById('webcam');
    if (!video) return;

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
            .then(stream => {
                video.srcObject = stream;
            })
            .catch(err => {
                console.warn('Could not access webcam:', err);
            });
    }
})();

// Webcam input uses this bridge so candidate poses reuse the same SVG morph
// pipeline as keyboard-entered letters.
let cameraPreviewLetter = null;

window.FinglyphCameraInput = {
    showCandidate(character) {
        const letter = String(character || '').toUpperCase();
        const slot = document.getElementById('camera-glyph');

        if (!/^[A-Z]$/.test(letter) || !slot || letter === cameraPreviewLetter) {
            return;
        }

        const sourceLetter = cameraPreviewLetter || FIST_LETTER;
        cameraPreviewLetter = letter;
        hydrateGlyph(slot, sourceLetter, letter, true);
    },

    commitLetter(character) {
        const letter = String(character || '').toUpperCase();
        const input = document.getElementById('textInput');

        if (!/^[A-Z]$/.test(letter) || !input) return;

        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, start) + letter.toLowerCase() + input.value.slice(end);
        input.selectionStart = input.selectionEnd = start + 1;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus({ preventScroll: true });
    },
};
