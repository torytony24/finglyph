const postcardButton = document.querySelector('.download-button');
const postcardDialog = document.getElementById('postcard-preview-dialog');
const postcardCanvas = document.getElementById('postcard-preview-canvas');
const postcardDebugDownload = document.getElementById('postcard-debug-download');
const postcardContext = postcardCanvas.getContext('2d');
const signImageCache = new Map();
let renderVersion = 0;

const CARD_HEIGHT = 160;
const CARD_MAX_WIDTH = 1600;
const TEXT_GAP = 60;
const CAPTION_FONT_SIZE = 30;
const MULTI_WORD_LEFT_MARGIN = 84;
const MULTI_WORD_ROW_GAP = 40;
const TWO_WORD_BOTTOM_MARGIN = 130;
const MULTI_WORD_TEXT_TOP = 105;
const TALL_WORDS_PER_LINE = 8;
const TALL_LINE_HEIGHT = CAPTION_FONT_SIZE * 2;

function getTallLayout(wordCount) {
    const cardGroupHeight = wordCount * CARD_HEIGHT + (wordCount - 1) * MULTI_WORD_ROW_GAP;
    const captionY = MULTI_WORD_LEFT_MARGIN + cardGroupHeight + CARD_HEIGHT;
    const lineCount = Math.ceil(wordCount / TALL_WORDS_PER_LINE);
    const height = captionY + CAPTION_FONT_SIZE + (lineCount - 1) * TALL_LINE_HEIGHT + MULTI_WORD_TEXT_TOP;
    return { captionY, height };
}

function updatePreviewSize() {
    const availableWidth = Math.max(1, window.innerWidth - 2 * (136 + 16 + 16));
    const availableHeight = Math.max(1, window.innerHeight - 96);
    const previewHeight = Math.min(availableHeight, 820 * 1200 / postcardCanvas.width);
    const fittingWidth = previewHeight * postcardCanvas.width / postcardCanvas.height;
    postcardDialog.style.width = `${Math.min(820, availableWidth, fittingWidth)}px`;
}

function drawBlankPostcard() {
    if (!postcardContext) return;
    postcardContext.fillStyle = '#fff';
    postcardContext.fillRect(0, 0, postcardCanvas.width, postcardCanvas.height);
    postcardCanvas.setAttribute('aria-label', 'Blank white postcard');
}

function loadSignImage(character) {
    const letter = character.toUpperCase();
    if (!/^[A-Z]$/.test(letter)) return Promise.resolve(null);

    if (!signImageCache.has(letter)) {
        const image = new Image();
        const loaded = new Promise(resolve => {
            image.onload = () => resolve(image);
            image.onerror = () => resolve(null);
        });
        image.src = `assets/signs/${letter}.svg`;
        signImageCache.set(letter, loaded);
    }

    return signImageCache.get(letter);
}

function drawWordCard(word, { x, y, maxWidth, images = null }) {
    const letters = [...word];
    const glyphSize = CARD_HEIGHT / 1.34;
    const sidePadding = glyphSize * 0.21;
    const naturalGap = glyphSize * 0.1;
    const naturalContentWidth = letters.length * glyphSize +
        Math.max(0, letters.length - 1) * naturalGap;
    const contentScale = Math.min(1, (maxWidth - sidePadding * 2) / naturalContentWidth);
    const displayGlyphSize = glyphSize * contentScale;
    const displayGap = naturalGap * contentScale;
    const cardWidth = sidePadding * 2 + letters.length * displayGlyphSize +
        Math.max(0, letters.length - 1) * displayGap;
    const cardX = x === 'center' ? (postcardCanvas.width - cardWidth) / 2 : x;
    const glyphY = y + (CARD_HEIGHT - displayGlyphSize) / 2;

    postcardContext.fillStyle = '#00ff19';
    postcardContext.fillRect(cardX, y, cardWidth, CARD_HEIGHT);

    if (images) {
        images.forEach((image, index) => {
            const glyphX = cardX + sidePadding + index * (displayGlyphSize + displayGap);
            if (image) {
                postcardContext.drawImage(image, glyphX, glyphY, displayGlyphSize, displayGlyphSize);
            } else {
                postcardContext.fillStyle = '#e9fea3';
                postcardContext.fillRect(glyphX, glyphY, displayGlyphSize, displayGlyphSize);
                postcardContext.fillStyle = '#2c6239';
                postcardContext.font = `500 ${displayGlyphSize * 0.38}px Inter, Arial, sans-serif`;
                postcardContext.textAlign = 'center';
                postcardContext.textBaseline = 'middle';
                postcardContext.fillText(letters[index].toUpperCase(), glyphX + displayGlyphSize / 2, glyphY + displayGlyphSize / 2);
            }
        });
    }

}

