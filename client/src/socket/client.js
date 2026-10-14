import { io } from 'socket.io-client';

// In dev, Vite proxies /socket.io to localhost:3001.
// In prod, set VITE_SERVER_URL to your deployed server (e.g. Railway URL).
let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(import.meta.env.VITE_SERVER_URL || '/', {
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function dropSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}

// Trim a stroke before sending — recognition only needs the path shape.
export function compressPoints(points, max = 512) {
  let pts = points;
  if (pts.length > max) {
    const step = pts.length / max;
    pts = Array.from({ length: max }, (_, i) => pts[Math.floor(i * step)]);
  }
  return pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}
