export const maxDuration = 120

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 })
  }

  const {
    companyName, websiteUrl, niche, keyword, blogTitle, blogMonth,
    intakeFormContent, contentGuidelinesContent, internalLinks,
  }: {
    companyName: string
    websiteUrl: string
    niche: string
    keyword: string
    blogTitle: string
    blogMonth: string
    intakeFormContent?: string
    contentGuidelinesContent?: string
    internalLinks?: Array<{ url: string; meta_title?: string | null }>
  } = await req.json()

  const internalLinksBlock = internalLinks && internalLinks.length > 0
    ? `\n\n--- INTERNAL LINKS ---\nWhere relevant and natural, embed up to 5 internal links within the blog body using HTML anchor tags: <a href="URL">anchor text</a>.\n\nANCHOR TEXT RULES — these are strict:\n- Use 2 to 5 words maximum. Never use the full page title as anchor text.\n- The anchor text must read as a natural phrase within the sentence — as if the link were not there.\n- WRONG: "visit the <a href="...">Insulation Services in Minnesota | Northland Companies</a> page"\n- WRONG: "read our <a href="...">What is Batt Insulation: Your Guide to Home Energy Efficiency</a> guide"\n- WRONG: "Northland Companies' <a href="...">insulation removal</a> page walks through the signs" — never put "page" after a link\n- WRONG: "check out our <a href="...">batt insulation</a> page for more details" — never use "page" or "article" or "guide" right after the link\n- RIGHT: "a <a href="...">tabletop grow-light system</a> works well for small spaces"\n- RIGHT: "consider <a href="...">spray foam insulation</a> for better air sealing"\n- RIGHT: "signs you may need <a href="...">insulation removal</a> include rising energy bills"\n- The link must fit the sentence without the word "page", "article", or "guide" immediately after it. Do not add a sentence just to insert a link.\n- Do not link the same URL more than once. Maximum 5 links total.\n\n${internalLinks.map(l => `- ${l.url}${l.meta_title ? ` (${l.meta_title})` : ''}`).join('\n')}\n--- END INTERNAL LINKS ---`
    : ''

  const contextBlock = [
    intakeFormContent
      ? `\n\n--- CLIENT INTAKE FORM ---\nUse the following client information to personalise the content. Match their brand voice, highlight their USPs, and reflect any specific details they provided:\n${intakeFormContent}\n--- END INTAKE FORM ---`
      : '',
    contentGuidelinesContent
      ? `\n\n--- CONTENT GUIDELINES ---\nFollow these content guidelines strictly when writing:\n${contentGuidelinesContent}\n--- END CONTENT GUIDELINES ---`
      : '',
    internalLinksBlock,
  ].join('')

  const userPrompt = `Company: ${companyName}
Website: ${websiteUrl || 'N/A'}
Niche: ${niche || 'service business'}
Keyword: ${keyword}
Blog Title: ${blogTitle}
Blog Month: ${blogMonth}

Task:

Assume the search location is in the United States.

Task 1. Analyze and research the keyword — do not include this analysis in the output:
- People Also Ask questions
- Related searches from Google and other search engines

Task 2. AI Overview Analysis (do not include in output):
- If an AI Overview exists for this keyword, analyze it
- If none, skip to Task 3

Task 3. Based on Tasks 1 and 2, write a complete 800 to 1000 word SEO-optimized blog post.

Follow this exact blog structure:

H1: ${blogTitle}
Introduction paragraph (no H2 heading before it)
H2: Key Takeaways (bullet list only, no paragraphs)
H2: Main Section 1
  H3: Subsection
H2: Main Section 2
  H3: Subsection
H2: Main Section 3
  H3: Subsection
H2: Frequently Asked Questions
  H3: Question 1?
  H3: Question 2?
  H3: Question 3?
  H3: Question 4?
  H3: Question 5?
H2: [Conclusion heading with CTA angle]
  Conclusion paragraph mentioning ${companyName} and ${websiteUrl || 'their website'}

Notes:
- Each FAQ question must be an H3. Each must have a short paragraph answer directly below it.
- Do not include pricing or cost questions in the FAQ unless directly related to insurance coverage.
- Mention ${companyName} naturally in the body at least 2 to 3 times.

Task 4. After writing the blog, create meta tags and output them BEFORE the H1:
- 3 meta titles (label: Meta Title 1:, Meta Title 2:, Meta Title 3:) — each max 55 characters
- 3 meta descriptions (label: Meta Description 1:, Meta Description 2:, Meta Description 3:) — each max 155 characters
- 1 URL slug (label: URL Slug:) — derived from the keyword, lowercase, hyphens only, e.g. /do-grow-lights-work

Output format — clean HTML only:
- <p> for each meta tag line (one per line, labeled)
- <h1> for the blog title
- <h2> for main sections
- <h3> for subsections and FAQ questions
- <p> for paragraphs
- <ul> and <li> for bullet points (Key Takeaways)
- <a href="URL">anchor text</a> for internal links within paragraph text only
- Add <br> after each <p>

Do NOT include:
- \`\`\`html or \`\`\` markers
- Markdown formatting
- em dashes

Return ONLY raw HTML starting with the first meta tag <p> line.${contextBlock}`

  const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Fencepost Dashboard',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-6',
      stream: false,
      messages: [
        {
          role: 'system',
          content: `You are an SEO copywriter for a service business in the United States.

Write at a grade 9 reading level or below.
Use clear, direct language.
Keep sentences short. One idea per sentence. Never write long, run-on sentences.
Use active voice.

PARAGRAPH LENGTH — this is a hard rule:
- Every paragraph must be 5 lines or fewer when rendered on a page.
- If a thought needs more than 5 lines, split it into two paragraphs.
- Short paragraphs are always correct. Long paragraphs are always wrong.
Speak to the reader as "you" and "your."
Give practical, specific advice.
Include data or examples when useful.

Do not use em dashes. Use commas or semicolons instead.
Do not use markdown, asterisks, or hashtags.

Avoid:
- filler phrases
- metaphors, analogies, and clichés
- vague or sweeping claims
- phrases like "in conclusion," "to sum up," or "in summary"
- extra adjectives and adverbs
- robotic or AI-sounding language

Avoid these words:
Elevate, Delve, Revolutionize, Foster, Leverage, Synergy, Optimize, Empower, Innovative, Disruptive, Robust, Seamless, Holistic, Cutting-edge, Scalable, Agile, Dynamic, Ecosystem, Game-changer

Ensure the final output reads naturally, clearly, and like a human wrote it.

COMPANY NAME — always use the full name exactly as given. Never shorten, abbreviate, or modify it.

OUTPUT — return clean HTML only. No code fences. No markdown. Start directly with the first <p> meta tag line.`,
        },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!orRes.ok) {
    const errText = await orRes.text().catch(() => 'Unknown error')
    return Response.json({ error: `OpenRouter error: ${errText}` }, { status: 500 })
  }

  const data = await orRes.json()
  const html: string = data.choices?.[0]?.message?.content ?? ''

  return Response.json({ html })
}
