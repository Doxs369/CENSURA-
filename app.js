// Riferimenti agli elementi HTML
const setupScreen = document.getElementById('setup-screen');
const cameraScreen = document.getElementById('camera-screen');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const ipInput = document.getElementById('ip-input');
const statusText = document.getElementById('status-text');
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const modeText = document.getElementById('current-mode');

// Variabili di stato
let ws;
let isTracking = false;
let lastEyeSent = 0;
let lastHandSent = 0;
let isHandActive = false;
let lastPinchState = false;

// --- 1. GESTIONE CONNESSIONE WEBSOCKET ---
function connectWebSocket(ip) {
    ws = new WebSocket(`ws://${ip}:8765`);
    
    ws.onopen = () => {
        statusText.innerText = "Stato: Connesso al PC!";
        statusText.style.color = "green";
        startCamera(); // Avvia la fotocamera solo se il PC risponde
    };
    
    ws.onerror = (error) => {
        statusText.innerText = "Errore di connessione. Controlla l'IP e il WiFi.";
        statusText.style.color = "red";
    };
    
    ws.onclose = () => {
        statusText.innerText = "Stato: Disconnesso";
        statusText.style.color = "red";
        stopCamera();
    };
}

// --- 2. INIZIALIZZAZIONE INTELLIGENZA ARTIFICIALE (MediaPipe) ---
const faceMesh = new FaceMesh({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
}});
faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});
faceMesh.onResults(onFaceResults);

const hands = new Hands({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});
hands.setOptions({
    maxNumHands: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});
hands.onResults(onHandsResults);

// --- 3. LOGICA DI TRACCIAMENTO OCCHI ---
function onFaceResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Disegna il video di sfondo
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0 && !isHandActive) {
        const landmarks = results.multiFaceLandmarks[0];
        
        // Indici delle iridi in MediaPipe
        const leftIris = landmarks[468];
        const rightIris = landmarks[473];
        
        // Punto medio dello sguardo
        const gazeX = (leftIris.x + rightIris.x) / 2;
        const gazeY = (leftIris.y + rightIris.y) / 2;

        // Disegna un puntino per debug visivo
        canvasCtx.fillStyle = '#FF0000';
        canvasCtx.beginPath();
        canvasCtx.arc(gazeX * canvasElement.width, gazeY * canvasElement.height, 10, 0, 2 * Math.PI);
        canvasCtx.fill();

        // Invia i dati al PC (limitato a 30 fps per non intasare la rete)
        const now = Date.now();
        if (now - lastEyeSent > 33 && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: "move_eyes",
                x: 1.0 - gazeX, // Invertiamo X perché lo schermo è specchiato
                y: gazeY
            }));
            lastEyeSent = now;
        }
    }
    canvasCtx.restore();
}

// --- 4. LOGICA DI TRACCIAMENTO MANI ---
function onHandsResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // Rilevamento Pinza (Pollice 4 e Indice 8)
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const distance = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
        const isPinch = distance < 0.05;

        // Rilevamento Palmo Aperto (per attivare la centratura fine)
        const isPalmOpen = (indexTip.y < landmarks[5].y) && (landmarks[12].y < landmarks[9].y);

        // Aggiorna stato Lock-On
        if (isPalmOpen) {
            if (!isHandActive) {
                isHandActive = true;
                modeText.innerText = "Modalità: Centratura Mano";
                modeText.style.color = "#D67B5D";
            }
        } else if (!isPinch) {
            if (isHandActive) {
                isHandActive = false;
                modeText.innerText = "Modalità: Occhi";
                modeText.style.color = "white";
            }
        }

        // Invia dati movimento mano se attiva
        const now = Date.now();
        if (isHandActive && now - lastHandSent > 33 && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: "move_hand",
                dx: (1.0 - indexTip.x) - 0.5, // Spostamento relativo dal centro
                dy: indexTip.y - 0.5
            }));
            lastHandSent = now;
        }

        // Gestione Click (solo al cambio di stato per non fare click infiniti)
        if (isPinch && !lastPinchState) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: "click_left" }));
            }
        }
        lastPinchState = isPinch;

        // Disegna la mano per debug
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {color: '#348F86', lineWidth: 2});
    }
}

// --- 5. GESTIONE FOTOCAMERA ---
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user', width: 640, height: 480 } 
        });
        videoElement.srcObject = stream;
        
        setupScreen.style.display = 'none';
        cameraScreen.style.display = 'block';
        canvasElement.width = 640;
        canvasElement.height = 480;

        // Loop per processare i frame con l'IA
        const processFrame = async () => {
            if (!isTracking) return;
            await faceMesh.send({image: videoElement});
            await hands.send({image: videoElement});
            requestAnimationFrame(processFrame);
        };
        
        isTracking = true;
        videoElement.onloadedmetadata = () => {
            processFrame();
        };
        
    } catch (err) {
        alert("Errore accesso fotocamera: " + err.message);
        ws.close();
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

// --- 6. EVENTI PULSANTI ---
startBtn.addEventListener('click', () => {
    const ip = ipInput.value.trim();
    if (ip) {
        statusText.innerText = "Stato: Connessione in corso...";
        connectWebSocket(ip);
    } else {
        alert("Inserisci l'indirizzo IP del PC.");
    }
});

stopBtn.addEventListener('click', () => {
    if (ws) ws.close();
    stopCamera();
});