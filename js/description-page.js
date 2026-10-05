const signGrid = document.querySelector('.description-page .sign-grid');
const description = document.querySelector('.description-page .sign-description');
const content = document.querySelector('.description-page .info-content');
const header = document.querySelector('.description-page .top-fixed');

if (signGrid && description && content && header) {
    let activeSign = null;

    function choosePosition(preferred, alternative, min, max) {
        if (preferred >= min && preferred <= max) return preferred;
        if (alternative >= min && alternative <= max) return alternative;
        return Math.max(min, Math.min(preferred, max));
    }

    function positionDescription() {
        if (!activeSign) return;

        const sign = activeSign.getBoundingClientRect();
        const width = description.offsetWidth;
        const height = description.offsetHeight;
        const gap = 8;
        const edge = 16;
        const minTop = header.getBoundingClientRect().bottom + edge;
        const maxTop = window.innerHeight - height - edge;
        const isUpperHalf = sign.top + sign.height / 2 < window.innerHeight / 2;
        const isLeftHalf = sign.left + sign.width / 2 < window.innerWidth / 2;
        const preferRight = isUpperHalf ? isLeftHalf : !isLeftHalf;
        const inset = isUpperHalf ? 0 : sign.width * 0.12;
        const right = sign.right + gap - inset;
        const leftSide = sign.left - width - gap + inset;
        const preferredLeft = preferRight ? right : leftSide;
        const alternativeLeft = preferRight ? leftSide : right;
        const below = sign.bottom + gap;
        const above = sign.top + sign.height * 0.25 - height;
        const preferredTop = isUpperHalf ? below : above;
        const alternativeTop = isUpperHalf ? above : below;
        const left = choosePosition(preferredLeft, alternativeLeft, edge, window.innerWidth - width - edge);
        const top = choosePosition(preferredTop, alternativeTop, minTop, maxTop);

        description.style.top = `${top}px`;
        description.style.left = `${left}px`;
        description.style.textAlign = left + width / 2 < sign.left + sign.width / 2 ? 'right' : 'left';
    }

    function hideDescription(sign) {
        if (activeSign !== sign) return;
        activeSign = null;
        description.hidden = true;
        description.textContent = '';
    }

    for (const sign of signGrid.children) {
        sign.addEventListener('mouseenter', () => {
            if (!matchMedia('(hover: hover)').matches) return;
            activeSign = sign;
            description.textContent = sign.dataset.description;
            description.hidden = false;
            positionDescription();
        });
        sign.addEventListener('mouseleave', () => hideDescription(sign));
    }

    content.addEventListener('scroll', () => {
        if (!activeSign) return;
        if (activeSign.matches(':hover')) positionDescription();
        else hideDescription(activeSign);
    }, { passive: true });
    window.addEventListener('resize', positionDescription);
    window.addEventListener('blur', () => {
        if (activeSign) hideDescription(activeSign);
    });
    document.fonts?.ready.then(positionDescription);
}
