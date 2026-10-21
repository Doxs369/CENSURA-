const setupScreen = document.getElementById('setup-screen');
const cameraScreen = document.getElementById('camera-screen');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusText = document.getElementById('status-text');
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const modeText = document.getElementById('current-mode');
const ipInput = document.getElementById('ip-input');
const ipContainer = document.getElementById('ip-container');

let ws;
let isTracking = false;
let lastEyeSent = 0;
let lastHandSent = 0;
let isHandActive = false;
let lastPinchState = false;

// --- ALL'AVVIO: CHIEDIAMO LA FOTOCAMERA ---
window.onload = async () => {
    try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        statusText.innerText = "Permesso fotocamera concesso!";
        statusText.style.color = "green";
    } catch (err) {
        statusText.innerText = "Permesso fotocamera NEGATO. Ricarica e consenti.";
        statusText.style.color = "red";
        return;
    }

    // Controlla se abbiamo già salvato un IP in passato (nella memoria del browser)
    const savedIp = localStorage.getItem('multyeye_pc_ip');
    if (savedIp) {
        statusText.innerText = `Trovato IP salvato (${savedIp}). Connessione in corso...`;
        connectToPC(savedIp);
    } else {
        ipContainer.style.display = 'block';
        statusText.innerText = "Inserisci l'IP mostrato sul programma del PC.";
    }
};

// --- CONNESSIONE AL PC ---
function connectToPC(pcIp) {
    if (ws) ws.close();
    
    // Salviamo l'IP nella memoria del telefono per la prossima volta
    localStorage.setItem('multyeye_pc_ip', pcIp);
    
    statusText.innerText = `Connessione a ${pcIp}...`;
    ws = new WebSocket(`ws://${pcIp}:8765`);
    
    ws.onopen = () => {
        statusText.innerText = "Connesso! Avvio fotocamera...";
        statusText.style.color = "green";
        startCamera();
    };
    
    ws.onerror = () => {
        statusText.innerText = "Errore. Controlla l'IP, il WiFi e il Firewall del PC.";
        statusText.style.color = "red";
        localStorage.removeItem('multyeye_pc_ip'); // Se fallisce, cancella l'IP errato
        ipContainer.style.display = 'block';
    };
    
    ws.onclose = () => {
        statusText.innerText = "Disconnesso";
        statusText.style.color = "red";
        stopCamera();
    };
}

function sendCommand(data) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// --- IA MEDIAPIPE ---
const faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true });
faceMesh.onResults(onFaceResults);

const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 1 });
hands.onResults(onHandsResults);

function onFaceResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0 && !isHandActive) {
        const l = results.multiFaceLandmarks[0];
        const gx = (l[468].x + l[473].x) / 2;
        const gy = (l[468].y + l[473].y) / 2;
        
        canvasCtx.fillStyle = '#FF0000';
        canvasCtx.beginPath();
        canvasCtx.arc(gx * canvasElement.width, gy * canvasElement.height, 10, 0, 2 * Math.PI);
        canvasCtx.fill();

        const now = Date.now();
        if (now - lastEyeSent > 33) { sendCommand({ action: "move_eyes", x: 1.0 - gx, y: gy }); lastEyeSent = now; }
    }
    canvasCtx.restore();
}

function onHandsResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const l = results.multiHandLandmarks[0];
        const dist = Math.hypot(l[8].x - l[4].x, l[8].y - l[4].y);
        const isPinch = dist < 0.05;
        const isPalmOpen = (l[8].y < l[5].y) && (l[12].y < l[9].y);

        if (isPalmOpen) { if (!isHandActive) { isHandActive = true; modeText.innerText = "Modalità: Mano"; } }
        else if (!isPinch) { if (isHandActive) { isHandActive = false; modeText.innerText = "Modalità: Occhi"; } }

        const now = Date.now();
        if (isHandActive && now - lastHandSent > 33) { sendCommand({ action: "move_hand", dx: (1.0 - l[8].x) - 0.5, dy: l[8].y - 0.5 }); lastHandSent = now; }
        if (isPinch && !lastPinchState) sendCommand({ action: "click_left" });
        lastPinchState = isPinch;
    }
}

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
        videoElement.srcObject = stream;
        setupScreen.style.display = 'none';
        cameraScreen.style.display = 'block';
        canvasElement.width = 640;
        canvasElement.height = 480;

        const processFrame = async () => {
            if (!isTracking) return;
            await faceMesh.send({image: videoElement});
            await hands.send({image: videoElement});
            requestAnimationFrame(processFrame);
        };
        isTracking = true;
        videoElement.onloadedmetadata = () => { processFrame(); };
    } catch (err) { alert("Errore fotocamera: " + err.message); }
}

function stopCamera() {
    isTracking = false;
    if (videoElement.srcObject) videoElement.srcObject.getTracks().forEach(t => t.stop());
    setupScreen.style.display = 'block';
    cameraScreen.style.display = 'none';
}

// --- BOTTONE MANUALE ---
startBtn.addEventListener('click', () => {
    const ip = ipInput.value.trim();
    if (ip) connectToPC(ip);
    else alert("Inserisci l'IP del PC.");
});

stopBtn.addEventListener('click', () => { if (ws) ws.close(); });