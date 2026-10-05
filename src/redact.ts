/**
 * Stored credentials never reach the model: monitors return their decrypted
 * configs, URIs and passwords, and a tool result is conversation text.
 * `install_command` / `token` are kept — they are the one-time output the
 * user asked for when registering a VPS.
 */
const SECRET_KEY = /(^|_)(config|config_content|uri|password|secret)$|^(uri|config_content|api_key)$/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k) && typeof v === 'string' && v !== '') out[k] = '[redacted]';
      else out[k] = redact(v);
    }
    return out;
  }
  return value;
}

const MAX_CHARS = 60_000;

export function toText(value: unknown): string {
  const text = JSON.stringify(redact(value), null, 2) ?? 'null';
  return text.length > MAX_CHARS
    ? text.slice(0, MAX_CHARS) + `\n… truncated (${text.length - MAX_CHARS} more characters). Narrow the request with filters, per_page or a shorter range.`
    : text;
}
