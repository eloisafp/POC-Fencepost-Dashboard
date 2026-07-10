import { NextRequest } from 'next/server'
import { supabaseServer, loadPrompt, callClaude } from '../../../../lib/keyword-pipeline/server'

// POST { run_id: number, seeds: {...} } -> { competitors: {...}, needs_manual_entry: boolean }
// Resolves the client's named competitors via prompts/competitor-resolver.md. When
// intake.json named 0-1 clean (non-directory) competitors, the CLI pipeline fell back
// to an agentic WebSearch call — a server route has no equivalent, so this returns
// needs_manual_entry: true and leaves the human to add competitors in the UI instead.
export async function POST(req: NextRequest) {
  try {
    const { run_id, seeds: bodySeeds } = await req.json()
    if (!run_id) return Response.json({ error: 'run_id is required' }, { status: 400 })

    const sb = supabaseServer()

    const { data: run, error: runError } = await sb
      .from('keyword_pipeline_runs')
      .select('intake, seeds')
      .eq('id', run_id)
      .single()
    if (runError || !run) return Response.json({ error: 'Run not found' }, { status: 404 })

    const seeds = bodySeeds || run.seeds
    if (!seeds) return Response.json({ error: 'seeds is required — run the seeds step first' }, { status: 400 })

    if (!run.intake) {
      return Response.json({ error: 'Run has no parsed intake yet — run the intake step first' }, { status: 400 })
    }

    const competitors = await callClaude(
      loadPrompt('competitor-resolver.md'),
      JSON.stringify({ intake: run.intake, seeds })
    )

    const { error: updateError } = await sb
      .from('keyword_pipeline_runs')
      .update({ competitors, updated_at: new Date().toISOString() })
      .eq('id', run_id)
    if (updateError) throw updateError

    return Response.json({ competitors, needs_manual_entry: !!competitors.has_auto_derived })
  } catch (err: any) {
    console.error('keyword-pipeline/competitors error:', err)
    return Response.json({ error: err.message || 'Failed to resolve competitors' }, { status: 500 })
  }
}
