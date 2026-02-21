const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// Map: code -> { caller: ws, callee: ws }
const rooms = new Map();

// Code expiry: 5 minutes of inactivity
const CODE_TTL = 5 * 60 * 1000;
const expireTimers = new Map();

function clearRoom(code) {
  const room = rooms.get(code);
  if (room) {
    if (room.caller && room.caller.readyState === WebSocket.OPEN) {
      room.caller.send(JSON.stringify({ type: 'room-closed' }));
    }
    if (room.callee && room.callee.readyState === WebSocket.OPEN) {
      room.callee.send(JSON.stringify({ type: 'room-closed' }));
    }
    rooms.delete(code);
  }
  if (expireTimers.has(code)) {
    clearTimeout(expireTimers.get(code));
    expireTimers.delete(code);
  }
}

function scheduleExpiry(code) {
  if (expireTimers.has(code)) clearTimeout(expireTimers.get(code));
  const t = setTimeout(() => clearRoom(code), CODE_TTL);
  expireTimers.set(code, t);
}

wss.on('connection', (ws) => {
  let currentCode = null;
  let role = null; // 'caller' | 'callee'

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'create': {
        const code = msg.code;
        if (!code || rooms.has(code)) {
          ws.send(JSON.stringify({ type: 'error', reason: 'code-taken' }));
          return;
        }
        rooms.set(code, { caller: ws, callee: null });
        currentCode = code;
        role = 'caller';
        scheduleExpiry(code);
        ws.send(JSON.stringify({ type: 'created', code }));
        break;
      }

      case 'join': {
        const code = msg.code;
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', reason: 'not-found' }));
          return;
        }
        if (room.callee) {
          ws.send(JSON.stringify({ type: 'error', reason: 'room-full' }));
          return;
        }
        room.callee = ws;
        currentCode = code;
        role = 'callee';
        // Cancel expiry — both peers present
        if (expireTimers.has(code)) {
          clearTimeout(expireTimers.get(code));
          expireTimers.delete(code);
        }
        ws.send(JSON.stringify({ type: 'joined', code }));
        room.caller.send(JSON.stringify({ type: 'peer-joined' }));
        break;
      }

      // Relay signaling messages between peers
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const room = rooms.get(currentCode);
        if (!room) return;
        const target = role === 'caller' ? room.callee : room.caller;
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify(msg));
        }
        break;
      }

      case 'hang-up': {
        const room = rooms.get(currentCode);
        if (!room) return;
        const target = role === 'caller' ? room.callee : room.caller;
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify({ type: 'hang-up' }));
        }
        clearRoom(currentCode);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!currentCode) return;
    const room = rooms.get(currentCode);
    if (!room) return;
    const target = role === 'caller' ? room.callee : room.caller;
    if (target && target.readyState === WebSocket.OPEN) {
      target.send(JSON.stringify({ type: 'hang-up' }));
    }
    clearRoom(currentCode);
  });
});

console.log(`Signaling server running on port ${PORT}`);
