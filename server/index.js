import { WebSocketServer, WebSocket } from 'ws';

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
        // Note: data.data contains the boolean[][] array
        
        // Example: Count active cells
        let activeCount = 0;
        data.data.forEach(row => {
          row.forEach(cell => {
            if (cell) activeCount++;
          });
        });
        console.log(`Currently ${activeCount} cells are active.`);
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

// --- Server-to-Client Command Simulation ---
// To prove the server can control the frontend, we will pick a random 
// cell to toggle every 10 seconds.
setInterval(() => {
  if (clients.size === 0) return;

  // Assuming a 10x10 grid as defined in the frontend
  const randomRow = Math.floor(Math.random() * 10);
  const randomCol = Math.floor(Math.random() * 10);

  const payload = JSON.stringify({
    type: 'toggle',
    row: randomRow,
    col: randomCol
  });

  console.log(`[Server Event] Sending toggle command for cell (${randomRow}, ${randomCol})`);

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}, 10000); // Fire every 10 seconds
