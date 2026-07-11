import { NextRequest } from 'next/server'
import { supabaseServer, loadPrompt, fetchGoogleDocText, callClaude } from '../../../../lib/keyword-pipeline/server'

// POST { run_id: number } -> { intake: {...} }
// Loads the run's client's intake_form_link from master_clients, parses it via
// prompts/intake-parser.md, and saves the result to keyword_pipeline_runs.intake.
export async function POST(req: NextRequest) {
  try {
    const { run_id } = await req.json()
    if (!run_id) return Response.json({ error: 'run_id is required' }, { status: 400 })

    const sb = supabaseServer()

    const { data: run, error: runError } = await sb
      .from('keyword_pipeline_runs')
      .select('id, master_client_id')
      .eq('id', run_id)
      .single()
    if (runError || !run) return Response.json({ error: 'Run not found' }, { status: 404 })

    const { data: client, error: clientError } = await sb
      .from('master_clients')
      .select('intake_form_link')
      .eq('id', run.master_client_id)
      .single()
    if (clientError || !client) return Response.json({ error: 'Client not found' }, { status: 404 })

    if (!client.intake_form_link) {
      return Response.json({ error: 'No intake form link on file for this client — add one on the Clients page first' }, { status: 400 })
    }

    const intakeText = await fetchGoogleDocText(client.intake_form_link)
    const intake = await callClaude(loadPrompt('intake-parser.md'), intakeText)

    const { error: updateError } = await sb
      .from('keyword_pipeline_runs')
      .update({ intake, updated_at: new Date().toISOString() })
      .eq('id', run_id)
    if (updateError) throw updateError

    return Response.json({ intake })
  } catch (err: any) {
    console.error('keyword-pipeline/intake error:', err)
    return Response.json({ error: err.message || 'Failed to parse intake' }, { status: 500 })
  }
}
