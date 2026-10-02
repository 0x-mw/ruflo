/**
 * A tool caller may select task data, never the destination of operator secrets.
 * Retain URL arguments as compatibility assertions against trusted process config.
 * Exact base matching also prevents caller-selected paths on a trusted origin.
 */
export function configuredServiceUrl(configured: string, override: unknown, setting: string): string {
  const normalize = (value: unknown): string => {
    if (typeof value !== 'string' || !value || value !== value.trim()) {
      throw new Error(`${setting}: expected a configured HTTPS base URL`);
    }
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error(`${setting}: expected a configured HTTPS base URL`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error(`${setting}: configured base URL must use HTTPS without credentials, query or fragment`);
    }
    return url.href.replace(/\/+$/, '');
  };
  const base = normalize(configured);
  if (override !== undefined && normalize(override) !== base) {
    throw new Error(`${setting}: tool URL must match the configured service; configure the MCP server environment to change destinations`);
  }
  return base;
}
