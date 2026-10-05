import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ExitProbe, ExitProbeError } from 'exitprobe';
import { z } from 'zod';
import { toText } from './redact.js';

const PROTOCOLS = ['wireguard', 'openvpn', 'ikev2', 'vless', 'hysteria', 'trojan', 'shadowsocks', 'vmess'] as const;
const RANGE = z.enum(['1h', '6h', '24h', '7d', '30d']).optional();
const id = (what: string) => z.number().int().positive().describe(`${what} id`);

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (v: unknown): Result => ({ content: [{ type: 'text', text: toText(v) }] });

function fail(e: unknown): Result {
  let text: string;
  if (e instanceof ExitProbeError) {
    text = `ExitProbe API error (HTTP ${e.status || 'network'}): ${e.message}`;
    if (e.errors) text += `\nField errors: ${JSON.stringify(e.errors)}`;
    if (e.status === 403) text += '\nThis token lacks the ability this tool needs — create a token with the right scopes under Settings → API Tokens.';
  } else {
    text = e instanceof Error ? e.message : String(e);
  }
  return { content: [{ type: 'text', text }], isError: true };
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DESTROY = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export function createServer(client: ExitProbe, opts: { readOnly?: boolean } = {}): McpServer {
  const server = new McpServer({ name: 'exitprobe', version: '1.0.0' });

  // `tool` wraps every handler so API failures become readable tool errors
  // instead of protocol errors, and read-only mode drops every writer.
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    annotations: typeof READ | typeof WRITE | typeof DESTROY,
    run: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<unknown>,
  ) {
    if (opts.readOnly && !annotations.readOnlyHint) return;
    server.registerTool(
      name,
      { description, inputSchema: shape, annotations },
      (async (args: z.objectOutputType<S, z.ZodTypeAny>) => {
        try { return ok(await run(args)); } catch (e) { return fail(e); }
      }) as never,
    );
  }

  // ----------------------------------------------------------- monitors
  tool('list_monitors',
    'List VPN monitors with fleet counts (up/down/degraded/flapping/ip_mismatch). Counts always cover the whole filtered fleet. Use per_page for big fleets.',
    {
      status: z.enum(['up', 'down', 'degraded', 'flapping', 'ip_mismatch', 'unknown']).optional(),
      protocol: z.enum(PROTOCOLS).optional(),
      project_id: z.number().int().optional(),
      search: z.string().optional(),
      tag: z.string().optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().min(1).max(100).default(25),
    }, READ,
    (a) => client.monitors.list({ ...a, lean: true, defer_uptime: true }));

  tool('monitors_summary', 'Status counts for the whole monitor fleet (optionally one project).',
    { project_id: z.number().int().optional() }, READ,
    (a) => client.monitors.summary(a));

  tool('get_monitor', 'One monitor: protocols, status, interval, probes. Stored configs and passwords are redacted.',
    { monitor_id: id('Monitor') }, READ,
    (a) => client.monitors.get(a.monitor_id));

  tool('monitor_details', 'Monitor plus its uptime and recent checks in one call — the quickest way to answer "how is this server doing?".',
    { monitor_id: id('Monitor'), range: RANGE, checks: z.number().int().min(1).max(100).default(20) }, READ,
    (a) => client.monitors.details(a.monitor_id, { range: a.range, checks: a.checks }));

  tool('monitor_status', 'Current fleet status of one monitor.',
    { monitor_id: id('Monitor') }, READ,
    (a) => client.monitors.status(a.monitor_id));

  tool('monitor_checks', 'Raw check history for a monitor (newest first), optionally for one protocol.',
    { monitor_id: id('Monitor'), protocol: z.enum(PROTOCOLS).optional(), page: z.number().int().positive().optional(), per_page: z.number().int().min(1).max(100).default(20) }, READ,
    ({ monitor_id, ...q }) => client.monitors.checks(monitor_id, q));

  tool('monitor_uptime', 'Uptime percentages and bars for a monitor over a range.',
    { monitor_id: id('Monitor'), range: RANGE }, READ,
    (a) => client.monitors.uptime(a.monitor_id, { range: a.range }));

  tool('monitor_regions', 'Uptime per probe region for a monitor — shows whether a problem is regional.',
    { monitor_id: id('Monitor'), range: RANGE }, READ,
    (a) => client.monitors.uptimeRegions(a.monitor_id, { range: a.range }));

  tool('monitor_analytics', 'Latency / volume analytics for a monitor over a range.',
    { monitor_id: id('Monitor'), range: RANGE }, READ,
    (a) => client.monitors.analytics(a.monitor_id, { range: a.range }));

  tool('check_now',
    'Run an on-demand check on every enabled protocol and wait for the result (up to 90s). Counts against the plan\'s manual-check quota.',
    { monitor_id: id('Monitor') }, WRITE,
    (a) => client.monitors.checkNowAndWait(a.monitor_id));

  tool('create_monitor',
    'Create a VPN monitor. Enable at least one protocol and give its config/URI (wireguard_config, openvpn_config, vless_uri, hysteria_uri, trojan_uri, shadowsocks_uri, vmess_uri, or ikev2_target_host + credentials). The API validates formats and plan limits and explains failures.',
    {
      name: z.string().min(1).max(255),
      project_id: z.number().int().optional().describe('Project to create it in; omit for the default project'),
      expected_exit_ip: z.string().optional(),
      check_interval_seconds: z.number().int().optional(),
      wireguard_enabled: z.boolean().optional(), wireguard_config: z.string().optional(),
      openvpn_enabled: z.boolean().optional(), openvpn_config: z.string().optional(),
      openvpn_auth_username: z.string().optional(), openvpn_auth_password: z.string().optional(),
      ikev2_enabled: z.boolean().optional(), ikev2_target_host: z.string().optional(), ikev2_remote_id: z.string().optional(),
      ikev2_auth_username: z.string().optional(), ikev2_auth_password: z.string().optional(),
      vless_enabled: z.boolean().optional(), vless_uri: z.string().optional(),
      hysteria_enabled: z.boolean().optional(), hysteria_uri: z.string().optional(),
      trojan_enabled: z.boolean().optional(), trojan_uri: z.string().optional(),
      shadowsocks_enabled: z.boolean().optional(), shadowsocks_uri: z.string().optional(),
      vmess_enabled: z.boolean().optional(), vmess_uri: z.string().optional(),
    }, WRITE,
    ({ project_id, ...input }) => project_id
      ? client.monitors.createForProject(project_id, input)
      : client.monitors.create(input));

  tool('update_monitor', 'Edit a monitor: rename, change interval, expected exit IP, or any protocol config. Only the fields you pass change.',
    {
      monitor_id: id('Monitor'),
      name: z.string().max(255).optional(),
      expected_exit_ip: z.string().optional(),
      check_interval_seconds: z.number().int().optional(),
      wireguard_enabled: z.boolean().optional(), wireguard_config: z.string().optional(),
      openvpn_enabled: z.boolean().optional(), openvpn_config: z.string().optional(),
      openvpn_auth_username: z.string().optional(), openvpn_auth_password: z.string().optional(),
      ikev2_enabled: z.boolean().optional(), ikev2_target_host: z.string().optional(), ikev2_remote_id: z.string().optional(),
      ikev2_auth_username: z.string().optional(), ikev2_auth_password: z.string().optional(),
      vless_enabled: z.boolean().optional(), vless_uri: z.string().optional(),
      hysteria_enabled: z.boolean().optional(), hysteria_uri: z.string().optional(),
      trojan_enabled: z.boolean().optional(), trojan_uri: z.string().optional(),
      shadowsocks_enabled: z.boolean().optional(), shadowsocks_uri: z.string().optional(),
      vmess_enabled: z.boolean().optional(), vmess_uri: z.string().optional(),
    }, WRITE,
    ({ monitor_id, ...input }) => client.monitors.update(monitor_id, input));

  tool('bulk_update_monitors', 'Set the check interval and/or probe assignment for many monitors at once.',
    {
      monitor_ids: z.array(z.number().int().positive()).min(1).max(200),
      check_interval_seconds: z.number().int().optional(),
      probe_mode: z.enum(['all', 'single', 'custom']).optional(),
      probe_ids: z.array(z.number().int()).optional(),
    }, WRITE,
    (a) => client.monitors.bulkUpdate(a));

  tool('delete_monitor', 'Delete a monitor (soft-deleted, recoverable for 30 days with restore_monitor).',
    { monitor_id: id('Monitor') }, DESTROY,
    (a) => client.monitors.delete(a.monitor_id));

  tool('restore_monitor', 'Restore a monitor deleted in the last 30 days.',
    { monitor_id: id('Monitor') }, WRITE,
    (a) => client.monitors.restore(a.monitor_id));

  // ----------------------------------------------------------- projects
  tool('list_projects', 'Projects (workspaces) on the account.', {}, READ, () => client.projects.list());
  tool('get_project', 'One project.', { project_id: id('Project') }, READ, (a) => client.projects.get(a.project_id));
  tool('list_project_monitors', 'Monitors in one project, with fleet counts.',
    { project_id: id('Project'), status: z.enum(['up', 'down', 'degraded', 'flapping', 'ip_mismatch', 'unknown']).optional(), per_page: z.number().int().min(1).max(100).default(25) }, READ,
    ({ project_id, ...q }) => client.projects.monitors(project_id, { ...q, lean: true, defer_uptime: true }));
  tool('create_project', 'Create a project.', { name: z.string().min(1).max(255) }, WRITE, (a) => client.projects.create(a));
  tool('update_project', 'Rename a project.', { project_id: id('Project'), name: z.string().min(1).max(255) }, WRITE,
    (a) => client.projects.update(a.project_id, { name: a.name }));
  tool('delete_project', 'Delete a project and its monitors (recoverable for 30 days with restore_project).', { project_id: id('Project') }, DESTROY,
    (a) => client.projects.delete(a.project_id));
  tool('restore_project', 'Restore a project deleted in the last 30 days.', { project_id: id('Project') }, WRITE,
    (a) => client.projects.restore(a.project_id));

  // ---------------------------------------------------------- incidents
  tool('list_incidents', 'Incidents (open and resolved), each with its protocol and probe.',
    { status: z.string().optional().describe('e.g. open or resolved'), page: z.number().int().positive().optional() }, READ,
    (a) => client.request('GET', '/incidents', { query: a }));
  tool('acknowledge_incident', 'Acknowledge an incident so it stops escalating.', { incident_id: id('Incident') }, WRITE,
    (a) => client.request('POST', `/incidents/${a.incident_id}/acknowledge`));

  // ------------------------------------------------------------- probes
  tool('list_probes', 'Your private (custom) probes with health and agent version.', {}, READ,
    () => client.request('GET', '/user/probes'));
  tool('get_probe', 'One private probe: health and assigned monitors.', { probe_id: id('Probe') }, READ,
    (a) => client.request('GET', `/user/probes/${a.probe_id}`));
  tool('list_public_probes', 'The public probe fleet (locations and online status).', {}, READ,
    () => client.request('GET', '/probes/public'));

  // ---------------------------------------------------------------- VPS
  tool('list_vps', 'VPS health-monitoring servers with fleet counts (online / offline / unregistered) and health scores.',
    { status: z.enum(['online', 'offline', 'unregistered']).optional(), search: z.string().optional(), project_id: z.number().int().optional(), page: z.number().int().positive().optional(), per_page: z.number().int().min(1).max(100).default(25) }, READ,
    (a) => client.vps.list(a));
  tool('vps_summary', 'VPS fleet counts and the average health score.', { project_id: z.number().int().optional() }, READ,
    (a) => client.vps.summary(a));
  tool('get_vps', 'Full health of one VPS: CPU/RAM/disk/load/network, health score, availability, system info, top processes, thresholds, incidents. Pass summary_only for the current state without chart history.',
    { vps_id: id('VPS'), range: RANGE, limit: z.number().int().min(1).max(2000).optional(), summary_only: z.boolean().default(false) }, READ,
    ({ vps_id, summary_only, ...q }) => summary_only ? client.vps.getSummary(vps_id) : client.vps.get(vps_id, q));
  tool('register_vps', 'Register a VPS. Returns the one-time agent install_command to run on that server — shown only now.',
    { name: z.string().min(1).max(255), ip_address: z.string(), project_id: z.number().int().optional() }, WRITE,
    (a) => client.vps.create(a));
  tool('update_vps', 'Rename a VPS, switch it off, mute alerts, or change CPU / memory / disk alert thresholds (50-100%) and the sustained-minutes window (5-1440).',
    {
      vps_id: id('VPS'), name: z.string().optional(), is_active: z.boolean().optional(), notifications_enabled: z.boolean().optional(),
      cpu_threshold: z.number().min(50).max(100).optional(), memory_threshold: z.number().min(50).max(100).optional(),
      disk_threshold: z.number().min(50).max(100).optional(), threshold_duration_minutes: z.number().int().min(5).max(1440).optional(),
    }, WRITE,
    ({ vps_id, ...input }) => client.vps.update(vps_id, input));
  tool('rotate_vps_token', 'Rotate a VPS agent token. The old token stops working immediately; run the returned install_command on the server.',
    { vps_id: id('VPS') }, DESTROY,
    (a) => client.vps.regenerateToken(a.vps_id));
  tool('delete_vps', 'Delete a VPS server permanently (no restore).', { vps_id: id('VPS') }, DESTROY,
    (a) => client.vps.delete(a.vps_id));

  // ------------------------------------------------------------ billing
  tool('get_usage', 'Plan, every limit with how much is used, wallet credit and renewal date. Read-only: plans cannot be changed through the API.',
    {}, READ, () => client.billing.usage());

  return server;
}
