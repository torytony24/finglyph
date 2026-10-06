const CACHE_NAME = 'finglyph-hand-landmarker-v1';

// Keep the versioned hand model available after navigating away from start_page.
export async function loadHandLandmarkerModel(url) {
    let cache;
    if ('caches' in globalThis) {
        try {
            cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(url);
            if (cached) return new Uint8Array(await cached.arrayBuffer());
        } catch (error) {
            console.warn('Hand model cache unavailable:', error);
            cache = undefined;
        }
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load hand model: ${response.status}.`);
    if (cache) {
        try { await cache.put(url, response.clone()); }
        catch (error) { console.warn('Could not save hand model:', error); }
    }
    return new Uint8Array(await response.arrayBuffer());
}
