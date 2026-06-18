import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('pdf') as File | null
    if (!file) return Response.json({ error: 'No PDF file provided' }, { status: 400 })

    // Convert File to base64 for Claude's document reading
    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    const prompt = `You are analyzing a service page document to extract its structural template.

The PDF attached is a completed SEO service page. Your job is to identify each CONTENT SECTION and map it to one of these content types:
- "image" — a photo placeholder or map embed
- "paragraphs" — one or more prose paragraphs
- "bullets" — a bullet/list section
- "subsections" — an H2 with multiple H3 sub-items (like "Why Choose Us" with sub-items each having a short paragraph)
- "steps" — numbered steps (How it Works, Our Process, etc.)
- "faq" — a Frequently Asked Questions section
- "cta" — a call to action (button or short invitation to contact)

IMPORTANT RULES:
- Ignore the review header, SEO meta block (Title Tag, Meta Description, URL), and the H1 page title — those are NOT template sections
- Focus ONLY on the body content sections (H2 headings and their content)
- For each section, estimate how many items/paragraphs it has (count field) and roughly how many words each item is (wordsEach field)
- Use generic placeholder variables in headings: use {service} for the service name, {city} for city, {state} for state, {company} for company name
- For subsections type, the heading is the H2 and sub-items are the H3s
- For bullets type, count = number of bullet points
- For faq type, count = number of Q&A pairs
- For paragraphs type, count = number of paragraphs
- For steps type, count = number of steps
- For cta type, count = 1, wordsEach = 0

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "suggestedName": "short name for this template style",
  "sections": [
    {
      "heading": "section heading with {placeholders}",
      "contentType": "one of the types above",
      "count": 2,
      "wordsEach": 70,
      "notes": "brief instruction for the writer, e.g. cover specific topics"
    }
  ]
}`

    const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
        max_tokens: 2048,
      }),
    })

    if (!orResponse.ok) {
      const errText = await orResponse.text()
      return Response.json({ error: `AI error: ${errText}` }, { status: 500 })
    }

    const orJson = await orResponse.json()
    const raw = orJson.choices?.[0]?.message?.content

    // Handle both string and array content formats
    const rawText = typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('')
        : ''

    // Strip markdown code fences if present
    const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    if (!cleaned) {
      return Response.json({ error: 'AI returned empty response. Try again.' }, { status: 500 })
    }

    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return Response.json({ error: 'AI returned invalid JSON. Try again.' }, { status: 500 })
    }

    return Response.json({
      suggestedName: parsed.suggestedName || 'PDF Template',
      sections: parsed.sections || [],
    })
  } catch (err: any) {
    console.error('parse-pdf-template error:', err)
    return Response.json({ error: err.message || 'Failed to parse PDF' }, { status: 500 })
  }
}
