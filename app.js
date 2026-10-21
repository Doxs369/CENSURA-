// app.js
const setupScreen = document.getElementById('setup-screen');
const cameraScreen = document.getElementById('camera-screen');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const scanBtn = document.getElementById('scan-btn');
const ipInput = document.getElementById('ip-input');
const statusText = document.getElementById('status-text');
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const modeText = document.getElementById('current-mode');
const deviceListDiv = document.getElementById('device-list');
const deviceUl = document.getElementById('device-ul');

let ws;
let isTracking = false;
let lastEyeSent = 0;
let lastHandSent = 0;
let isHandActive = false;
let lastPinchState = false;

// --- 1. RICERCA AUTOMATICA DEI DISPOSITIVI ---
async function scanNetwork() {
    deviceUl.innerHTML = '';
    deviceListDiv.style.display = 'block';
    scanBtn.innerText = "Scansione in corso...";
    scanBtn.disabled = true;

    // Prendiamo le prime 3 cifre dell'IP manuale se inserito, altrimenti usiamo un default comune
    let baseIp = "192.168.1"; 
    if (ipInput.value.includes('.')) {
        baseIp = ipInput.value.substring(0, ipInput.value.lastIndexOf('.'));
    }

    for (let i = 1; i <= 254; i++) {
        const ip = `${baseIp}.${i}`;
        tryConnect(ip);
        // Piccolo delay per non sovraccaricare la rete
        if(i % 20 === 0) await new Promise(r => setTimeout(r, 100));
    }

    setTimeout(() => {
        scanBtn.innerText = "CERCA PC SULLA RETE";
        scanBtn.disabled = false;
    }, 5000); // Aspetta 5 secondi per i risultati finali
}

function tryConnect(ip) {
    // Timeout brevissimo per scartare gli IP inesistenti
    const socket = new WebSocket(`ws://${ip}:8765`);
    
    const timeout = setTimeout(() => { socket.close(); }, 400);

    socket.onopen = () => {
        socket.send(JSON.stringify({ action: "discover" }));
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.action === "discover_response" && data.device === "MULTYEYE_PC_01") {
            clearTimeout(timeout);
            socket.close(); // Chiudiamo questa connessione di test
            
            // Aggiungi alla lista se non è già presente
            if (!document.querySelector(`[data-ip="${ip}"]`)) {
                const li = document.createElement('li');
                li.innerHTML = `<button style="width:100%; margin-top:5px; background-color:#D67B5D;" data-ip="${ip}">PC MultyEye trovato: ${ip}</button>`;
                li.querySelector('button').onclick = () => connectToPC(ip);
                deviceUl.appendChild(li);
            }
        }
    };

    socket.onerror = () => { clearTimeout(timeout); socket.close(); };
}

// --- 2. CONNESSIONE AL PC SELEZIONATO ---
function connectToPC(pcIp) {
    if (ws) ws.close(); // Chiudi connessioni precedenti

    statusText.innerText = `Connessione a ${pcIp}...`;
    statusText.style.color = "#348F86";

    ws = new WebSocket(`ws://${pcIp}:8765`);
    
    ws.onopen = () => {
        statusText.innerText = "Connesso! Richiesta permesso fotocamera...";
        statusText.style.color = "green";
        startCamera(); // Qui chiediamo il permesso per la fotocamera
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

// --- 3. INTELLIGENZA ARTIFICIALE (MediaPipe) ---
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

// --- 4. FOTOCAMERA E PERMESSI ---
async function startCamera() {
    try {
        // Questa riga forza Chrome a mostrare il popup per i permessi
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
        alert("Errore accesso fotocamera: " + err.message + "\n\nSe hai negato i permessi, vai nelle impostazioni di Chrome e ripristinali.");
        if (ws) ws.close();
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

// --- 5. EVENTI PULSANTI ---
startBtn.addEventListener('click', () => {
    const ip = ipInput.value.trim();
    if (ip) {
        connectToPC(ip);
    } else {
        alert("Inserisci un IP o usa la scansione automatica.");
    }
});

scanBtn.addEventListener('click', scanNetwork);
stopBtn.addEventListener('click', () => { if (ws) ws.close(); });