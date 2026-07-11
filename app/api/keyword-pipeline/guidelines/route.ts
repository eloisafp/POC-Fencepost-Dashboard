import { NextRequest } from 'next/server'
import { supabaseServer, loadPrompt, fetchGoogleDocText, callClaude } from '../../../../lib/keyword-pipeline/server'

const NO_GUIDELINES = {
  client_slug: null,
  has_guidelines: false,
  tone: null,
  brand_voice: null,
  topics_to_avoid: null,
  cta_preferences: null,
  audience_notes: null,
  formatting_preferences: null,
}

// POST { run_id: number } -> { content_guidelines: {...} }
// Loads the run's client's content_guidelines_url from master_clients (optional).
// If absent, writes a has_guidelines:false record so Phase 4 always has a predictable shape.
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
      .select('content_guidelines_url')
      .eq('id', run.master_client_id)
      .single()
    if (clientError || !client) return Response.json({ error: 'Client not found' }, { status: 404 })

    let content_guidelines = NO_GUIDELINES
    if (client.content_guidelines_url) {
      const text = await fetchGoogleDocText(client.content_guidelines_url)
      // Placeholder docs ("NONE", "N/A", a blank page) have nothing to parse —
      // and guidelines are optional, so a bad AI reply falls back instead of failing
      const isPlaceholder = text.length < 30 || /^(none|n\/?a|no( content)? guidelines)\.?$/i.test(text.trim())
      if (!isPlaceholder) {
        try {
          content_guidelines = await callClaude(loadPrompt('guidelines-parser.md'), text)
        } catch (e) {
          console.warn('keyword-pipeline/guidelines: parse failed, saving has_guidelines:false —', e)
        }
      }
    }

    const { error: updateError } = await sb
      .from('keyword_pipeline_runs')
      .update({ content_guidelines, updated_at: new Date().toISOString() })
      .eq('id', run_id)
    if (updateError) throw updateError

    return Response.json({ content_guidelines })
  } catch (err: any) {
    console.error('keyword-pipeline/guidelines error:', err)
    return Response.json({ error: err.message || 'Failed to parse guidelines' }, { status: 500 })
  }
}
