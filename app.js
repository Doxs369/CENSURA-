const setupScreen = document.getElementById('setup-screen');
const cameraScreen = document.getElementById('camera-screen');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusText = document.getElementById('status-text');
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const ipInput = document.getElementById('ip-input');
const ipContainer = document.getElementById('ip-container');

let ws;
let isStreaming = false;
let streamInterval = null;

window.onload = async () => {
    try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        statusText.innerText = "Permesso concesso!";
        statusText.style.color = "green";
    } catch (err) {
        statusText.innerText = "Permesso NEGATO.";
        statusText.style.color = "red";
        return;
    }

    const savedIp = localStorage.getItem('multyeye_pc_ip');
    if (savedIp) {
        connectToPC(savedIp);
    } else {
        ipContainer.style.display = 'block';
        statusText.innerText = "Inserisci l'IP del PC.";
    }
};

function connectToPC(pcIp) {
    if (ws) ws.close();
    localStorage.setItem('multyeye_pc_ip', pcIp);
    statusText.innerText = `Connessione a ${pcIp}...`;
    ws = new WebSocket(`ws://${pcIp}:8765`);
    
    ws.onopen = () => {
        statusText.innerText = "Connesso! Avvio streaming...";
        statusText.style.color = "green";
        startCamera();
    };
    
    ws.onerror = () => {
        statusText.innerText = "Errore. Controlla l'IP e il Firewall.";
        statusText.style.color = "red";
        localStorage.removeItem('multyeye_pc_ip');
        ipContainer.style.display = 'block';
    };
    
    ws.onclose = () => { stopCamera(); };
}

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
        videoElement.srcObject = stream;
        setupScreen.style.display = 'none';
        cameraScreen.style.display = 'block';
        canvasElement.width = 640;
        canvasElement.height = 480;

        // Mostra anteprima sul telefono
        const drawPreview = () => {
            if (!isStreaming) return;
            canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
            requestAnimationFrame(drawPreview);
        };
        isStreaming = true;
        drawPreview();

        // Invia frame al PC a 15 FPS (bilanciamento tra fluidità e banda)
        streamInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN && isStreaming) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = 320; // Risoluzione ridotta per la rete
                tempCanvas.height = 240;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(videoElement, 0, 0, 320, 240);
                const base64Frame = tempCanvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                
                ws.send(JSON.stringify({
                    action: "video_frame",
                    frame: base64Frame
                }));
            }
        }, 66); // 1000ms / 15fps

    } catch (err) { alert("Errore fotocamera: " + err.message); }
}

function stopCamera() {
    isStreaming = false;
    if (streamInterval) clearInterval(streamInterval);
    if (videoElement.srcObject) videoElement.srcObject.getTracks().forEach(t => t.stop());
    setupScreen.style.display = 'block';
    cameraScreen.style.display = 'none';
}

startBtn.addEventListener('click', () => {
    const ip = ipInput.value.trim();
    if (ip) connectToPC(ip);
    else alert("Inserisci l'IP del PC.");
});

stopBtn.addEventListener('click', () => { if (ws) ws.close(); });