// Ahrefs REST API v3 helper. Field names verified against the official
// OpenAPI docs (docs.ahrefs.com/docs/api/reference). Notes that matter:
//   - cpc is returned in USD cents on every endpoint — convert before storing
//   - volume/difficulty/traffic_potential each cost ~10 API units per row,
//     so keep `limit` conservative and filter with `where` server-side
//   - site-explorer endpoints require a `date` (YYYY-MM-DD)

const BASE = 'https://api.ahrefs.com/v3'

export async function ahrefsGet(endpoint: string, params: Record<string, string | number | undefined>): Promise<any> {
  const key = process.env.AHREFS_API_KEY
  if (!key) throw new Error('AHREFS_API_KEY not set in .env.local')

  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v))
  }

  const res = await fetch(`${BASE}${endpoint}?${qs}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Ahrefs ${endpoint} failed (${res.status}): ${body.slice(0, 300)}`)
  }
  return res.json()
}

// Remaining API units across both the workspace and this API key's own cap
// (null limit = unlimited). The limits-and-usage call itself costs no units.
export async function getRemainingUnits(): Promise<number> {
  const res = await ahrefsGet('/subscription-info/limits-and-usage', {})
  const u = res.limits_and_usage
  if (!u) throw new Error('Ahrefs did not return usage info')
  const workspaceLeft = u.units_limit_workspace == null ? Infinity : u.units_limit_workspace - (u.units_usage_workspace ?? 0)
  const apiKeyLeft = u.units_limit_api_key == null ? Infinity : u.units_limit_api_key - (u.units_usage_api_key ?? 0)
  return Math.min(workspaceLeft, apiKeyLeft)
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// "https://www.example.com/path" -> "example.com" (mode=subdomains covers www)
export function toDomain(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim()
}

// Ahrefs intents object -> single label for the search_intent column
export function intentLabel(intents: any): string | null {
  if (!intents) return null
  if (intents.local) return 'local'
  if (intents.transactional) return 'transactional'
  if (intents.commercial) return 'commercial'
  if (intents.informational) return 'informational'
  if (intents.navigational) return 'navigational'
  if (intents.branded) return 'branded'
  return null
}
