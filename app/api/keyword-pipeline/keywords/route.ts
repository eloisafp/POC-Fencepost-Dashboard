import { NextRequest } from 'next/server'
import { supabaseServer } from '../../../../lib/keyword-pipeline/server'
import { ahrefsGet, todayStr, toDomain, intentLabel } from '../../../../lib/keyword-pipeline/ahrefs'

// POST { run_id: number } -> { total_keywords, by_source, existing_pages_count, warnings }
//
// Phase 2 — Ahrefs keyword fetching. Three jobs:
//   Job A — seed expansion: matching-terms + related-terms per service seed batch, source "Matching Terms" / "Related Terms"
//   Job B — competitor gap: organic-keywords per competitor domain, source "Content Gap"
//   Job C — client site audit: top-pages (fallback: sitemap.xml) -> keyword_pipeline_runs.existing_pages
//
// Ahrefs charges API units per row * selected column, so limits below are deliberately
// conservative. Raise them once a run has been validated end-to-end.
const MATCHING_TERMS_LIMIT = 100 // per service (seeds batched into one call)
const RELATED_TERMS_LIMIT = 50   // per service
const ORGANIC_KEYWORDS_LIMIT = 200 // per competitor domain
const TOP_PAGES_LIMIT = 100
const MIN_VOLUME = 10
const COUNTRY = 'us'

export const maxDuration = 300

type KwRow = {
  keyword: string
  monthly_volume: number | null
  kd: number | null
  cpc: number | null // dollars
  source: string
  search_intent: string | null
  traffic_potential: number | null
}

const centsToDollars = (c: number | null | undefined) => (c === null || c === undefined ? null : Math.round(c) / 100)

