import { WebSocketServer, WebSocket } from 'ws';
import Grid from './grid.js'

const port = 8080;
const wss = new WebSocketServer({ port });

console.log(`Murmuration WebSocket Server running on ws://localhost:${port}`);

const clients = new Set();

const grid = await Grid.createGrid((x, y) => {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'toggle', row: y, col: x }));
    }
  })
})

wss.on('connection', (ws) => {
  console.log('New client connected!');
  clients.add(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'heartbeat') {
        console.log(`[Heartbeat] received at ${new Date(data.timestamp).toISOString()}`);
      } else if (data.type === 'grid_state') {
        console.log(`[Grid State Updated] Received state map from client.`);
        grid?.update(data.data);
      }
    } catch (e) {
      console.error('Failed to parse message:', message.toString());
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected.');
    clients.delete(ws);
  });
});
