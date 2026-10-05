# exitprobe-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for [ExitProbe](https://exitprobe.com). Lets Claude, Cursor, Windsurf, Cline or any MCP client inspect and manage your VPN monitors, VPS servers, incidents and plan usage in plain language.

> "Which of my servers are down right now, and is it one region or all of them?"
> "Add a VLESS monitor for this link to my Production project."
> "How is the Frankfurt VPS doing — what's using the CPU?"

## Install

Create a token under **Settings → API Tokens** in your ExitProbe dashboard, then:

```bash
# Claude Code
claude mcp add exitprobe --scope user \
  --env EXITPROBE_API_KEY="your_token_here" \
  -- npx -y exitprobe-mcp
```

Cursor / Windsurf (`mcp.json`):

```json
{
  "mcpServers": {
    "exitprobe": {
      "command": "npx",
      "args": ["-y", "exitprobe-mcp"],
      "env": { "EXITPROBE_API_KEY": "your_token_here" }
    }
  }
}
```

## Configuration

| Variable | Purpose |
|---|---|
| `EXITPROBE_API_KEY` | **Required.** Your account API token. |
| `EXITPROBE_READ_ONLY` | `1` removes every tool that can change anything (create/update/delete, check-now, token rotation). Recommended for a first try. |
| `EXITPROBE_BASE_URL` | Override the API URL (default `https://api.exitprobe.com/api/v1`). |

Scope the token to what you want the model to reach (`monitors`, `projects`, `vps`, `integrations`, `billing:read`). A tool whose scope the token lacks reports a clear error.

## Tools (35)

**Monitors** — `list_monitors`, `monitors_summary`, `get_monitor`, `monitor_details`, `monitor_status`, `monitor_checks`, `monitor_uptime`, `monitor_regions`, `monitor_analytics`, `check_now`, `create_monitor`, `update_monitor`, `bulk_update_monitors`, `delete_monitor`, `restore_monitor`
**Projects** — `list_projects`, `get_project`, `list_project_monitors`, `create_project`, `update_project`, `delete_project`, `restore_project`
**Incidents** — `list_incidents`, `acknowledge_incident`
**Probes** — `list_probes`, `get_probe`, `list_public_probes`
**VPS** — `list_vps`, `vps_summary`, `get_vps`, `register_vps`, `update_vps`, `rotate_vps_token`, `delete_vps`
**Usage** — `get_usage` (read-only; plans can't be changed through the API)

Destructive tools are annotated so clients ask before running them. Deleted monitors and projects stay recoverable for 30 days.

## Safety

- **Stored credentials never reach the model.** Monitors carry decrypted WireGuard/OpenVPN configs, share links and passwords; every tool result has those fields replaced with `[redacted]`.
- The token is read from the environment only and is never echoed.
- Large results are truncated with a hint to narrow the request.

## Develop

```bash
npm install && npm test && npm run build
```

Built on the [`exitprobe`](https://github.com/TecClubb/ExitProbe-Node) SDK, which is bundled into the output.