export async function POST(req: NextRequest) {
  try {
    const { run_id } = await req.json()
    if (!run_id) return Response.json({ error: 'run_id is required' }, { status: 400 })

    const sb = supabaseServer()
    const { data: run, error: runError } = await sb
      .from('keyword_pipeline_runs')
      .select('intake, seeds, competitors')
      .eq('id', run_id)
      .single()
    if (runError || !run) return Response.json({ error: 'Run not found' }, { status: 404 })
    if (!run.intake) return Response.json({ error: 'Run has no parsed intake — run Phase 1 first' }, { status: 400 })
    if (!run.seeds?.seeds_by_service) return Response.json({ error: 'Run has no seeds — run Phase 1 first' }, { status: 400 })

    const warnings: string[] = []
    const date = todayStr()
    const dedup = new Map<string, KwRow>()
    const addRow = (row: KwRow) => {
      const key = row.keyword.toLowerCase().trim()
      if (!key) return
      const existing = dedup.get(key)
      if (!existing) { dedup.set(key, row); return }
      // First source wins (job order = priority); backfill metrics the earlier source lacked
      existing.monthly_volume ??= row.monthly_volume
      existing.kd ??= row.kd
      existing.cpc ??= row.cpc
      existing.search_intent ??= row.search_intent
      existing.traffic_potential ??= row.traffic_potential
    }

    // ---- Job A: seed expansion, one matching-terms + one related-terms call per service ----
    const seedsByService: Record<string, string[]> = run.seeds.seeds_by_service
    for (const [service, seeds] of Object.entries(seedsByService)) {
      if (!seeds?.length) continue
      const keywords = seeds.join(',')
      const volumeFilter = JSON.stringify({ field: 'volume', is: ['gte', MIN_VOLUME] })

      try {
        const mt = await ahrefsGet('/keywords-explorer/matching-terms', {
          select: 'keyword,volume,difficulty,cpc,traffic_potential,intents',
          country: COUNTRY,
          keywords,
          limit: MATCHING_TERMS_LIMIT,
          order_by: 'volume:desc',
          where: volumeFilter,
        })
        for (const k of mt.keywords || []) {
          if (k.intents?.branded) continue
          addRow({
            keyword: k.keyword,
            monthly_volume: k.volume ?? null,
            kd: k.difficulty ?? null,
            cpc: centsToDollars(k.cpc),
            source: 'Matching Terms',
            search_intent: intentLabel(k.intents),
            traffic_potential: k.traffic_potential ?? null,
          })
        }
      } catch (e: any) {
        warnings.push(`matching-terms (${service}): ${e.message}`)
      }

      try {
        const rt = await ahrefsGet('/keywords-explorer/related-terms', {
          select: 'keyword,volume,difficulty,cpc,traffic_potential,intents',
          country: COUNTRY,
          keywords,
          view_for: 'top_10',
          terms: 'also_rank_for',
          limit: RELATED_TERMS_LIMIT,
          order_by: 'volume:desc',
          where: volumeFilter,
        })
        for (const k of rt.keywords || []) {
          if (k.intents?.branded) continue
          addRow({
            keyword: k.keyword,
            monthly_volume: k.volume ?? null,
            kd: k.difficulty ?? null,
            cpc: centsToDollars(k.cpc),
            source: 'Related Terms',
            search_intent: intentLabel(k.intents),
            traffic_potential: k.traffic_potential ?? null,
          })
        }
      } catch (e: any) {
        warnings.push(`related-terms (${service}): ${e.message}`)
      }
    }

    // ---- Job B: competitor gap via organic-keywords per competitor domain ----
    const competitors: { name?: string; domain?: string }[] = run.competitors?.competitors || []
    for (const comp of competitors) {
      if (!comp.domain) continue
      try {
        const ok = await ahrefsGet('/site-explorer/organic-keywords', {
          select: 'keyword,volume,keyword_difficulty,cpc,best_position,sum_traffic',
          target: comp.domain,
          mode: 'subdomains',
          country: COUNTRY,
          date,
          limit: ORGANIC_KEYWORDS_LIMIT,
          order_by: 'sum_traffic_merged:desc',
          where: JSON.stringify({
            and: [
              { field: 'volume', is: ['gte', MIN_VOLUME] },
              { field: 'best_position', is: ['lte', 20] },
              { field: 'is_branded', is: ['eq', false] },
            ],
          }),
        })
        for (const k of ok.keywords || []) {
          if (!k.keyword) continue
          addRow({
            keyword: k.keyword,
            monthly_volume: k.volume ?? null,
            kd: k.keyword_difficulty ?? null,
            cpc: centsToDollars(k.cpc),
            source: 'Content Gap',
            search_intent: null,
            traffic_potential: null,
          })
        }
      } catch (e: any) {
        warnings.push(`organic-keywords (${comp.domain}): ${e.message}`)
      }
    }

    // ---- Job C: client site audit -> existing_pages ----
    let existingPages: any[] = []
    const clientDomain = run.intake.website_url ? toDomain(run.intake.website_url) : null
    if (!clientDomain) {
      warnings.push('No website_url in intake — skipped existing pages audit')
    } else {
      try {
        const tp = await ahrefsGet('/site-explorer/top-pages', {
          select: 'url,sum_traffic,keywords,top_keyword,top_keyword_volume,top_keyword_best_position',
          target: clientDomain,
          mode: 'subdomains',
          country: COUNTRY,
          date,
          limit: TOP_PAGES_LIMIT,
          order_by: 'sum_traffic_merged:desc',
        })
        existingPages = (tp.pages || []).filter((p: any) => p.url).map((p: any) => ({
          url: p.url,
          traffic: p.sum_traffic ?? 0,
          keywords: p.keywords ?? 0,
          top_keyword: p.top_keyword ?? null,
          top_keyword_volume: p.top_keyword_volume ?? null,
          top_keyword_position: p.top_keyword_best_position ?? null,
          source: 'ahrefs_top_pages',
          // Export's Keyword Map tab only includes flagged pages; homepage excluded
          include_in_keyword_map: p.url.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '') !== '',
        }))
      } catch (e: any) {
        warnings.push(`top-pages (${clientDomain}): ${e.message}`)
      }

      // Fallback: sitemap crawl so Phase 4 can still dedupe against existing URLs
      if (existingPages.length === 0) {
        try {
          const res = await fetch(`https://${clientDomain}/sitemap.xml`, { signal: AbortSignal.timeout(15000) })
          if (res.ok) {
            const xml = await res.text()
            const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1])
            existingPages = locs
              .filter(u => !u.endsWith('.xml')) // skip sitemap-index child sitemaps
              .slice(0, 200)
              .map(url => ({
                url,
                source: 'sitemap',
                include_in_keyword_map: url.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '') !== '',
              }))
            if (existingPages.length) warnings.push('Ahrefs top-pages returned nothing — used sitemap.xml fallback (URLs only, no traffic data)')
          }
        } catch {
          warnings.push(`Could not fetch sitemap.xml from ${clientDomain}`)
        }
      }
    }

    const rows = [...dedup.values()]
    if (rows.length === 0) {
      return Response.json({ error: `Ahrefs returned no keywords. ${warnings.join(' | ') || 'Check seeds and competitor domains.'}` }, { status: 502 })
    }

    // Replace any previous fetch for this run, then insert in chunks
    await sb.from('keyword_pipeline_keywords').delete().eq('run_id', run_id)
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map(r => ({ ...r, run_id }))
      const { error: insErr } = await sb.from('keyword_pipeline_keywords').insert(chunk)
      if (insErr) throw insErr
    }

    const { error: updErr } = await sb
      .from('keyword_pipeline_runs')
      .update({ existing_pages: existingPages, phase: 'keywords', updated_at: new Date().toISOString() })
      .eq('id', run_id)
    if (updErr) throw updErr

    const bySource: Record<string, number> = {}
    for (const r of rows) bySource[r.source] = (bySource[r.source] || 0) + 1

    return Response.json({
      total_keywords: rows.length,
      by_source: bySource,
      existing_pages_count: existingPages.length,
      warnings,
    })
  } catch (err: any) {
    console.error('keyword-pipeline/keywords error:', err)
    return Response.json({ error: err.message || 'Failed to fetch keywords' }, { status: 500 })
  }
}
