import { buildPromptFromTemplate, type TemplateSection } from '../../page-content-generator/templateStore'

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json({ error: 'OPENROUTER_API_KEY not set in .env.local' }, { status: 500 })
  }

  const { companyName, service, city, state, subServices, websiteUrl, pageType, templateSections } = await req.json()

  const isServiceOnly = pageType === 'service-only'

  const subServicesLine = subServices
    ? `Sub-services offered: ${subServices}`
    : 'Sub-services: auto-determine 3–4 relevant types based on the service'

  const websiteLine = websiteUrl ? `Website: ${websiteUrl}` : ''

  const metaHeader = isServiceOnly
    ? `Generate a complete SEO service page (no specific city or location) for a home services company.

Company: ${companyName}
Service: ${service}
${subServicesLine}
${websiteLine}

Respond with ONLY the content below — no intro, no commentary:

---SEO---
TITLE: [title tag, max 60 chars, e.g. "Insulation Contractor Services"]
META: [meta description, 140–160 chars, include service, company name, and main benefit — no city or state]
URL: /[service-slug]
---PAGE---
[full page content in markdown]
---END---

Do NOT mention any specific city, state, or location in the content. Write for a general audience.
The page content must follow this exact section order and structure. Include the [IMAGE: ...] placeholders exactly as shown — do not remove or rephrase them:
`
    : `Generate a complete SEO service/location page for a home services company.

Company: ${companyName}
Service: ${service}
City: ${city}
State: ${state}
${subServicesLine}
${websiteLine}

Respond with ONLY the content below — no intro, no commentary:

---SEO---
TITLE: [title tag, max 60 chars, e.g. "Insulation Contractor Longville MN"]
META: [meta description, 140–160 chars, include service, city, state, company name, main benefit]
URL: /[service-slug]-[city-slug-lowercase]
---PAGE---
[full page content in markdown]
---END---

The page content must follow this exact section order and structure. Include the [IMAGE: ...] placeholders exactly as shown — do not remove or rephrase them:
`

  const hasSections = Array.isArray(templateSections) && templateSections.length > 0

  const pageStructure = hasSections
    ? buildPromptFromTemplate(templateSections as TemplateSection[], { companyName, service, city: city ?? '', state: state ?? '', subServices })
    : isServiceOnly
    ? `# ${service} Services

[IMAGE: Hero photo or exterior shot — replace with a real project photo]

## ${service} You Can Count On
Write 2 paragraphs: (1) common problems homeowners face without proper ${service.toLowerCase()} and how it costs them money — ~80 words. (2) introduces ${companyName}, what they do, why they're trusted — ~60 words.

## Why Homeowners Invest in Better ${service}
Write 2 paragraphs: (1) the year-round need for quality ${service.toLowerCase()} — ~50 words. (2) upgrading ROI and how ${companyName} assesses and recommends — ~40 words.

## Our ${service} Services
Intro paragraph about complete range of options, ~40 words. Then 4 sub-sections:

### [Sub-service 1]
~60 word paragraph

### [Sub-service 2]
~60 word paragraph

### [Sub-service 3]
~50 word paragraph

### ${service} Upgrades and Replacement
~60 word paragraph about old or failing systems

[IMAGE: Photo of completed ${service.toLowerCase()} work or the ${companyName} team — replace with a real project photo]

## What You Gain With a ${companyName} ${service} Upgrade
One intro sentence (~30 words), then exactly 6 bullet points using - (lower costs, consistent comfort, fewer drafts, moisture control, less HVAC strain, quieter home — adapt to this service).

## Why Homeowners Choose ${companyName}
Exactly 4 bullet points using - : locally owned/community roots, quality materials and workmanship, honest recommendations, crew respects time/property/budget. Then 1 closing sentence about their goal.

## How the Process Works
One intro sentence. Then 4 steps in this format:

**Step 1: [Step Name]**
~60 word paragraph

**Step 2: [Step Name]**
~60 word paragraph

**Step 3: [Step Name]**
~60 word paragraph

**Step 4: [Step Name]**
~60 word paragraph

## Ready to Get Started?
1–2 sentences inviting them to call or fill out the form for a free evaluation.

## Frequently Asked Questions
Exactly 6 Q&As. Use **bold question** format, then a paragraph answer ~70 words each. Cover: signs the home needs the service, best materials/type, installation timeline, energy bill savings, older vs new construction, whether the premium option is worth it.`
    : `# ${service} in ${city}, ${state}

[IMAGE: Google Maps embed showing ${city}, ${state} — replace with embedded map or hero photo]

## ${service} You Can Count On in ${city}, ${state}
Write 2 paragraphs: (1) local climate/seasonal conditions and how bad ${service.toLowerCase()} costs homeowners money each month — ~80 words. (2) introduces ${companyName}, what they do, why they're trusted — ~60 words.

## Why ${city} Homeowners Invest in Better ${service}
Write 2 paragraphs: (1) how ${city}'s conditions drive year-round need — ~50 words. (2) upgrading ROI and how ${companyName} assesses and recommends — ~40 words.

## Our ${service} Services in ${city}, ${state}
Intro paragraph about complete range of options, ~40 words. Then 4 sub-sections:

### [Sub-service 1]
~60 word paragraph

### [Sub-service 2]
~60 word paragraph

### [Sub-service 3]
~50 word paragraph

### ${service} Upgrades and Replacement
~60 word paragraph about old or failing systems

[IMAGE: Photo of completed ${service.toLowerCase()} work or the ${companyName} team — replace with a real project photo]

## What You Gain With a ${companyName} ${service} Upgrade
One intro sentence (~30 words), then exactly 6 bullet points using - (lower costs, consistent comfort, fewer drafts, moisture control, less HVAC strain, quieter home — adapt to this service).

## Why ${city} Homeowners Choose ${companyName}
Exactly 4 bullet points using - : locally owned/community roots, quality for ${state} climate, honest recommendations, crew respects time/property/budget. Then 1 closing sentence about their goal.

## How the Process Works
One intro sentence. Then 4 steps in this format:

**Step 1: [Step Name]**
~60 word paragraph

**Step 2: [Step Name]**
~60 word paragraph

**Step 3: [Step Name]**
~60 word paragraph

**Step 4: [Step Name]**
~60 word paragraph

## Ready to Make Your ${city} Home More Comfortable?
1–2 sentences inviting them to call or fill out the form for a free evaluation.

## Frequently Asked Questions
Exactly 6 Q&As. Use **bold question** format, then a paragraph answer ~70 words each. Cover: signs the home needs the service, best type for ${state}, installation timeline, energy bill savings, older vs new construction, whether the premium option is worth it.`

  const prompt = metaHeader + pageStructure + (isServiceOnly
    ? `\n\nWrite in a warm, professional home services tone. Do not mention any specific city, state, or region.`
    : `\n\nWrite in a warm, professional home services tone. Use the location naturally throughout. Keep language specific to ${state}'s climate and conditions.`)

  const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Fencepost Dashboard',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4.6',
      messages: [
        {
          role: 'system',
          content: `You are an SEO copywriter for a local service business in the United States.

Write at a grade 9 reading level or below.
Use clear, direct language.
Keep sentences short.
Use active voice.
Speak to the reader as "you" and "your."
Give practical, specific advice.
Include data or examples when useful.

Do not use em dashes, use commas or semicolons instead.
Do not use markdown, asterisks, or hashtags.

Avoid:
- filler phrases
- metaphors, analogies, and clichés
- vague or sweeping claims
- phrases like "in conclusion," "to sum up," or "closing"
- extra adjectives and adverbs
- robotic or AI-sounding language

Avoid these words:
Elevate, Delve, Revolutionize, Foster, Leverage, Synergy, Optimize, Empower, Innovative, Disruptive, Robust, Seamless, Holistic, Cutting-edge, Scalable, Agile, Dynamic, Ecosystem, Game-changer

Ensure the final output reads naturally, clearly, and like a human wrote it.`,
        },
        { role: 'user', content: prompt },
      ],
      stream: true,
      max_tokens: 4096,
    }),
  })

  if (!orResponse.ok) {
    const errText = await orResponse.text()
    return Response.json({ error: `OpenRouter error: ${errText}` }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const reader = orResponse.body!.getReader()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed === 'data: [DONE]') continue
            if (!trimmed.startsWith('data: ')) continue

            try {
              const json = JSON.parse(trimmed.slice(6))
              const text = json.choices?.[0]?.delta?.content
              if (text) controller.enqueue(encoder.encode(text))
            } catch {
              // skip malformed chunks
            }
          }
        }
      } catch (err) {
        controller.error(err)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
