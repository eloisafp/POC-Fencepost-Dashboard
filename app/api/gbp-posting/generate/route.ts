import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import { supabaseServer, fetchGoogleDocText } from '../../../../lib/keyword-pipeline/server'

// Plain-text Claude call — this route needs a single string back, and JSON-mode
// breaks whenever the model puts literal line breaks inside the JSON string
async function callClaudeText(systemPrompt: string, userText: string): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set in .env.local')
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Fencepost Dashboard',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      max_tokens: 500,
    }),
  })
  if (!res.ok) throw new Error(`AI error: ${(await res.text()).slice(0, 300)}`)
  const json = await res.json()
  const raw = json.choices?.[0]?.message?.content
  const text = (typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((c: any) => c?.text ?? '').join('') : '')
    .trim()
    .replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '')  // stray code fences
    .replace(/^["'“]|["'”]$/g, '')                          // stray surrounding quotes
    .trim()
  return text
}

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

    let content = await callClaudeText(prompt, JSON.stringify(payload))
    if (!content) {
      content = await callClaudeText(prompt, JSON.stringify(payload)) // one retry on empty
      if (!content) throw new Error('AI returned no content. Try again.')
    }

    // Enforce the 50-word cap — one shorten retry, then hard-fail rather than publish an overlong post
    if (countWords(content) > 50) {
      content = await callClaudeText(prompt, JSON.stringify({ ...payload, notes: `${payload.notes}\nYOUR PREVIOUS DRAFT WAS ${countWords(content)} WORDS — TOO LONG. Rewrite it under 50 words:\n${content}` }))
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
