import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const accessScript = readFileSync(new URL('../js/mobile-access.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const indexRedirect = indexHtml.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];

function visitIndex(navigator, viewportWidth) {
    const classes = new Set();
    let redirectedTo;
    const document = {
        documentElement: {
            classList: {
                add: (name) => classes.add(name),
                contains: (name) => classes.has(name),
            },
        },
    };
    const window = { location: { replace: (url) => { redirectedTo = url; } }, innerWidth: viewportWidth };

    runInNewContext(accessScript, { navigator, document, window });
    runInNewContext(indexRedirect, { navigator, document, window });
    return { blocked: classes.has('is-mobile-device'), redirectedTo };
}

test('a resized desktop and a touch enabled Windows laptop still enter the start page', () => {
    const windows = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36',
        platform: 'Win32',
        maxTouchPoints: 10,
        userAgentData: { mobile: false, platform: 'Windows' },
    };

    for (const width of [320, 500, 1200]) {
        assert.deepEqual(visitIndex(windows, width), {
            blocked: false,
            redirectedTo: 'start_page.html',
        });
    }
});

test('phones and tablets remain blocked regardless of viewport width', () => {
    const devices = [
        { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel) Mobile Safari/537.36', userAgentData: { mobile: true, platform: 'Android' } },
        { userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet) Safari/537.36', userAgentData: { mobile: false, platform: 'Android' } },
        { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari/604.1' },
        { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 },
    ];

    for (const device of devices) {
        for (const width of [500, 1200]) {
            assert.deepEqual(visitIndex(device, width), {
                blocked: true,
                redirectedTo: undefined,
            });
        }
    }
});
