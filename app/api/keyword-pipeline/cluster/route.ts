import { NextRequest } from 'next/server'
import { supabaseServer, loadPrompt, callClaude } from '../../../../lib/keyword-pipeline/server'

// POST { run_id: number } -> { clusters: [{ id, slug, label, service_category, count }], total_assigned, total_unassigned }
//
// Phase 3 — filter, cluster, dedupe. Pure Claude reasoning over
// keyword_pipeline_keywords rows for this run. Zero Ahrefs calls.
// Keywords are sent to Claude with their DB ids; Claude returns clusters as id
// lists, which keeps the output small and makes the backfill unambiguous.
// Keywords Claude excludes keep cluster_id = null ("Uncategorized" in export).

export const maxDuration = 300

const MAX_KEYWORDS = 2000 // safety cap on prompt size

export async function POST(req: NextRequest) {
  try {
    const { run_id } = await req.json()
    if (!run_id) return Response.json({ error: 'run_id is required' }, { status: 400 })

    const sb = supabaseServer()

    const { data: run, error: runError } = await sb
      .from('keyword_pipeline_runs')
      .select('intake')
      .eq('id', run_id)
      .single()
    if (runError || !run) return Response.json({ error: 'Run not found' }, { status: 404 })
    if (!run.intake) return Response.json({ error: 'Run has no parsed intake — run Phase 1 first' }, { status: 400 })

    const { data: kws, error: kwError } = await sb
      .from('keyword_pipeline_keywords')
      .select('id, keyword, monthly_volume, kd, search_intent, source')
      .eq('run_id', run_id)
      .order('monthly_volume', { ascending: false, nullsFirst: false })
      .limit(MAX_KEYWORDS)
    if (kwError) throw kwError
    if (!kws?.length) return Response.json({ error: 'No keywords for this run — run Phase 2 first' }, { status: 400 })

    const payload = {
      services: run.intake.services || [],
      primary_location: run.intake.primary_location || null,
      service_areas: run.intake.service_areas || [],
      keywords: kws.map(k => ({
        id: k.id,
        kw: k.keyword,
        vol: k.monthly_volume,
        kd: k.kd,
        intent: k.search_intent,
        source: k.source,
      })),
    }

    const result = await callClaude(loadPrompt('keyword-clusterer.md'), JSON.stringify(payload), 16000)
    const clusters: { slug: string; label: string; service_category: string | null; keyword_ids: number[] }[] = result?.clusters
    if (!Array.isArray(clusters) || clusters.length === 0) {
      throw new Error('AI returned no clusters. Try again.')
    }

    // Re-run safety: unlink keywords first, then remove old clusters
    await sb.from('keyword_pipeline_keywords').update({ cluster_id: null }).eq('run_id', run_id)
    await sb.from('keyword_pipeline_clusters').delete().eq('run_id', run_id)

    const validIds = new Set(kws.map(k => k.id))
    const assigned = new Set<number>()
    const summary: { id: number; slug: string; label: string; service_category: string | null; count: number }[] = []

    for (const c of clusters) {
      if (!c.slug || !c.label) continue
      const ids = (c.keyword_ids || []).filter(id => validIds.has(id) && !assigned.has(id))
      if (ids.length === 0) continue

      const { data: inserted, error: insErr } = await sb
        .from('keyword_pipeline_clusters')
        .insert({ run_id, slug: c.slug, label: c.label, service_category: c.service_category ?? null })
        .select('id')
        .single()
      if (insErr) throw insErr

      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        const { error: updErr } = await sb
          .from('keyword_pipeline_keywords')
          .update({ cluster_id: inserted.id })
          .in('id', chunk)
        if (updErr) throw updErr
      }

      ids.forEach(id => assigned.add(id))
      summary.push({ id: inserted.id, slug: c.slug, label: c.label, service_category: c.service_category ?? null, count: ids.length })
    }

    if (summary.length === 0) throw new Error('AI clusters contained no valid keyword ids. Try again.')

    const { error: phaseErr } = await sb
      .from('keyword_pipeline_runs')
      .update({ phase: 'clusters', updated_at: new Date().toISOString() })
      .eq('id', run_id)
    if (phaseErr) throw phaseErr

    return Response.json({
      clusters: summary,
      total_assigned: assigned.size,
      total_unassigned: kws.length - assigned.size,
    })
  } catch (err: any) {
    console.error('keyword-pipeline/cluster error:', err)
    return Response.json({ error: err.message || 'Failed to cluster keywords' }, { status: 500 })
  }
}
