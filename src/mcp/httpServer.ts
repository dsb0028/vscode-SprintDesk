import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { handleRequest } from './core';
import { ALL_TOOLS } from './tools';

export interface McpHttpTransportOptions {
  port?: number;
  onListen?: (port: number, server: http.Server) => void;
}

export function createMcpHttpTransport(options: McpHttpTransportOptions = {}): http.Server {
  const port = options.port || 3847;

  function createCorsHeaders() {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
  }

  function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json', ...createCorsHeaders() });
    res.end(JSON.stringify(data));
  }

  function sendError(res: http.ServerResponse, statusCode: number, message: string) {
    sendJson(res, statusCode, { error: message });
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, createCorsHeaders());
      res.end();
      return;
    }

    const url = req.url?.split('?')[0] || '/';

    if (req.method === 'GET' && url === '/health') {
      sendJson(res, 200, { status: 'ok', server: 'sprintdesk-mcp' });
      return;
    }

    if (req.method === 'GET' && url === '/tools') {
      sendJson(res, 200, { tools: ALL_TOOLS.map(t => t.name) });
      return;
    }

    if (req.method === 'POST' && url === '/mcp') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const request = JSON.parse(body);
          const response = await handleRequest(request);
          if (response.result || response.error) {
            sendJson(res, 200, response);
          } else {
            sendJson(res, 400, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
          }
        } catch (e: any) {
          sendJson(res, 400, { jsonrpc: '2.0', id: 0, error: { code: -32700, message: e.message } });
        }
      });
      return;
    }

    if (req.method === 'GET') {
      const indexPath = path.join(__dirname, '..', '..', '.SprintDesk', 'mcp', 'README.md');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/markdown' });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }
    }

    sendError(res, 404, 'Not found');
  });

  server.listen(port, () => {
    console.log(`🚀 SprintDesk MCP server running on http://localhost:${port}`);
    if (options.onListen) {
      options.onListen(port, server);
    }
  });

  return server;
}