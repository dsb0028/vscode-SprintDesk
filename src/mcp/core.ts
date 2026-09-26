import { ALL_TOOLS } from './tools';
import { handleToolCall } from './handlers';

export const SERVER_INFO = {
  name: 'sprintdesk-mcp',
  version: '1.1.0'
};

export function initialize(): any {
  const toolCapabilities: Record<string, any> = {};

  for (const tool of ALL_TOOLS) {
    toolCapabilities[tool.name] = {
      description: tool.description,
      inputSchema: tool.inputSchema
    };
  }

  return {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: toolCapabilities
    },
    serverInfo: SERVER_INFO
  };
}

export function getToolNames(): string[] {
  return ALL_TOOLS.map(t => t.name);
}

export async function handleRequest(request: any): Promise<any> {
  const { id, method, params } = request;

  try {
    if (method === 'initialize') {
      const result = initialize();
      return {
        jsonrpc: '2.0',
        id,
        result
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: ALL_TOOLS
        }
      };
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      if (!toolName) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: 'Invalid params: missing tool name',
            data: null
          }
        };
      }

      const result = await handleToolCall(toolName, toolArgs);

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: result.content
        }
      };
    }

    if (method === 'ping') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: 'pong' }]
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
        data: null
      }
    };
  } catch (error: any) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: error.message || 'Internal error',
        data: error
      }
    };
  }
}

export async function processJsonRequest(jsonString: string): Promise<string> {
  try {
    const request = JSON.parse(jsonString);
    const response = await handleRequest(request);
    return JSON.stringify(response);
  } catch (error: any) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: 'unknown',
      error: {
        code: -32700,
        message: 'Parse error',
        data: error.message
      }
    };
    return JSON.stringify(errorResponse);
  }
}