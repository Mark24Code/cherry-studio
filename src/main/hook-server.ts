import http from 'http';


export function createHookServer(mainWindow: Electron.BrowserWindow, app: Electron.App) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/send-message') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const resp = JSON.parse(body);
          // 通过 IPC 将消息发送到渲染进程
          mainWindow.webContents.send('external-message', resp);
          console.log('Received message from HTTP request:', resp);
          res.writeHead(200, { 'Content-Type': 'application/json' });

          // 模拟用户发送消息
          // 发送事件给 Inputbar.tsx
          mainWindow.webContents.send('mock-user-send-message', resp["data"]);
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (error as Error).message }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(3000, () => {
    console.log('HTTP server listening on port 3000');
  });
}

