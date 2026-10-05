import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ExitProbe } from 'exitprobe';
import { describe, expect, it } from 'vitest';
import { createServer } from './server.js';

type Call = { url: string; method: string; body?: any; auth?: string };

async function connect(reply: (c: Call) => { status?: number; json: unknown }, readOnly = false) {
  const calls: Call[] = [];
  const fetchStub = (async (url: string, init: any) => {
    const call = { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization };
    calls.push(call);
    const r = reply(call);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  const server = createServer(new ExitProbe({ apiKey: 'k', baseUrl: 'https://x.test/api/v1', fetch: fetchStub }), { readOnly });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 't', version: '1' });
  await client.connect(b);
  return { client, calls };
}
const text = (r: any) => r.content[0].text as string;

describe('exitprobe MCP server', () => {
  it('exposes the tool catalog with schemas and safety annotations', async () => {
    const { client } = await connect(() => ({ json: {} }));
    const { tools } = await client.listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(tools.length).toBeGreaterThanOrEqual(35);
    expect(by.list_monitors.annotations?.readOnlyHint).toBe(true);
    expect(by.delete_monitor.annotations?.destructiveHint).toBe(true);
    expect(by.create_monitor.inputSchema.required).toContain('name');
  });

  it('calls the API with the bearer token and query filters', async () => {
    const { client, calls } = await connect(() => ({ json: { data: { monitors: [] } } }));
    await client.callTool({ name: 'list_monitors', arguments: { status: 'down', per_page: 10 } });
    expect(calls[0].url).toContain('/monitors?');
    expect(calls[0].url).toContain('status=down');
    expect(calls[0].url).toContain('per_page=10');
    expect(calls[0].auth).toBe('Bearer k');
  });

  it('never hands stored configs or passwords to the model', async () => {
    const { client } = await connect(() => ({
      json: { data: { monitor: { id: 1, name: 'a', wireguard_config: '[Interface]\nPrivateKey=SECRET', vless_uri: 'vless://u@h', openvpn_auth_password: 'pw', check_interval_seconds: 60 } } },
    }));
    const out = text(await client.callTool({ name: 'get_monitor', arguments: { monitor_id: 1 } }));
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('vless://u@h');
    expect(out).not.toContain('"pw"');
    expect(out).toContain('"check_interval_seconds": 60');
  });

  it('keeps the one-time VPS install command', async () => {
    const { client } = await connect(() => ({ json: { data: { install_command: 'curl x | sh', token: 'tok' } } }));
    const out = text(await client.callTool({ name: 'register_vps', arguments: { name: 'a', ip_address: '1.2.3.4' } }));
    expect(out).toContain('curl x | sh');
  });

  it('turns API errors into readable tool errors', async () => {
    const { client } = await connect(() => ({ status: 422, json: { message: 'Invalid', errors: { name: ['required'] } } }));
    const r: any = await client.callTool({ name: 'create_monitor', arguments: { name: 'x' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('HTTP 422');
    expect(text(r)).toContain('required');
  });

  it('explains a 403 as a missing token ability', async () => {
    const { client } = await connect(() => ({ status: 403, json: { message: 'forbidden' } }));
    const r: any = await client.callTool({ name: 'list_vps', arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Settings → API Tokens');
  });

  it('rejects invalid arguments before any request is made', async () => {
    const { client, calls } = await connect(() => ({ json: {} }));
    const r: any = await client.callTool({ name: 'get_monitor', arguments: { monitor_id: -3 } }).catch((e) => ({ isError: true, e }));
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('read-only mode removes every tool that can change anything', async () => {
    const { client } = await connect(() => ({ json: {} }), true);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(10);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.map((t) => t.name)).not.toContain('delete_monitor');
  });

  it('createForProject is used when project_id is given', async () => {
    const { client, calls } = await connect(() => ({ json: { data: {} } }));
    await client.callTool({ name: 'create_monitor', arguments: { name: 'n', project_id: 7, vless_enabled: true, vless_uri: 'vless://a@b:1' } });
    expect(calls[0].url).toContain('/projects/7/monitors');
    expect(calls[0].body.project_id).toBeUndefined();
  });
});
