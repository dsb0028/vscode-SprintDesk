#!/usr/bin/env node

import { processJsonRequest } from './core';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

process.stdin.setEncoding('utf8');

let buffer = '';

process.stdin.on('data', (chunk: string) => {
  buffer += chunk;

  let newlineIndex;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);

    if (line.trim()) {
      handleLine(line);
    }
  }
});

function handleLine(line: string) {
  processJsonRequest(line).then((response: string) => {
    process.stdout.write(response + '\n');
  }).catch((err: Error) => {
    const errorResponse = {
      jsonrpc: '2.0',
      id: 'unknown',
      error: {
        code: -32700,
        message: 'Parse error',
        data: err.message
      }
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
  });
}

process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});