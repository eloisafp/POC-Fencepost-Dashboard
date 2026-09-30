import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import { supabaseServer, fetchGoogleDocText, callClaude } from '../../../../lib/keyword-pipeline/server'

// POST { client_id, notes } -> { seeds, wants_competitors, competitors_mentioned,
//                               excluded_topics, strategic_angle, summary }
//
// Phase 2 of the Content Calendar: turn the strategist's/client's free-form brief
// into an editable seed list, each tagged core / adjacent / off-topic. Runs before
// any Ahrefs spend so the strategist can correct the direction cheaply.
export const maxDuration = 90

export async function POST(req: NextRequest) {
  try {
    const { client_id, notes } = await req.json()
    const brief = String(notes || '').trim()
    if (!client_id) return Response.json({ error: 'client_id is required' }, { status: 400 })
    if (!brief) return Response.json({ error: 'Notes are required — they drive this round' }, { status: 400 })

    const sb = supabaseServer()
    const { data: client } = await sb
      .from('master_clients')
      .select('client_name, website_url, niche, intake_form_link')
      .eq('id', client_id)
      .single()
    if (!client) return Response.json({ error: 'Client not found' }, { status: 404 })

    // Intake is context for the relevance judgement, not a hard requirement
    let services: string[] = []
    let primaryLocation = ''
    if (client.intake_form_link) {
      try {
        const text = (await fetchGoogleDocText(client.intake_form_link)).slice(0, 6000)
        const parsed = await callClaude(
          'Extract this intake form\'s services and primary city. Return ONLY JSON: {"services":["..."],"primary_location":"City, ST"}. Empty array/string if unclear.',
          text, 512,
        )
        if (Array.isArray(parsed?.services)) services = parsed.services.map((s: any) => String(s)).slice(0, 20)
        primaryLocation = String(parsed?.primary_location || '')
      } catch { /* proceed without intake context */ }
    }

    const prompt = fs.readFileSync(path.join(process.cwd(), 'lib/content-calendar/prompts', 'notes-parser.md'), 'utf-8')
    const result = await callClaude(prompt, JSON.stringify({
      notes: brief,
      client_name: client.client_name,
      niche: client.niche || '',
      website_url: client.website_url || '',
      services,
      primary_location: primaryLocation,
    }), 2048)

    const seeds = Array.isArray(result?.seeds)
      ? result.seeds
          .map((s: any) => ({
            keyword: String(s?.keyword || '').trim(),
            relevance: ['core', 'adjacent', 'off-topic'].includes(s?.relevance) ? s.relevance : 'adjacent',
            reason: String(s?.reason || ''),
          }))
          .filter((s: any) => s.keyword)
      : []
    if (seeds.length === 0) return Response.json({ error: 'Could not derive any seed keywords from these notes. Try naming the topics explicitly.' }, { status: 502 })

    return Response.json({
      seeds,
      wants_competitors: !!result?.wants_competitors,
      competitors_mentioned: Array.isArray(result?.competitors_mentioned) ? result.competitors_mentioned : [],
      excluded_topics: Array.isArray(result?.excluded_topics) ? result.excluded_topics : [],
      strategic_angle: String(result?.strategic_angle || ''),
      summary: String(result?.summary || ''),
      services,
      primary_location: primaryLocation,
    })
  } catch (err: any) {
    console.error('content-calendar/parse-notes error:', err)
    return Response.json({ error: err.message || 'Failed to read the notes' }, { status: 500 })
  }
}
