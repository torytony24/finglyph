let navigationTimer;

document.addEventListener('click', (event) => {
    const link = event.target.closest('.top-right-buttons .nav-btn');
    if (!link || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
        link.target || link.hasAttribute('download') ||
        link.href === window.location.href) {
        return;
    }

    event.preventDefault();
    clearTimeout(navigationTimer);

    const menu = link.closest('.top-right-buttons');
    const links = [...menu.querySelectorAll('.nav-btn')];
    links.forEach((item) => item.removeAttribute('data-selected'));
    link.setAttribute('data-selected', '');
    menu.setAttribute('data-navigating', '');
    menu.querySelector('.nav-indicator').style.left = `${links.indexOf(link) * 100 / links.length}%`;

    navigationTimer = window.setTimeout(() => {
        window.location.assign(link.href);
    }, 350);
});
