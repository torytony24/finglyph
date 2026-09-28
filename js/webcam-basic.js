(() => {
    let stream = null;

    function setStatus(message) {
        document.getElementById('camera-status').textContent = message;
    }

    function clearOverlay() {
        const canvas = document.getElementById('hand-overlay');
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
    }

    async function startCamera() {
        const video = document.getElementById('webcam');
        const button = document.getElementById('camera-toggle');

        if (!navigator.mediaDevices?.getUserMedia) {
            setStatus('This browser does not support webcam access.');
            return;
        }

        button.disabled = true;
        button.textContent = 'Opening...';
        setStatus('Requesting camera permission.');

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: 'user' },
            });
            video.srcObject = stream;
            await video.play();
            button.textContent = 'Stop camera';
            setStatus('Camera is on. Loading hand recognition.');
            window.dispatchEvent(new CustomEvent('finglyph:camera-started', {
                detail: { video },
            }));
        } catch (error) {
            console.error('Could not start webcam:', error);
            const message = error.name === 'NotAllowedError'
                ? 'Camera permission was denied. Allow it in the browser settings.'
                : 'Could not start the camera. Check that no other app is using it.';
            setStatus(message);
            button.textContent = 'Try again';
        } finally {
            button.disabled = false;
        }
    }

    function stopCamera() {
        const video = document.getElementById('webcam');
        const button = document.getElementById('camera-toggle');

        stream?.getTracks().forEach(track => track.stop());
        stream = null;
        video.srcObject = null;
        clearOverlay();
        window.dispatchEvent(new Event('finglyph:camera-stopped'));
        button.textContent = 'Start camera';
        setStatus('Camera is off.');
    }

    window.addEventListener('DOMContentLoaded', () => {
        const button = document.getElementById('camera-toggle');
        button.addEventListener('click', () => {
            if (stream?.active) stopCamera();
            else startCamera();
        });
    });
})();
