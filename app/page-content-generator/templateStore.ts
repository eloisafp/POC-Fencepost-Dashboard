export type ContentType =
  | 'image'
  | 'paragraphs'
  | 'bullets'
  | 'subsections'
  | 'steps'
  | 'faq'
  | 'cta'
  | 'table'

// Configuration for one column inside a table section
export interface CellDef {
  contentType: Exclude<ContentType, 'table'>
  heading: string
  count: number
  wordsEach: number
  notes: string
}

export interface TemplateSection {
  id: string
  heading: string       // H2 text for most types; caption for 'image'; label for 'table'
  contentType: ContentType
  count: number
  wordsEach: number
  notes: string
  // Table-only fields:
  leftCol?: CellDef
  rightCol?: CellDef
  leftWidth?: number    // Left column width % (default 45)
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
  const wn   = cell.wordsEach > 0 ? ` ~${cell.wordsEach} words` : ''

  switch (cell.contentType) {
    case 'image':
      return `[IMAGE: ${h}]\n`

    case 'paragraphs':
      return `## ${h}\nWrite ${cell.count} paragraph${cell.count !== 1 ? 's' : ''}${wn ? `, ${wn.trim()} each` : ''}.${ns}\n`

    case 'bullets':
      return `## ${h}\nExactly ${cell.count} bullet points using - .${ns}\n`

    case 'subsections': {
      const subLine = subServices
        ? `Sub-services offered: ${subServices}.`
        : 'Auto-determine sub-service names relevant to the service.'
      let out = `## ${h}\nIntro paragraph about complete range of options, ~40 words. ${subLine} Then ${cell.count} sub-sections:\n`
      for (let i = 1; i <= cell.count; i++) {
        out += `\n### [Sub-service ${i}]\n~${cell.wordsEach || 60} word paragraph\n`
      }
      if (ns) out += ns + '\n'
      return out
    }

    case 'steps': {
      let out = `## ${h}\nOne intro sentence. Then ${cell.count} steps in this format:\n`
      for (let i = 1; i <= cell.count; i++) {
        out += `\n**Step ${i}: [Step Name]**\n~${cell.wordsEach || 60} word paragraph\n`
      }
      if (ns) out += ns + '\n'
      return out
    }

    case 'faq':
      return `## ${h}\nExactly ${cell.count} Q&As. Use **bold question** format, then a paragraph answer${wn} each.${ns}\n`

    case 'cta':
      return `## ${h}\n1–2 sentences inviting them to call or fill out the form for a free evaluation.${ns}\n`

    default:
      return ''
  }
}

export function buildPromptFromTemplate(
  sections: TemplateSection[],
  vars: { companyName: string; service: string; city: string; state: string; subServices?: string }
): string {
  const v: Vars = { service: vars.service, city: vars.city, state: vars.state, company: vars.companyName }
  let out = `# ${vars.service} in ${vars.city}, ${vars.state}\n`

  for (const sec of sections) {
    if (sec.contentType === 'table') {
      if (sec.leftCol && sec.rightCol) {
        out += `\n[COL-LEFT]\n${buildCellContent(sec.leftCol, v, vars.subServices)}[COL-RIGHT]\n${buildCellContent(sec.rightCol, v, vars.subServices)}[COL-END]\n`
      }
      continue
    }

    // Non-table sections — delegate to the same helper
    out += '\n' + buildCellContent(
      {
        contentType: sec.contentType as Exclude<ContentType, 'table'>,
        heading: sec.heading,
        count: sec.count,
        wordsEach: sec.wordsEach,
        notes: sec.notes,
      },
      v,
      vars.subServices
    )
  }

  return out
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
