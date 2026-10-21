const setupScreen = document.getElementById('setup-screen');
const cameraScreen = document.getElementById('camera-screen');
const stopBtn = document.getElementById('stop-btn');
const statusText = document.getElementById('status-text');
const scanStatus = document.getElementById('scan-status');
const deviceList = document.getElementById('device-list');
const deviceUl = document.getElementById('device-ul');
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

// --- RICHIESTA FOTOCAMERA IMMEDIATA ALL'AVVIO ---
window.onload = async () => {
    try {
        // Chiediamo subito il permesso per la fotocamera
        await navigator.mediaDevices.getUserMedia({ video: true });
        statusText.innerText = "Permesso fotocamera concesso!";
        statusText.style.color = "green";
        // Ora che abbiamo il permesso, avviamo la scansione
        scanNetwork();
    } catch (err) {
        statusText.innerText = "Permesso fotocamera NEGATO. Ricarica e consenti.";
        statusText.style.color = "red";
    }
};

// --- SCANSIONE DELLA RETE LOCALE ---
async function scanNetwork() {
    deviceUl.innerHTML = '';
    deviceList.style.display = 'none';
    scanStatus.innerText = "Scansione della rete locale in corso...";
    
    const subnet = "192.168.1"; // Sottorete comune
    
    for (let i = 1; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        tryConnect(ip);
        if(i % 20 === 0) await new Promise(r => setTimeout(r, 100));
    }

    setTimeout(() => {
        scanStatus.innerText = "Scansione completata. Seleziona il PC:";
        if (deviceUl.children.length > 0) deviceList.style.display = 'block';
        else scanStatus.innerText = "Nessun PC trovato. Assicurati che il PC abbia il motore avviato.";
    }, 4000);
}

function tryConnect(ip) {
    const socket = new WebSocket(`ws://${ip}:8765`);
    const timeout = setTimeout(() => { socket.close(); }, 500);

    socket.onopen = () => socket.send(JSON.stringify({ action: "discover" }));

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.action === "discover_response" && data.device === "MULTYEYE_PC_01") {
            clearTimeout(timeout);
            socket.close();
            if (!document.querySelector(`[data-ip="${ip}"]`)) {
                const li = document.createElement('li');
                li.innerHTML = `<button data-ip="${ip}">PC MultyEye trovato: ${ip}</button>`;
                li.querySelector('button').onclick = () => connectToPC(ip);
                deviceUl.appendChild(li);
            }
        }
    };
    socket.onerror = () => { clearTimeout(timeout); socket.close(); };
}

// --- CONNESSIONE E AVVIO ---
function connectToPC(pcIp) {
    if (ws) ws.close();
    statusText.innerText = `Connessione a ${pcIp}...`;
    ws = new WebSocket(`ws://${pcIp}:8765`);
    
    ws.onopen = () => {
        statusText.innerText = "Connesso! Avvio IA...";
        statusText.style.color = "green";
        startCamera();
    };
    ws.onclose = () => { statusText.innerText = "Disconnesso"; stopCamera(); };
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

stopBtn.addEventListener('click', () => { if (ws) ws.close(); });