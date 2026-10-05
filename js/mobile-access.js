(function () {
    const clientHints = navigator.userAgentData;
    const userAgent = navigator.userAgent || '';

    // iPadOS Safari can present the same user agent as macOS Safari.
    const isDesktopModeIPad = navigator.platform === 'MacIntel'
        && navigator.maxTouchPoints > 1;
    const isMobileDevice = clientHints?.mobile === true
        || clientHints?.platform === 'Android'
        || /Mobi|Android|iPhone|iPad|iPod|Windows Phone|IEMobile|Opera Mini|BlackBerry|webOS/i.test(userAgent)
        || isDesktopModeIPad;

    if (isMobileDevice) {
        document.documentElement.classList.add('is-mobile-device');
    }
}());
