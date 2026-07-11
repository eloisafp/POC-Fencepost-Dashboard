import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

export function supabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export function loadPrompt(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'lib/keyword-pipeline/prompts', name), 'utf-8')
}

// Same technique as app/api/fetch-gdoc/route.ts — public export URL, no OAuth.
// Doc must be shared "Anyone with the link can view".
export async function fetchGoogleDocText(url: string): Promise<string> {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (!match) throw new Error('Invalid Google Doc URL')

  const exportUrl = `https://docs.google.com/document/d/${match[1]}/export?format=txt`
  const res = await fetch(exportUrl)
  if (!res.ok) throw new Error('Could not fetch document. Make sure it is shared as "Anyone with the link can view".')

  const text = (await res.text()).trim()
  if (!text) throw new Error('Document is empty')
  return text
}

export async function callClaude(systemPrompt: string, userText: string, maxTokens = 4096): Promise<any> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not set in .env.local')
  }

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
      max_tokens: maxTokens,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI error: ${errText}`)
  }

  const json = await res.json()
  const raw = json.choices?.[0]?.message?.content

  const rawText = typeof raw === 'string'
    ? raw
    : Array.isArray(raw)
      ? raw.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('')
      : ''

  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (!cleaned) throw new Error('AI returned an empty response. Try again.')

  try {
    return JSON.parse(cleaned)
  } catch {
    throw new Error('AI returned invalid JSON. Try again.')
  }
}
