import { NextRequest } from 'next/server'

// Increase timeout for Vercel Pro deployments
export const maxDuration = 300

const BATCH   = 10    // concurrent page fetches
const MAX     = 500   // max pages to return
const TIMEOUT = 8_000 // ms per fetch

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept': 'text/html,application/xhtml+xml,application/xml',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function timedFetch(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t    = setTimeout(() => ctrl.abort(), TIMEOUT)
    const res  = await fetch(url, { headers: HEADERS, signal: ctrl.signal })
    clearTimeout(t)
    return res.ok ? res.text() : null
  } catch {
    return null
  }
}

function extractMeta(html: string): { title: string; description: string } {
  const title = (
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
  ).replace(/\s+/g, ' ').trim()

  const description = (
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)[^>]+name=["']description["']/i)
  )?.[1]?.trim() ?? ''

  return { title, description }
}

function extractLinks(html: string, origin: string): string[] {
  const seen = new Set<string>()
  for (const [, href] of html.matchAll(/href=["']([^"']+)/gi)) {
    try {
      const u = new URL(href, origin)
      if (u.origin === origin) {
        const clean = u.origin + (u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, ''))
        seen.add(clean)
      }
    } catch { /* invalid URL — skip */ }
  }
  return [...seen]
}

// ── Sitemap parser ─────────────────────────────────────────────────────────────

async function getSitemapUrls(origin: string): Promise<string[]> {
  const candidates: string[] = []

  // Check robots.txt for Sitemap: directive
  const robots = await timedFetch(`${origin}/robots.txt`)
  if (robots) {
    for (const [, u] of robots.matchAll(/^Sitemap:\s*(\S+)/gim)) {
      candidates.push(u.trim())
    }
  }

  // Common sitemap locations
  candidates.push(
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap/sitemap.xml`,
    `${origin}/wp-sitemap.xml`,       // WordPress
    `${origin}/page-sitemap.xml`,     // Yoast pages
  )

  for (const candidate of candidates) {
    const xml = await timedFetch(candidate)
    if (!xml) continue

    // Sitemap index — contains links to other sitemaps
    if (xml.includes('<sitemapindex')) {
      const subUrls = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)].map(m => m[1])
      const collected: string[] = []

      for (const sub of subUrls.slice(0, 10)) {
        const subXml = await timedFetch(sub)
        if (!subXml) continue
        const urls = [...subXml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)].map(m => m[1])
        collected.push(...urls)
        if (collected.length >= MAX) break
      }

      if (collected.length > 0) return collected.slice(0, MAX)
      continue
    }

    // Regular sitemap
    if (xml.includes('<urlset')) {
      const urls = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)].map(m => m[1])
      if (urls.length > 0) return urls.slice(0, MAX)
    }
  }

  return []
}

// ── Meta fetcher (for sitemap URLs) ───────────────────────────────────────────

async function fetchMetaForUrls(urls: string[]) {
  const results: Array<{ url: string; meta_title: string; meta_description: string }> = []

  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = await Promise.allSettled(
      urls.slice(i, i + BATCH).map(async url => {
        const html = await timedFetch(url)
        if (!html) return { url, meta_title: '', meta_description: '' }
        const { title, description } = extractMeta(html)
        return { url, meta_title: title, meta_description: description }
      })
    )
    for (const r of batch) {
      if (r.status === 'fulfilled') results.push(r.value)
    }
  }

  return results
}

// ── Crawl fallback (no sitemap) ────────────────────────────────────────────────

async function crawlSite(origin: string) {
  const visited = new Set<string>()
  const queue   = [origin + '/']
  const results: Array<{ url: string; meta_title: string; meta_description: string }> = []

  while (queue.length > 0 && results.length < MAX) {
    const batch = queue.splice(0, BATCH)

    await Promise.all(batch.map(async url => {
      if (visited.has(url) || results.length >= MAX) return
      visited.add(url)

      const html = await timedFetch(url)
      if (!html) return

      const { title, description } = extractMeta(html)
      results.push({ url, meta_title: title, meta_description: description })

      for (const link of extractLinks(html, origin)) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link)
      }
    }))
  }

  return results
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    if (!url) return Response.json({ error: 'url is required' }, { status: 400 })

    const origin = new URL(url.startsWith('http') ? url : `https://${url}`).origin

    // Try sitemap first
    const sitemapUrls = await getSitemapUrls(origin)

    if (sitemapUrls.length > 0) {
      const results = await fetchMetaForUrls(sitemapUrls)
      return Response.json({ results, source: 'sitemap', total: results.length })
    }

    // Fallback: crawl the site
    const results = await crawlSite(origin)
    return Response.json({ results, source: 'crawl', total: results.length })

  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
