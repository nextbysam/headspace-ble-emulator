const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

function startDashboard(state, port = 3000) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.static(path.join(__dirname, 'public')));

  wss.on('connection', (ws) => {
    // Send current state immediately
    ws.send(JSON.stringify(state.snapshot()));
  });

  // Broadcast state updates to all connected clients
  state.on('state-updated', (snapshot) => {
    const data = JSON.stringify(snapshot);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(data);
      }
    });
  });

  server.listen(port, () => {
    console.log(`[DASH] Dashboard on http://localhost:${port}`);
  });
}

module.exports = { startDashboard };
