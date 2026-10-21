// app.js
const setupScreen = document.getElementById('setup-screen');
const cameraScreen = document.getElementById('camera-screen');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusText = document.getElementById('status-text');
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const modeText = document.getElementById('current-mode');

let ws;
let isTracking = false;
let lastEyeSent = 0;
let lastHandSent = 0;
let isHandActive = false;
let lastPinchState = false;

// --- 1. CONNESSIONE AUTOMATICA (Il PC è già quello che ci ha dato la pagina) ---
function connectToPC() {
    // Prendiamo l'IP del PC dall'URL della pagina (es. 192.168.1.50)
    const pcIp = window.location.hostname;
    
    statusText.innerText = `Connessione a ${pcIp}...`;
    statusText.style.color = "#348F86";

    ws = new WebSocket(`ws://${pcIp}:8765`);
    
    ws.onopen = () => {
        statusText.innerText = "Connesso! Avvio fotocamera...";
        statusText.style.color = "green";
        startCamera();
    };
    
    ws.onerror = () => {
        statusText.innerText = "Errore di connessione. Riprova.";
        statusText.style.color = "red";
    };
    
    ws.onclose = () => {
        statusText.innerText = "Disconnesso";
        statusText.style.color = "red";
        stopCamera();
    };
}

function sendCommand(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// --- 2. INTELLIGENZA ARTIFICIALE ---
const faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
faceMesh.onResults(onFaceResults);

const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
hands.onResults(onHandsResults);

function onFaceResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0 && !isHandActive) {
        const landmarks = results.multiFaceLandmarks[0];
        const gazeX = (landmarks[468].x + landmarks[473].x) / 2;
        const gazeY = (landmarks[468].y + landmarks[473].y) / 2;

        canvasCtx.fillStyle = '#FF0000';
        canvasCtx.beginPath();
        canvasCtx.arc(gazeX * canvasElement.width, gazeY * canvasElement.height, 10, 0, 2 * Math.PI);
        canvasCtx.fill();

        const now = Date.now();
        if (now - lastEyeSent > 33) {
            sendCommand({ action: "move_eyes", x: 1.0 - gazeX, y: gazeY });
            lastEyeSent = now;
        }
    }
    canvasCtx.restore();
}

function onHandsResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const distance = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
        const isPinch = distance < 0.05;
        const isPalmOpen = (indexTip.y < landmarks[5].y) && (landmarks[12].y < landmarks[9].y);

        if (isPalmOpen) {
            if (!isHandActive) { isHandActive = true; modeText.innerText = "Modalità: Mano"; modeText.style.color = "#D67B5D"; }
        } else if (!isPinch) {
            if (isHandActive) { isHandActive = false; modeText.innerText = "Modalità: Occhi"; modeText.style.color = "white"; }
        }

        const now = Date.now();
        if (isHandActive && now - lastHandSent > 33) {
            sendCommand({ action: "move_hand", dx: (1.0 - indexTip.x) - 0.5, dy: indexTip.y - 0.5 });
            lastHandSent = now;
        }

        if (isPinch && !lastPinchState) { sendCommand({ action: "click_left" }); }
        lastPinchState = isPinch;
    }
}

// --- 3. FOTOCAMERA ---
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
    } catch (err) {
        alert("Errore fotocamera: " + err.message);
    }
}

function stopCamera() {
    isTracking = false;
    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
    }
    setupScreen.style.display = 'block';
    cameraScreen.style.display = 'none';
}

// --- 4. AVVIO ---
startBtn.addEventListener('click', connectToPC);
stopBtn.addEventListener('click', () => { if (ws) ws.close(); });