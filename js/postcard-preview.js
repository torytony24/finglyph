const postcardButton = document.querySelector('.download-button');
const postcardDialog = document.getElementById('postcard-preview-dialog');
const postcardCanvas = document.getElementById('postcard-preview-canvas');
const postcardDebugDownload = document.getElementById('postcard-debug-download');
const postcardContext = postcardCanvas.getContext('2d');
const signImageCache = new Map();
let renderVersion = 0;

const CARD_HEIGHT = 155.83;
const CARD_MAX_WIDTH = 1600;
const CAPTION_FONT_SIZE = 30;
const WORD_GAP = 24;
const MULTI_WORD_LEFT_MARGIN = 142;
const MULTI_WORD_ROW_GAP = 40;
const TWO_WORD_BOTTOM_MARGIN = 109;
const MULTI_WORD_TEXT_TOP = 121;
const SINGLE_WORD_CARD_TOP = 522;
const SINGLE_WORD_CAPTION_TOP = 1069;
const TALL_CARD_TOP = 121;
const TALL_CARD_TEXT_GAP = 12;
const TALL_CAPTION_BOTTOM = 98;
const TALL_WORDS_PER_LINE = 8;
const TALL_LINE_HEIGHT = CAPTION_FONT_SIZE * 2;

function getTallLayout(wordCount) {
    const cardGroupHeight = wordCount * CARD_HEIGHT + (wordCount - 1) * MULTI_WORD_ROW_GAP;
    const cardsBottom = TALL_CARD_TOP + cardGroupHeight;
    const lineCount = Math.ceil(wordCount / TALL_WORDS_PER_LINE);
    const captionHeight = CAPTION_FONT_SIZE + (lineCount - 1) * TALL_LINE_HEIGHT;
    const baseCaptionY = 1200 - TALL_CAPTION_BOTTOM - captionHeight;
    const needsExtendedCanvas = cardsBottom + captionHeight + TALL_CAPTION_BOTTOM > 1200;
    const captionY = needsExtendedCanvas ? cardsBottom + TALL_CARD_TEXT_GAP : baseCaptionY;
    const height = Math.ceil(Math.max(1200, captionY + captionHeight + TALL_CAPTION_BOTTOM));
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
                postcardContext.font = `150 ${displayGlyphSize * 0.38}px Raleway, Arial, sans-serif`;
                postcardContext.textAlign = 'center';
                postcardContext.textBaseline = 'middle';
                postcardContext.fillText(letters[index].toUpperCase(), glyphX + displayGlyphSize / 2, glyphY + displayGlyphSize / 2);
            }
        });
    }

}

function drawWordLine(words, y, { align = 'center', x = postcardCanvas.width / 2, maxWidth = CARD_MAX_WIDTH } = {}) {
    const titles = words.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    postcardContext.fillStyle = '#1f1f1f';
    postcardContext.font = `100 ${CAPTION_FONT_SIZE}px Raleway, Arial, Helvetica, sans-serif`;
    postcardContext.textAlign = 'left';
    postcardContext.textBaseline = 'top';
    const wordWidths = titles.map(title => postcardContext.measureText(title).width);
    const totalTextWidth = wordWidths.reduce((sum, width) => sum + width, 0);
    const gapsWidth = WORD_GAP * Math.max(0, titles.length - 1);
    const textScale = Math.min(1, Math.max(0, maxWidth - gapsWidth) / totalTextWidth);
    const lineWidth = totalTextWidth * textScale + gapsWidth;
    let wordX = align === 'center' ? x - lineWidth / 2 : x;

    titles.forEach((title, index) => {
        postcardContext.fillText(title, wordX, y, wordWidths[index] * textScale);
        wordX += wordWidths[index] * textScale + WORD_GAP;
    });
}

function drawCaption(words, y) {
    drawWordLine(words, y);
    const title = words.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
    postcardCanvas.setAttribute('aria-label', `${title} postcard preview`);
}

function drawTallCaption(words, y) {
    const titles = words.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

    for (let index = 0; index < titles.length; index += TALL_WORDS_PER_LINE) {
        drawWordLine(
            words.slice(index, index + TALL_WORDS_PER_LINE),
            y + (index / TALL_WORDS_PER_LINE) * TALL_LINE_HEIGHT,
            {
                align: 'left',
                x: MULTI_WORD_LEFT_MARGIN,
                maxWidth: postcardCanvas.width - MULTI_WORD_LEFT_MARGIN * 2,
            },
        );
    }

    postcardCanvas.setAttribute('aria-label', `${titles.join(' ')} postcard preview`);
}

function drawPostcardContent(words, imageGroups = null) {
    if (!postcardContext) return;
    drawBlankPostcard();

    if (words.length === 1) {
        drawWordCard(words[0], {
            x: 'center', y: SINGLE_WORD_CARD_TOP, maxWidth: CARD_MAX_WIDTH, images: imageGroups?.[0],
        });
        drawCaption(words, SINGLE_WORD_CAPTION_TOP);
    } else if (words.length >= 2 && words.length <= 3) {
        const maxWidth = postcardCanvas.width - MULTI_WORD_LEFT_MARGIN * 2;
        const cardGroupHeight = words.length * CARD_HEIGHT + (words.length - 1) * MULTI_WORD_ROW_GAP;
        const firstCardY = postcardCanvas.height - TWO_WORD_BOTTOM_MARGIN - cardGroupHeight;

        words.forEach((word, index) => {
            drawWordCard(word, {
                x: MULTI_WORD_LEFT_MARGIN,
                y: firstCardY + index * (CARD_HEIGHT + MULTI_WORD_ROW_GAP),
                maxWidth,
                images: imageGroups?.[index],
            });
        });
        drawCaption(words, MULTI_WORD_TEXT_TOP);
    } else if (words.length === 4) {
        const maxWidth = postcardCanvas.width - MULTI_WORD_LEFT_MARGIN * 2;
        words.forEach((word, index) => {
            drawWordCard(word, {
                x: MULTI_WORD_LEFT_MARGIN,
                y: TALL_CARD_TOP + index * (CARD_HEIGHT + MULTI_WORD_ROW_GAP),
                maxWidth,
                images: imageGroups?.[index],
            });
        });
        drawTallCaption(words, getTallLayout(words.length).captionY);
    } else if (words.length >= 5) {
        const maxWidth = postcardCanvas.width - MULTI_WORD_LEFT_MARGIN * 2;
        words.forEach((word, index) => {
            drawWordCard(word, {
                x: MULTI_WORD_LEFT_MARGIN,
                y: TALL_CARD_TOP + index * (CARD_HEIGHT + MULTI_WORD_ROW_GAP),
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
    await document.fonts.load(`100 ${CAPTION_FONT_SIZE}px Raleway`);
    const wordCards = document.querySelectorAll('#output .word-container');
    const validWords = [...wordCards]
        .map(card => (card.getAttribute('aria-label') || '').replace(/[^a-zA-Z]/g, ''))
        .filter(Boolean);
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
