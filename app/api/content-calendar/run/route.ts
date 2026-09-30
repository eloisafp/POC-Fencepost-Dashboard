import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import { supabaseServer, fetchGoogleDocText, callClaude } from '../../../../lib/keyword-pipeline/server'
import { ahrefsGet, getRemainingUnits, todayStr, toDomain, intentLabel } from '../../../../lib/keyword-pipeline/ahrefs'

// POST { client_id, blogs_per_month, notes, notes_source, seeds[], competitors[],
//        check_competitors, strategic_angle, excluded_topics[] }
// -> { round_id, items, pool_size, competitors, warnings, excluded, units_used }
//
// The Content Calendar run: resolve competitors -> Ahrefs fetch (seed expansion +
// competitor gap) -> filter to the team's thresholds -> exclude existing/prior
// content -> plan N x 12 posts in quarterly batches with seasonality.
export const maxDuration = 300

// Team thresholds (from the seo-kw-content-calendar skill)
const MIN_VOLUME = 100
const KD_TARGET = 40          // preferred ceiling
const KD_RELAXED = 55         // fallback when the pool is too thin, flagged in warnings
const MIN_UNITS_REQUIRED = 80000
const MAX_COMPETITORS = 3
const COUNTRY = 'us'

const MATCHING_LIMIT = 200
const RELATED_LIMIT = 100
const COMPETITOR_KW_LIMIT = 200
const TOP_PAGES_LIMIT = 100

const DIRECTORY_RE = /(yelp|angi|angieslist|homeadvisor|thumbtack|bbb|facebook|houzz|porch|yellowpages|mapquest|manta|nextdoor|reddit|wikipedia|amazon|pinterest|instagram|youtube|linkedin|tripadvisor|indeed)\./i

const centsToDollars = (c: number | null | undefined) => (c === null || c === undefined ? null : Math.round(c) / 100)

// Ahrefs intent -> the team's MOFU/BOFU vocabulary. Navigational/branded are dropped.
function toFunnel(intent: string | null): 'MOFU' | 'BOFU' | null {
  if (!intent) return 'MOFU' // unlabelled informational-ish terms still make usable blog topics
  if (intent === 'informational') return 'MOFU'
  if (intent === 'commercial' || intent === 'transactional' || intent === 'local') return 'BOFU'
  return null // navigational, branded
}

type Kw = {
  keyword: string
  volume: number | null
  kd: number | null
  cpc: number | null
  intent: 'MOFU' | 'BOFU'
  source: string
  competitor: string | null
}

