import { NextRequest } from 'next/server'
import { supabaseServer, loadPrompt, callClaude } from '../../../../lib/keyword-pipeline/server'

// POST { run_id: number } -> { seeds: {...} }
// Reads intake jsonb straight off the run row. Seeds are persisted to
// keyword_pipeline_runs.seeds so Phase 2 (keywords) can read them after a refresh.
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

    if (!run.intake) {
      return Response.json({ error: 'Run has no parsed intake yet — run the intake step first' }, { status: 400 })
    }

    const seeds = await callClaude(loadPrompt('seed-extractor.md'), JSON.stringify(run.intake))

    const { error: updateError } = await sb
      .from('keyword_pipeline_runs')
      .update({ seeds, updated_at: new Date().toISOString() })
      .eq('id', run_id)
    if (updateError) throw updateError

    return Response.json({ seeds })
  } catch (err: any) {
    console.error('keyword-pipeline/seeds error:', err)
    return Response.json({ error: err.message || 'Failed to generate seeds' }, { status: 500 })
  }
}
