import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import { supabaseServer, fetchGoogleDocText, callClaude } from '../../../../lib/keyword-pipeline/server'

// POST { post_id } -> { content } — generates the GBP post text for one row.
// Reads the client's intake form + content guidelines docs, plus the related
// URL's page text, then writes a <=50-word post ending in the chosen CTA.
export const maxDuration = 300

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url.startsWith('http') ? url : `https://${url}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FencepostGBP/1.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return ''
    const html = await res.text()
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2500)
  } catch { return '' }
}

export async function POST(req: NextRequest) {
  try {
    const { post_id } = await req.json()
    if (!post_id) return Response.json({ error: 'post_id is required' }, { status: 400 })

    const sb = supabaseServer()
    const { data: post, error } = await sb.from('gbp_post_drafts').select('*').eq('id', post_id).single()
    if (error || !post) return Response.json({ error: 'Post not found' }, { status: 404 })

    const { data: client } = await sb
      .from('master_clients')
      .select('intake_form_link, content_guidelines_url')
      .eq('id', post.master_client_id)
      .single()

    // Intake + guidelines are context, not hard requirements — a missing or
    // unshared doc shouldn't block generation
    let intakeText = '', guideText = ''
    if (client?.intake_form_link) {
      try { intakeText = (await fetchGoogleDocText(client.intake_form_link)).slice(0, 6000) } catch { /* proceed without */ }
    }
    if (client?.content_guidelines_url) {
      try { guideText = (await fetchGoogleDocText(client.content_guidelines_url)).slice(0, 4000) } catch { /* proceed without */ }
    }
    const pageText = post.related_url ? await fetchPageText(post.related_url) : ''

    const prompt = fs.readFileSync(path.join(process.cwd(), 'lib/gbp-posting', 'prompt.md'), 'utf-8')
    const payload = {
      client_name: post.client_name,
      intake_form: intakeText,
      content_guidelines: guideText,
      related_url: post.related_url || '',
      page_text: pageText,
      cta: post.cta || 'Learn More',
      notes: post.notes || '',
      month_year: post.month_year || '',
    }

    let result = await callClaude(prompt, JSON.stringify(payload), 1000)
    let content: string = (result?.content || '').trim()
    if (!content) throw new Error('AI returned no content. Try again.')

    // Enforce the 50-word cap — one shorten retry, then hard-fail rather than publish an overlong post
    if (countWords(content) > 50) {
      result = await callClaude(prompt, JSON.stringify({ ...payload, notes: `${payload.notes}\nYOUR PREVIOUS DRAFT WAS ${countWords(content)} WORDS — TOO LONG. Rewrite it under 50 words:\n${content}` }), 1000)
      content = (result?.content || '').trim()
      if (!content || countWords(content) > 50) throw new Error(`Generated post exceeds 50 words (${countWords(content)}). Try again.`)
    }

    const { error: updErr } = await sb
      .from('gbp_post_drafts')
      .update({ content, status: 'For Review', updated_at: new Date().toISOString() })
      .eq('id', post_id)
    if (updErr) throw updErr

    return Response.json({ content, words: countWords(content) })
  } catch (err: any) {
    console.error('gbp-posting/generate error:', err)
    return Response.json({ error: err.message || 'Generation failed' }, { status: 500 })
  }
}