function monthLabels(count: number): string[] {
  const out: string[] = []
  const d = new Date(); d.setDate(1)
  for (let i = 0; i < count; i++) {
    out.push(d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

export async function POST(req: NextRequest) {
  const sb = supabaseServer()
  try {
    const body = await req.json()
    const clientId = body.client_id
    const blogsPerMonth = Math.max(1, Math.min(10, Number(body.blogs_per_month) || 2))
    const notes = String(body.notes || '').trim()
    const notesSource = body.notes_source === 'client' ? 'client' : 'strategist'
    const seedList: string[] = (Array.isArray(body.seeds) ? body.seeds : [])
      .map((s: any) => String(typeof s === 'string' ? s : s?.keyword || '').trim())
      .filter(Boolean)
    const excludedTopics: string[] = Array.isArray(body.excluded_topics) ? body.excluded_topics.map(String) : []
    const strategicAngle = String(body.strategic_angle || '')
    const checkCompetitors = !!body.check_competitors

    if (!clientId) return Response.json({ error: 'client_id is required' }, { status: 400 })
    if (seedList.length === 0) return Response.json({ error: 'At least one seed keyword is required' }, { status: 400 })

    const { data: client } = await sb
      .from('master_clients')
      .select('client_name, website_url, niche, intake_form_link, content_guidelines_url')
      .eq('id', clientId).single()
    if (!client) return Response.json({ error: 'Client not found' }, { status: 404 })

    const warnings: string[] = []
    const excluded: { topic: string; reason: string }[] = excludedTopics.map(t => ({ topic: t, reason: 'Excluded by the brief' }))
    const clientDomain = client.website_url ? toDomain(client.website_url) : null

    // ---- Ahrefs credit guard -------------------------------------------------
    let unitsBefore = Infinity
    try {
      unitsBefore = await getRemainingUnits()
      if (unitsBefore < MIN_UNITS_REQUIRED) {
        return Response.json({
          error: `Not enough Ahrefs API units: ${unitsBefore.toLocaleString()} remaining, ${MIN_UNITS_REQUIRED.toLocaleString()} required. Reload credits and try again.`,
          insufficient_credits: true,
        }, { status: 402 })
      }
    } catch (e: any) {
      warnings.push(`Could not read Ahrefs usage: ${e.message}`)
    }

    // ---- Competitors ---------------------------------------------------------
    let competitors: { name: string; domain: string; auto: boolean }[] = (Array.isArray(body.competitors) ? body.competitors : [])
      .map((c: any) => ({ name: String(c?.name || c?.domain || '').trim(), domain: toDomain(String(c?.domain || '')), auto: false }))
      .filter((c: any) => c.domain && !DIRECTORY_RE.test(c.domain))
      .slice(0, MAX_COMPETITORS)

    if (checkCompetitors && competitors.length === 0) {
      // Auto-derive from who ranks for the notes-driven seeds (not the client's
      // general service list) — that's the competitive set the brief refers to.
      const tally = new Map<string, number>()
      for (const seed of seedList.slice(0, 3)) {
        try {
          const serp = await ahrefsGet('/serp-overview/serp-overview', {
            select: 'position,url,title', country: COUNTRY, keyword: seed, type: 'organic', top_positions: 10,
          })
          for (const p of serp.positions || []) {
            if (!p.url) continue
            const d = toDomain(p.url)
            if (!d || DIRECTORY_RE.test(d)) continue
            if (clientDomain && d.endsWith(clientDomain)) continue
            tally.set(d, (tally.get(d) || 0) + 1)
          }
        } catch (e: any) { warnings.push(`Competitor discovery (${seed}): ${e.message}`) }
      }
      competitors = [...tally.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, MAX_COMPETITORS)
        .map(([domain]) => ({ name: domain, domain, auto: true }))
      if (competitors.length === 0) warnings.push('No competitors could be auto-derived from the seed SERPs.')
    }

    // ---- Keyword fetch -------------------------------------------------------
    // Fetch at the relaxed KD ceiling so we can tighten to 40 locally without a
    // second billed call; volume floor is applied server-side to cut billed rows.
    const dedup = new Map<string, Kw>()
    const addKw = (row: Kw) => {
      const key = row.keyword.toLowerCase().trim()
      if (!key || dedup.has(key)) return
      dedup.set(key, row)
    }
    const KE_SELECT = 'keyword,volume,difficulty,cpc,intents'
    const keWhere = JSON.stringify({
      and: [
        { field: 'volume', is: ['gte', MIN_VOLUME] },
        { field: 'difficulty', is: ['lte', KD_RELAXED] },
      ],
    })

    // Seed expansion — seeds batched into one call per endpoint
    const seedsParam = seedList.join(',')
    try {
      const mt = await ahrefsGet('/keywords-explorer/matching-terms', {
        select: KE_SELECT, country: COUNTRY, keywords: seedsParam,
        limit: MATCHING_LIMIT, order_by: 'volume:desc', where: keWhere,
      })
      for (const k of mt.keywords || []) {
        if (k.intents?.branded) continue
        const funnel = toFunnel(intentLabel(k.intents))
        if (!funnel) continue
        addKw({ keyword: k.keyword, volume: k.volume ?? null, kd: k.difficulty ?? null, cpc: centsToDollars(k.cpc), intent: funnel, source: 'Seed expansion', competitor: null })
      }
    } catch (e: any) { warnings.push(`matching-terms: ${e.message}`) }

    try {
      const rt = await ahrefsGet('/keywords-explorer/related-terms', {
        select: KE_SELECT, country: COUNTRY, keywords: seedsParam, view_for: 'top_10', terms: 'also_rank_for',
        limit: RELATED_LIMIT, order_by: 'volume:desc', where: keWhere,
      })
      for (const k of rt.keywords || []) {
        if (k.intents?.branded) continue
        const funnel = toFunnel(intentLabel(k.intents))
        if (!funnel) continue
        addKw({ keyword: k.keyword, volume: k.volume ?? null, kd: k.difficulty ?? null, cpc: centsToDollars(k.cpc), intent: funnel, source: 'Seed expansion', competitor: null })
      }
    } catch (e: any) { warnings.push(`related-terms: ${e.message}`) }

    // Competitor gap — keywords each rival ranks for in the top 20
    const date = todayStr()
    for (const comp of competitors) {
      try {
        const ok = await ahrefsGet('/site-explorer/organic-keywords', {
          select: 'keyword,volume,keyword_difficulty,cpc,best_position',
          target: comp.domain, mode: 'subdomains', country: COUNTRY, date,
          limit: COMPETITOR_KW_LIMIT, order_by: 'volume:desc',
          where: JSON.stringify({
            and: [
              { field: 'volume', is: ['gte', MIN_VOLUME] },
              { field: 'keyword_difficulty', is: ['lte', KD_RELAXED] },
              { field: 'best_position', is: ['lte', 20] },
              { field: 'is_branded', is: ['eq', false] },
            ],
          }),
        })
        for (const k of ok.keywords || []) {
          if (!k.keyword) continue
          addKw({
            keyword: k.keyword, volume: k.volume ?? null, kd: k.keyword_difficulty ?? null,
            cpc: centsToDollars(k.cpc), intent: 'BOFU', source: 'Competitor gap', competitor: comp.domain,
          })
        }
      } catch (e: any) { warnings.push(`organic-keywords (${comp.domain}): ${e.message}`) }
    }

    // ---- Exclusions: pages they already have + prior rounds -------------------
    const existingTitles: string[] = []
    if (clientDomain) {
      try {
        const tp = await ahrefsGet('/site-explorer/top-pages', {
          select: 'url,sum_traffic,top_keyword', target: clientDomain, mode: 'subdomains',
          country: COUNTRY, date, limit: TOP_PAGES_LIMIT, order_by: 'sum_traffic:desc',
        })
        for (const p of tp.pages || []) {
          if (p.top_keyword) existingTitles.push(String(p.top_keyword).toLowerCase())
          if (p.url) existingTitles.push(String(p.url).toLowerCase())
        }
      } catch (e: any) { warnings.push(`top-pages: ${e.message}`) }
    }

    const { data: priorItems } = await sb
      .from('content_calendar_items')
      .select('keyword, blog_title, round_id, content_calendar_rounds!inner(master_client_id)')
      .eq('content_calendar_rounds.master_client_id', clientId)
    const priorKeywords = new Set((priorItems || []).map((r: any) => String(r.keyword).toLowerCase()))
    const alreadyUsed: { keyword: string; title: string }[] = (priorItems || []).map((r: any) => ({ keyword: r.keyword, blog_title: r.blog_title })) as any

    let pool = [...dedup.values()].filter(k => {
      const low = k.keyword.toLowerCase()
      if (priorKeywords.has(low)) return false
      if (existingTitles.some(t => t.includes(low))) return false
      if (excludedTopics.some(t => t && low.includes(String(t).toLowerCase()))) return false
      return true
    })

    // Team rule: prefer KD <= 40; relax to 55 only when the pool is too thin, and flag it
    const totalPosts = blogsPerMonth * 12
    const tight = pool.filter(k => (k.kd ?? 0) <= KD_TARGET)
    if (tight.length >= totalPosts) {
      pool = tight
    } else if (pool.length > tight.length) {
      warnings.push(`Only ${tight.length} keywords met KD <= ${KD_TARGET}; relaxed to KD <= ${KD_RELAXED} to fill ${totalPosts} posts.`)
    }
    pool.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))

    if (pool.length === 0) {
      return Response.json({ error: 'No keywords survived filtering. Try broader seeds, or lower the volume floor.', warnings }, { status: 404 })
    }
    if (pool.length < totalPosts) {
      warnings.push(`Keyword pool has ${pool.length} usable terms for ${totalPosts} planned posts; the remainder will be filled with topical articles.`)
    }

    // ---- Client context for the planner --------------------------------------
    let guidelinesText = '', services: string[] = [], primaryLocation = ''
    if (client.content_guidelines_url) {
      try { guidelinesText = (await fetchGoogleDocText(client.content_guidelines_url)).slice(0, 4000) } catch { /* optional */ }
    }
    if (client.intake_form_link) {
      try {
        const text = (await fetchGoogleDocText(client.intake_form_link)).slice(0, 6000)
        const parsed = await callClaude('Extract services and primary city. Return ONLY JSON: {"services":["..."],"primary_location":"City, ST"}.', text, 512)
        if (Array.isArray(parsed?.services)) services = parsed.services.map((s: any) => String(s)).slice(0, 20)
        primaryLocation = String(parsed?.primary_location || '')
      } catch { /* optional */ }
    }

    // ---- Plan quarter by quarter --------------------------------------------
    const prompt = fs.readFileSync(path.join(process.cwd(), 'lib/content-calendar/prompts', 'calendar-planner.md'), 'utf-8')
    const months = monthLabels(12)
    const planned: any[] = []
    const usedKw = new Set<string>()

    for (let q = 0; q < 4; q++) {
      const qMonths = months.slice(q * 3, q * 3 + 3)
      const need = blogsPerMonth * 3
      const available = pool.filter(k => !usedKw.has(k.keyword.toLowerCase())).slice(0, Math.max(need * 6, 60))
      try {
        const res = await callClaude(prompt, JSON.stringify({
          client_name: client.client_name, niche: client.niche || '', primary_location: primaryLocation,
          website_url: client.website_url || '', services, guidelines: guidelinesText,
          strategic_angle: strategicAngle, notes,
          months: qMonths, posts_needed: need,
          keywords: available.map(k => ({ keyword: k.keyword, volume: k.volume, kd: k.kd, cpc: k.cpc, intent: k.intent, source: k.source, competitor: k.competitor })),
          already_used: [...alreadyUsed, ...planned.map(p => ({ keyword: p.keyword, blog_title: p.blog_title }))],
        }), 4096)

        for (const it of (res?.items || [])) {
          const kw = String(it?.keyword || '').trim()
          if (!kw || usedKw.has(kw.toLowerCase())) continue
          usedKw.add(kw.toLowerCase())
          const match = pool.find(k => k.keyword.toLowerCase() === kw.toLowerCase())
          const label = qMonths.includes(it?.month_label) ? it.month_label : qMonths[planned.length % qMonths.length]
          planned.push({
            month_index: months.indexOf(label) + 1,
            month_label: label,
            keyword: kw,
            blog_title: String(it?.blog_title || '').trim(),
            why_useful: String(it?.why_useful || '').trim(),
            intent: it?.intent === 'BOFU' ? 'BOFU' : 'MOFU',
            volume: match?.volume ?? null,
            kd: match?.kd ?? null,
            cpc: match?.cpc ?? null,
            source: String(it?.source || match?.source || 'Topical fill'),
            competitor: it?.competitor || match?.competitor || null,
          })
        }
      } catch (e: any) {
        warnings.push(`Planning ${qMonths[0]}–${qMonths[2]}: ${e.message}`)
      }
    }

    if (planned.length === 0) {
      return Response.json({ error: 'The planner returned no posts. Try re-running.', warnings }, { status: 502 })
    }
    planned.sort((a, b) => a.month_index - b.month_index)

    // ---- Persist -------------------------------------------------------------
    let unitsUsed = 0
    try { const after = await getRemainingUnits(); unitsUsed = Math.max(0, Math.round(unitsBefore - after)) } catch { /* ignore */ }

    const { data: round, error: roundErr } = await sb.from('content_calendar_rounds').insert({
      master_client_id: clientId, client_name: client.client_name, blogs_per_month: blogsPerMonth,
      notes, notes_source: notesSource, seeds: seedList, competitors, keyword_pool: pool.slice(0, 500),
      excluded, warnings, ahrefs_units_used: unitsUsed,
    }).select('id').single()
    if (roundErr || !round) throw new Error(roundErr?.message || 'Could not save the round')

    const { error: itemsErr } = await sb.from('content_calendar_items')
      .insert(planned.map(p => ({ ...p, round_id: round.id })))
    if (itemsErr) throw itemsErr

    const mofu = planned.filter(p => p.intent === 'MOFU').length
    return Response.json({
      round_id: round.id, items: planned, pool_size: pool.length, competitors, warnings, excluded,
      units_used: unitsUsed, summary: { total: planned.length, mofu, bofu: planned.length - mofu, pool: pool.length },
    })
  } catch (err: any) {
    console.error('content-calendar/run error:', err)
    return Response.json({ error: err.message || 'Content calendar run failed' }, { status: 500 })
  }
}