function drawCaption(words, y, separator = ' ') {
    const title = words.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(separator);
    postcardContext.fillStyle = '#1f1f1f';
    postcardContext.font = `500 ${CAPTION_FONT_SIZE}px Inter, Arial, Helvetica, sans-serif`;
    postcardContext.textAlign = 'center';
    postcardContext.textBaseline = 'top';
    postcardContext.fillText(title, postcardCanvas.width / 2, y, CARD_MAX_WIDTH);
    postcardCanvas.setAttribute('aria-label', `${title} postcard preview`);
}

function drawTallCaption(words, y) {
    const titles = words.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    postcardContext.fillStyle = '#1f1f1f';
    postcardContext.font = `500 ${CAPTION_FONT_SIZE}px Inter, Arial, Helvetica, sans-serif`;
    postcardContext.textAlign = 'left';
    postcardContext.textBaseline = 'top';

    for (let index = 0; index < titles.length; index += TALL_WORDS_PER_LINE) {
        const line = titles.slice(index, index + TALL_WORDS_PER_LINE).join('      ');
        postcardContext.fillText(
            line,
            MULTI_WORD_LEFT_MARGIN,
            y + (index / TALL_WORDS_PER_LINE) * TALL_LINE_HEIGHT,
            postcardCanvas.width - MULTI_WORD_LEFT_MARGIN * 2,
        );
    }

    postcardCanvas.setAttribute('aria-label', `${titles.join(' ')} postcard preview`);
}

function drawPostcardContent(words, imageGroups = null) {
    if (!postcardContext) return;
    drawBlankPostcard();

    if (words.length === 1) {
        const cardY = (postcardCanvas.height - CARD_HEIGHT) / 2;
        drawWordCard(words[0], {
            x: 'center', y: cardY, maxWidth: CARD_MAX_WIDTH, images: imageGroups?.[0],
        });
        drawCaption(words, cardY + CARD_HEIGHT + TEXT_GAP);
    } else if (words.length >= 2 && words.length <= 4) {
        const maxWidth = postcardCanvas.width - MULTI_WORD_LEFT_MARGIN * 2;
        const cardGroupHeight = words.length * CARD_HEIGHT + (words.length - 1) * MULTI_WORD_ROW_GAP;
        const captionBottom = MULTI_WORD_TEXT_TOP + CAPTION_FONT_SIZE;
        const firstCardY = words.length === 2
            ? postcardCanvas.height - TWO_WORD_BOTTOM_MARGIN - cardGroupHeight
            : captionBottom + (postcardCanvas.height - captionBottom - cardGroupHeight) / 2;

        words.forEach((word, index) => {
            drawWordCard(word, {
                x: MULTI_WORD_LEFT_MARGIN,
                y: firstCardY + index * (CARD_HEIGHT + MULTI_WORD_ROW_GAP),
                maxWidth,
                images: imageGroups?.[index],
            });
        });
        drawCaption(words, MULTI_WORD_TEXT_TOP, '      ');
    } else if (words.length >= 5) {
        const maxWidth = postcardCanvas.width - MULTI_WORD_LEFT_MARGIN * 2;
        words.forEach((word, index) => {
            drawWordCard(word, {
                x: MULTI_WORD_LEFT_MARGIN,
                y: MULTI_WORD_LEFT_MARGIN + index * (CARD_HEIGHT + MULTI_WORD_ROW_GAP),
                maxWidth,
                images: imageGroups?.[index],
            });
        });
        drawTallCaption(words, getTallLayout(words.length).captionY);
    }
}

async function renderPostcard() {
    const currentRender = ++renderVersion;
    postcardDebugDownload.disabled = true;
    const wordCards = document.querySelectorAll('#output .word-container');
    const words = [...wordCards].map(card => card.getAttribute('aria-label'));
    const validWords = words.some(word => !word) ? [] : words;
    const height = validWords.length >= 5 ? getTallLayout(validWords.length).height : 1200;
    if (postcardCanvas.height !== height) postcardCanvas.height = height;
    updatePreviewSize();
    drawBlankPostcard();
    if (!validWords.length) {
        postcardDebugDownload.disabled = false;
        return;
    }

    drawPostcardContent(validWords);
    const imageGroups = await Promise.all(validWords.map(word => Promise.all([...word].map(loadSignImage))));
    if (currentRender === renderVersion) {
        drawPostcardContent(validWords, imageGroups);
        postcardDebugDownload.disabled = false;
    }
}

drawBlankPostcard();

postcardButton.addEventListener('click', () => {
    renderPostcard();
    if (!postcardDialog.open) postcardDialog.showModal();
});

postcardDebugDownload.addEventListener('click', () => {
    if (postcardDebugDownload.disabled) return;

    postcardCanvas.toBlob(blob => {
        if (!blob) return;

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'finglyph-postcard.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }, 'image/png');
});

window.addEventListener('resize', updatePreviewSize);

postcardDialog.addEventListener('click', (event) => {
    if (event.target !== postcardDialog) return;

    const bounds = postcardDialog.getBoundingClientRect();
    const clickedOutsideCard = event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom;

    if (clickedOutsideCard) postcardDialog.close();
});
