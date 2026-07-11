import { NextRequest } from 'next/server'
import { supabaseServer, loadPrompt, callClaude } from '../../../../lib/keyword-pipeline/server'

// POST { run_id: number } -> { total_items, blog_count, location_count, optimize_count, warnings }
//
// Phase 4 — content plan generation. Zero Ahrefs calls.
//   Job A — one blog post per cluster (Claude), applying content_guidelines
//           tone/voice + avoid-list when present
//   Job B — location pages, deterministic service x service_area loop (no Claude):
//           "[Service] in [City, ST]" per combination
//   Job C — content audit: match each item against existing_pages URLs, set
//           page_status ('new'|'optimize') and existing_url

export const maxDuration = 300

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

type PlanRow = {
  run_id: number
  cluster_id: number | null
  type: string
  content_track: string
  title: string
  service_category: string | null
  primary_keyword: string | null
  target_keywords: string[]
  volume: number | null
  kd: number | null
  angle: string | null
  city: string | null
  state: string | null
  page_status: string
  existing_url: string | null
}

export async function POST(req: NextRequest) {
  try {
    const { run_id } = await req.json()
    if (!run_id) return Response.json({ error: 'run_id is required' }, { status: 400 })

    const sb = supabaseServer()

    const { data: run, error: runError } = await sb
      .from('keyword_pipeline_runs')
      .select('intake, content_guidelines, existing_pages')
      .eq('id', run_id)
      .single()
    if (runError || !run) return Response.json({ error: 'Run not found' }, { status: 404 })
    if (!run.intake) return Response.json({ error: 'Run has no parsed intake — run Phase 1 first' }, { status: 400 })

    const [{ data: clusters }, { data: kws }] = await Promise.all([
      sb.from('keyword_pipeline_clusters').select('id, slug, label, service_category').eq('run_id', run_id),
      sb.from('keyword_pipeline_keywords').select('id, cluster_id, keyword, monthly_volume, kd, search_intent').eq('run_id', run_id).limit(5000),
    ])
    if (!clusters?.length) return Response.json({ error: 'No clusters for this run — run Phase 3 first' }, { status: 400 })

    const warnings: string[] = []
    const keywords = kws || []
    const kwByText = new Map(keywords.map(k => [k.keyword.toLowerCase(), k]))
    const rows: PlanRow[] = []

    // ---- Job A: one blog post per cluster via Claude ----
    const guidelines = run.content_guidelines?.has_guidelines ? run.content_guidelines : null
    const payload = {
      primary_location: run.intake.primary_location || null,
      services: (run.intake.services || []).map((s: any) => ({ name: s.name, slug: s.slug })),
      guidelines,
      clusters: clusters.map(c => ({
        id: c.id,
        label: c.label,
        service_category: c.service_category,
        keywords: keywords
          .filter(k => k.cluster_id === c.id)
          .sort((a, b) => (b.monthly_volume || 0) - (a.monthly_volume || 0))
          .slice(0, 12)
          .map(k => ({ kw: k.keyword, vol: k.monthly_volume, kd: k.kd, intent: k.search_intent })),
      })).filter(c => c.keywords.length > 0),
    }

    try {
      const plan = await callClaude(loadPrompt('blog-planner.md'), JSON.stringify(payload), 8000)
      const clusterIds = new Set(clusters.map(c => c.id))
      const seenKw = new Set<string>()
      for (const item of plan?.items || []) {
        const clusterId = Number(item.cluster_id) // AI occasionally emits ids as strings
        if (!item.title || !clusterIds.has(clusterId)) continue
        const pk = (item.primary_keyword || '').toLowerCase()
        if (pk && seenKw.has(pk)) continue
        if (pk) seenKw.add(pk)
        const kwRow = kwByText.get(pk)
        const cluster = clusters.find(c => c.id === clusterId)
        rows.push({
          run_id,
          cluster_id: clusterId,
          type: 'blog_post',
          content_track: 'blog',
          title: item.title,
          service_category: cluster?.service_category ?? null,
          primary_keyword: item.primary_keyword || null,
          target_keywords: Array.isArray(item.target_keywords) ? item.target_keywords : [],
          volume: kwRow?.monthly_volume ?? null,
          kd: kwRow?.kd ?? null,
          angle: item.angle || null,
          city: run.intake.primary_location?.city ?? null,
          state: run.intake.primary_location?.state_abbr ?? null,
          page_status: 'new',
          existing_url: null,
        })
      }
      if (rows.length === 0) warnings.push('Blog planner returned no usable items')
      else if (rows.length < 12) warnings.push(`Blog planner returned ${rows.length} topics (minimum is 12) — consider re-running Phase 4`)
    } catch (e: any) {
      warnings.push(`Blog planner: ${e.message}`)
    }

    // ---- Job B: deterministic location pages (service x service_area) ----
    const services: { name: string; slug: string }[] = run.intake.services || []
    const areas: string[] = run.intake.service_areas?.length
      ? run.intake.service_areas
      : run.intake.primary_location?.city
        ? [`${run.intake.primary_location.city}, ${run.intake.primary_location.state_abbr || ''}`.replace(/, $/, '')]
        : []
    if (!areas.length) warnings.push('No service areas in intake — skipped location pages')

    for (const service of services) {
      const clusterForService = clusters.find(c => c.service_category === service.slug)
      for (const area of areas) {
        const commaIdx = area.lastIndexOf(',')
        const city = (commaIdx === -1 ? area : area.slice(0, commaIdx)).trim()
        const state = commaIdx === -1 ? null : area.slice(commaIdx + 1).trim()
        const primaryKw = `${service.name} ${city}`.toLowerCase()

        // Best matching fetched keyword: contains both a service word and the city
        const serviceWord = slugify(service.name).split('-')[0]
        const match = keywords
          .filter(k => {
            const t = k.keyword.toLowerCase()
            return t.includes(serviceWord) && t.includes(city.toLowerCase())
          })
          .sort((a, b) => (b.monthly_volume || 0) - (a.monthly_volume || 0))[0]

        rows.push({
          run_id,
          cluster_id: clusterForService?.id ?? null,
          type: 'location_page',
          content_track: 'location',
          title: `${service.name} in ${city}${state ? `, ${state}` : ''}`,
          service_category: service.slug,
          primary_keyword: match?.keyword ?? primaryKw,
          target_keywords: [],
          volume: match?.monthly_volume ?? null,
          kd: match?.kd ?? null,
          angle: null,
          city,
          state,
          page_status: 'new',
          existing_url: null,
        })
      }
    }

    if (rows.length === 0) {
      return Response.json({ error: `No content plan items could be generated. ${warnings.join(' | ')}` }, { status: 502 })
    }

    // ---- Job C: audit against existing pages ----
    const existingPages: { url?: string }[] = Array.isArray(run.existing_pages) ? run.existing_pages : []
    const urls = existingPages.map(p => (p.url || '').toLowerCase()).filter(Boolean)
    for (const row of rows) {
      const serviceSlug = row.service_category ? slugify(row.service_category) : null
      const citySlug = row.city ? slugify(row.city) : null
      const kwSlug = row.primary_keyword ? slugify(row.primary_keyword) : null

      const hit = urls.find(u => {
        if (row.content_track === 'location') {
          return !!serviceSlug && u.includes(serviceSlug) && (!citySlug || u.includes(citySlug))
        }
        return !!kwSlug && u.includes(kwSlug)
      })
      if (hit) {
        row.page_status = 'optimize'
        row.existing_url = existingPages.find(p => p.url?.toLowerCase() === hit)?.url ?? hit
      }
    }

    // Replace previous plan for this run, insert in chunks
    await sb.from('keyword_pipeline_content_plan_items').delete().eq('run_id', run_id)
    for (let i = 0; i < rows.length; i += 200) {
      const { error: insErr } = await sb.from('keyword_pipeline_content_plan_items').insert(rows.slice(i, i + 200))
      if (insErr) throw insErr
    }

    const { error: phaseErr } = await sb
      .from('keyword_pipeline_runs')
      .update({ phase: 'content_plan', updated_at: new Date().toISOString() })
      .eq('id', run_id)
    if (phaseErr) throw phaseErr

    return Response.json({
      total_items: rows.length,
      blog_count: rows.filter(r => r.content_track === 'blog').length,
      location_count: rows.filter(r => r.content_track === 'location').length,
      optimize_count: rows.filter(r => r.page_status === 'optimize').length,
      warnings,
    })
  } catch (err: any) {
    console.error('keyword-pipeline/content-plan error:', err)
    return Response.json({ error: err.message || 'Failed to generate content plan' }, { status: 500 })
  }
}
