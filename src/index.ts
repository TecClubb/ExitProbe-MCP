import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ExitProbe } from 'exitprobe';
import { createServer } from './server.js';

const apiKey = process.env.EXITPROBE_API_KEY;
if (!apiKey) {
  // stdout is the protocol channel — diagnostics go to stderr only.
  console.error('exitprobe-mcp: EXITPROBE_API_KEY is not set. Create a token under Settings → API Tokens in your ExitProbe dashboard.');
  process.exit(1);
}

const client = new ExitProbe({ apiKey, baseUrl: process.env.EXITPROBE_BASE_URL });
const readOnly = ['1', 'true', 'yes'].includes((process.env.EXITPROBE_READ_ONLY ?? '').toLowerCase());

await createServer(client, { readOnly }).connect(new StdioServerTransport());
console.error(`exitprobe-mcp ready${readOnly ? ' (read-only)' : ''}`);
