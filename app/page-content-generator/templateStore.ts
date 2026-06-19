export type ContentType =
  | 'image'
  | 'paragraphs'
  | 'bullets'
  | 'subsections'
  | 'steps'
  | 'faq'
  | 'cta'
  | 'button'
  | 'table'
  | 'html'

// Configuration for one column inside a table section
export interface CellDef {
  contentType: Exclude<ContentType, 'table'>
  heading: string
  varyHeading?: boolean
  count: number
  wordsEach: number
  notes: string
  htmlCode?: string
}

export interface TemplateSection {
  id: string
  heading: string       // H2 text (fixed) or topic hint (when varyHeading is true)
  varyHeading?: boolean // When true, AI writes its own H2 based on heading as a hint
  contentType: ContentType
  count: number
  wordsEach: number
  notes: string
  // Table-only fields:
  leftCol?: CellDef
  rightCol?: CellDef
  leftWidth?: number    // Left column width % (default 45)
  // HTML embed-only field:
  htmlCode?: string
  // CTA button-only fields:
  ctaButtonText?: string
  ctaButtonUrl?: string
}

export interface PageTemplate {
  id: string
  name: string
  sections: TemplateSection[]
  createdAt: string
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

// ── Default section definitions ───────────────────────────────────────────────

type SectionDef = Omit<TemplateSection, 'id'>

export const DEFAULT_SECTION_DEFS: SectionDef[] = [
  {
    heading: 'Google Maps embed showing {city}, {state} — replace with embedded map or hero photo',
    contentType: 'image', count: 1, wordsEach: 0, notes: '',
  },
  {
    heading: '{service} You Can Count On in {city}, {state}',
    contentType: 'paragraphs', count: 2, wordsEach: 70,
    notes: '(1) local climate/seasonal conditions and how bad {service} costs homeowners money each month ~80 words. (2) introduces {company}, what they do, why trusted ~60 words.',
  },
  {
    heading: 'Why {city} Homeowners Invest in Better {service}',
    contentType: 'paragraphs', count: 2, wordsEach: 45,
    notes: "(1) how {city}'s conditions drive year-round need ~50 words. (2) upgrading ROI and how {company} assesses and recommends ~40 words.",
  },
  {
    heading: 'Our {service} Services in {city}, {state}',
    contentType: 'subsections', count: 4, wordsEach: 60,
    notes: 'Include "{service} Upgrades and Replacement" as one sub-service.',
  },
  {
    heading: 'Photo of completed {service} work or the {company} team — replace with a real project photo',
    contentType: 'image', count: 1, wordsEach: 0, notes: '',
  },
  {
    heading: 'What You Gain With a {company} {service} Upgrade',
    contentType: 'bullets', count: 6, wordsEach: 0,
    notes: 'lower costs, consistent comfort, fewer drafts, moisture control, less HVAC strain, quieter home — adapt to this service',
  },
  {
    heading: 'Why {city} Homeowners Choose {company}',
    contentType: 'bullets', count: 4, wordsEach: 0,
    notes: 'locally owned/community roots, quality for {state} climate, honest recommendations, crew respects time/property/budget. Then 1 closing sentence about their goal.',
  },
  {
    heading: 'How the Process Works',
    contentType: 'steps', count: 4, wordsEach: 60, notes: '',
  },
  {
    heading: 'Service Areas & Location',
    contentType: 'table',
    count: 1, wordsEach: 0, notes: '',
    leftWidth: 45,
    leftCol: {
      contentType: 'bullets',
      heading: 'Other {service} Service Areas Near {city}',
      count: 6,
      wordsEach: 0,
      notes: 'List nearby cities or towns {company} serves for {service}. Each bullet is just the city/town name with a brief 3–5 word phrase.',
    },
    rightCol: {
      contentType: 'html',
      heading: '',
      count: 1,
      wordsEach: 0,
      notes: '',
      htmlCode: '<iframe src="https://maps.google.com/maps?q={city},+{state}&output=embed" width="100%" height="300" frameborder="0" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>',
    },
  },
  {
    heading: 'Ready to Make Your {city} Home More Comfortable?',
    contentType: 'cta', count: 1, wordsEach: 0, notes: '',
  },
  {
    heading: 'Frequently Asked Questions',
    contentType: 'faq', count: 6, wordsEach: 70,
    notes: 'Cover: signs the home needs the service, best type for {state}, installation timeline, energy bill savings, older vs new construction, whether the premium option is worth it.',
  },
]

export function newBlankTemplate(): PageTemplate {
  return {
    id: uid(),
    name: 'New Template',
    sections: DEFAULT_SECTION_DEFS.map(def => ({ ...def, id: uid() })),
    createdAt: new Date().toISOString(),
  }
}

export function newSection(): TemplateSection {
  return { id: uid(), heading: 'New Section', contentType: 'paragraphs', count: 2, wordsEach: 60, notes: '' }
}

export function newTableSection(): TemplateSection {
  return {
    id: uid(),
    heading: 'Two-Column Layout',
    contentType: 'table',
    count: 1,
    wordsEach: 0,
    notes: '',
    leftWidth: 45,
    leftCol: {
      contentType: 'image',
      heading: 'Google Maps embed showing {city}, {state}',
      count: 1,
      wordsEach: 0,
      notes: '',
    },
    rightCol: {
      contentType: 'paragraphs',
      heading: '{service} You Can Count On in {city}, {state}',
      count: 2,
      wordsEach: 70,
      notes: '',
    },
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function applyVars(
  text: string,
  v: { service: string; city: string; state: string; company: string }
): string {
  return text
    .replace(/\{service\}/gi, v.service)
    .replace(/\{city\}/gi,    v.city)
    .replace(/\{state\}/gi,   v.state)
    .replace(/\{company\}/gi, v.company)
}

type Vars = { service: string; city: string; state: string; company: string }

function buildCellContent(
  cell: CellDef,
  v: Vars,
  subServices?: string
): string {
  const h    = applyVars(cell.heading, v)
  const note = applyVars(cell.notes,   v)
  const ns   = note ? ` ${note}` : ''
  const limit = cell.wordsEach > 0 ? cell.wordsEach : 0
  const wl   = limit > 0 ? ` [HARD LIMIT: ${limit} words max — count every word, do not exceed]` : ''

  switch (cell.contentType) {
    case 'image':
      return `[IMAGE: ${h}]\n`

    case 'paragraphs': {
      const each = limit > 0 ? ` Each paragraph: ${limit} words maximum. Count every word. Stop at ${limit}.` : ''
      return `## ${h}\nWrite ${cell.count} paragraph${cell.count !== 1 ? 's' : ''}.${each}${ns}\n`
    }

    case 'bullets':
      return `## ${h}\nExactly ${cell.count} bullet points using - .${ns}\n`

    case 'subsections': {
      const subLine = subServices
        ? `Sub-services offered: ${subServices}.`
        : 'Auto-determine sub-service names relevant to the service.'
      const subLimit = limit || 60
      let out = `## ${h}\nIntro paragraph about complete range of options, 40 words max — do not exceed. ${subLine} Then ${cell.count} sub-sections:\n`
      for (let i = 1; i <= cell.count; i++) {
        out += `\n### [Sub-service ${i}]\n${subLimit} words max — count every word, stop at ${subLimit}\n`
      }
      if (ns) out += ns + '\n'
      return out
    }

    case 'steps': {
      const stepLimit = limit || 60
      let out = `## ${h}\nOne intro sentence (15 words max). Then ${cell.count} steps in this format:\n`
      for (let i = 1; i <= cell.count; i++) {
        out += `\n**Step ${i}: [Step Name]**\n${stepLimit} words max — count every word, stop at ${stepLimit}\n`
      }
      if (ns) out += ns + '\n'
      return out
    }

    case 'faq':
      return `## ${h}\nExactly ${cell.count} Q&As. Use **bold question** format, then a paragraph answer${wl} each.${ns}\n`

    case 'cta':
      return `## ${h}\n1–2 sentences inviting them to call or fill out the form for a free evaluation.${ns}\n`

    case 'html':
      return cell.htmlCode?.trim() ? `${applyVars(cell.htmlCode.trim(), v)}\n` : ''

    default:
      return ''
  }
}

export function extractHtmlEmbeds(
  sections: TemplateSection[],
  v: { service: string; city: string; state: string; company: string }
): string[] {
  const embeds: string[] = []
  for (const sec of sections) {
    if (sec.contentType === 'html' && sec.htmlCode?.trim()) {
      embeds.push(applyVars(sec.htmlCode.trim(), v))
    } else if (sec.contentType === 'table') {
      for (const col of [sec.leftCol, sec.rightCol]) {
        if (col?.contentType === 'html' && col.htmlCode?.trim()) {
          embeds.push(applyVars(col.htmlCode.trim(), v))
        }
      }
    }
  }
  return embeds
}

export function applyHtmlEmbeds(text: string, embeds: string[]): string {
  return text.replace(/\[HTML_EMBED_(\d+)\]/g, (_, i) => embeds[+i] ?? '')
}

export function buildPromptFromTemplate(
  sections: TemplateSection[],
  vars: { companyName: string; service: string; city: string; state: string; subServices?: string }
): { prompt: string; htmlEmbeds: string[] } {
  const v: Vars = { service: vars.service, city: vars.city, state: vars.state, company: vars.companyName }
  const htmlEmbeds: string[] = []

  function addEmbed(html: string): string {
    const idx = htmlEmbeds.length
    htmlEmbeds.push(applyVars(html, v))
    return `[HTML_EMBED_${idx}]\n`
  }

  let out = `# ${vars.service} in ${vars.city}, ${vars.state}\n`

  for (const sec of sections) {
    if (sec.contentType === 'table') {
      if (sec.leftCol && sec.rightCol) {
        const colContent = (col: CellDef): string => {
          if (col.contentType === 'html' && col.htmlCode?.trim()) {
            // Map embeds: output an [IMAGE: ...] placeholder the AI reliably copies
            if (/maps\.google\.com|google\.com\/maps/i.test(col.htmlCode)) {
              return `[IMAGE: Google Maps embed — ${v.city}, ${v.state}]\n`
            }
            return addEmbed(col.htmlCode.trim())
          }
          const resolvedCol = col.varyHeading
            ? { ...col, heading: `[Write an original H2 heading — topic: ${applyVars(col.heading, v)} — use fresh wording]` }
            : col
          return buildCellContent(resolvedCol, v, vars.subServices)
        }
        out += `\n[COL-LEFT]\n${colContent(sec.leftCol)}[COL-RIGHT]\n${colContent(sec.rightCol)}[COL-END]\n`
      }
      continue
    }

    if (sec.contentType === 'html') {
      if (sec.htmlCode?.trim()) {
        if (/maps\.google\.com|google\.com\/maps/i.test(sec.htmlCode)) {
          out += `\n[IMAGE: Google Maps embed — ${v.city}, ${v.state}]\n`
        } else {
          out += `\n${addEmbed(sec.htmlCode.trim())}`
        }
      }
      continue
    }

    if (sec.contentType === 'button') {
      const btnText = sec.ctaButtonText?.trim() || 'Contact Us'
      const btnUrl  = sec.ctaButtonUrl?.trim() || ''
      out += `\n[BUTTON: ${applyVars(btnText, v)}${btnUrl ? ` | ${applyVars(btnUrl, v)}` : ''}]\n`
      continue
    }

    if (sec.contentType === 'cta') {
      const h  = sec.varyHeading
        ? `[Write an original H2 heading — topic: ${applyVars(sec.heading, v)} — use fresh wording]`
        : applyVars(sec.heading, v)
      const ns = sec.notes ? ` ${applyVars(sec.notes, v)}` : ''
      const btnText = sec.ctaButtonText?.trim()
      const btnUrl  = sec.ctaButtonUrl?.trim()
      const btnLine = btnText ? `\n[BUTTON: ${btnText}${btnUrl ? ` | ${btnUrl}` : ''}]` : ''
      out += `\n## ${h}\n1–2 sentences inviting them to call or fill out the form for a free evaluation.${ns}${btnLine}\n`
      continue
    }

    // Non-table sections — delegate to the same helper
    const resolvedHeading = sec.varyHeading
      ? `[Write an original H2 heading — topic: ${applyVars(sec.heading, v)} — use fresh wording, do not repeat phrases used in other sections]`
      : sec.heading
    out += '\n' + buildCellContent(
      {
        contentType: sec.contentType as Exclude<ContentType, 'table' | 'html'>,
        heading: resolvedHeading,
        count: sec.count,
        wordsEach: sec.wordsEach,
        notes: sec.notes,
      },
      v,
      vars.subServices
    )
  }

  return { prompt: out, htmlEmbeds }
}

// ── localStorage CRUD ─────────────────────────────────────────────────────────

const LS_KEY = 'fencepost_templates_v1'

export function loadTemplates(): PageTemplate[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') }
  catch { return [] }
}

export function saveTemplate(t: PageTemplate): void {
  const rest = loadTemplates().filter(x => x.id !== t.id)
  localStorage.setItem(LS_KEY, JSON.stringify([...rest, t]))
}

export function deleteTemplate(id: string): void {
  localStorage.setItem(LS_KEY, JSON.stringify(loadTemplates().filter(t => t.id !== id)))
}
