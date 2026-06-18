import {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink,
  HeadingLevel, AlignmentType, BorderStyle, LevelFormat,
} from 'docx'

// ── Types ─────────────────────────────────────────────────────────────────────

type Inline = { text: string; href?: string }

type Seg =
  | { k: 'meta';  text: string }
  | { k: 'h1';   text: string }
  | { k: 'h2';   text: string }
  | { k: 'h3';   text: string }
  | { k: 'p';    inlines: Inline[] }
  | { k: 'list'; items: Inline[][] }

// ── HTML helpers ──────────────────────────────────────────────────────────────

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function stripTagsNoTrim(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
}

function parseInlines(html: string): Inline[] {
  const inlines: Inline[] = []
  const re = /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) {
      const text = stripTagsNoTrim(html.slice(last, m.index))
      if (text) inlines.push({ text })
    }
    const text = stripTagsNoTrim(m[2])
    if (text) inlines.push({ text, href: m[1] })
    last = m.index + m[0].length
  }
  if (last < html.length) {
    const text = stripTagsNoTrim(html.slice(last))
    if (text) inlines.push({ text })
  }
  return inlines.length > 0 ? inlines : [{ text: stripTags(html) }]
}

// ── HTML parser ───────────────────────────────────────────────────────────────

function parseHtml(html: string): Seg[] {
  const out: Seg[] = []
  let rem = html.trim().replace(/<br\s*\/?>/gi, ' ')

  while (rem.length > 0) {
    rem = rem.trimStart()
    if (!rem) break

    // ul / ol list
    const listM = rem.match(/^<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/i)
    if (listM) {
      const items: Inline[][] = []
      const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi
      let m: RegExpExecArray | null
      while ((m = liRe.exec(listM[2])) !== null) {
        const inlines = parseInlines(m[1])
        if (inlines.some(i => i.text)) items.push(inlines)
      }
      if (items.length) out.push({ k: 'list', items })
      rem = rem.slice(listM[0].length)
      continue
    }

    // h1, h2, h3, p
    const tagM = rem.match(/^<(h1|h2|h3|p)\b[^>]*>([\s\S]*?)<\/\1>/i)
    if (tagM) {
      const tag  = tagM[1].toLowerCase()
      const raw  = tagM[2]
      const text = stripTags(raw)
      if (text) {
        if (tag === 'h1') out.push({ k: 'h1', text })
        else if (tag === 'h2') out.push({ k: 'h2', text })
        else if (tag === 'h3') out.push({ k: 'h3', text })
        else if (/^Meta (Title|Description)\s*\d/i.test(text) || /^URL Slug:/i.test(text)) out.push({ k: 'meta', text })
        else out.push({ k: 'p', inlines: parseInlines(raw) })
      }
      rem = rem.slice(tagM[0].length)
      continue
    }

    // skip unknown tags / text nodes
    const next = rem.indexOf('<', 1)
    if (next < 0) break
    rem = rem.slice(next)
  }

  return out
}

// ── Inline → docx children ────────────────────────────────────────────────────

function inlinesToChildren(inlines: Inline[], runProps: { font: string; size: number; color?: string }) {
  return inlines.map(inline => {
    const run = new TextRun({
      text:  inline.text,
      font:  runProps.font,
      size:  runProps.size,
      color: inline.href ? '1155CC' : runProps.color,
      underline: inline.href ? {} : undefined,
    })
    if (inline.href) {
      return new ExternalHyperlink({ link: inline.href, children: [run] })
    }
    return run
  })
}

// ── Seg → Paragraphs ──────────────────────────────────────────────────────────

function segToParas(seg: Seg): Paragraph[] {
  switch (seg.k) {
    case 'meta':
      return [new Paragraph({
        children: [new TextRun({ text: seg.text, font: 'Arial', size: 22, color: '475569' })],
        spacing: { before: 0, after: 80 },
      })]

    case 'h1':
      return [new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: seg.text, bold: true, font: 'Arial', size: 36 })],
        spacing: { before: 200, after: 200 },
      })]

    case 'h2':
      return [new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: seg.text, bold: true, font: 'Arial', size: 28 })],
        spacing: { before: 400, after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0', space: 4 } },
      })]

    case 'h3':
      return [new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: seg.text, bold: true, font: 'Arial', size: 24 })],
        spacing: { before: 240, after: 80 },
      })]

    case 'p':
      return [new Paragraph({
        children: inlinesToChildren(seg.inlines, { font: 'Arial', size: 24 }),
        spacing: { before: 0, after: 160 },
      })]

    case 'list':
      return seg.items.map(inlines => new Paragraph({
        numbering: { reference: 'bullets', level: 0 },
        children: inlinesToChildren(inlines, { font: 'Arial', size: 24 }),
        spacing: { before: 60, after: 60 },
      }))
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { html, companyName, blogTitle, blogMonth }: {
    html: string
    companyName: string
    blogTitle: string
    blogMonth: string
  } = await req.json()

  const segments   = parseHtml(html || '')
  const reviewDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 560, hanging: 360 } } },
        }],
      }],
    },
    styles: {
      default: { document: { run: { font: 'Arial', size: 24 } } },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run:       { size: 36, bold: true, font: 'Arial', color: '0F172A' },
          paragraph: { spacing: { before: 0, after: 200 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run:       { size: 28, bold: true, font: 'Arial', color: '1E293B' },
          paragraph: { spacing: { before: 400, after: 120 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run:       { size: 24, bold: true, font: 'Arial', color: '334155' },
          paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 2 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size:   { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 },
        },
      },
      children: [
        // ── Review banner ────────────────────────────────────────────────────
        new Paragraph({
          children: [
            new TextRun({ text: (companyName || '').toUpperCase(), font: 'Arial', size: 28, bold: true, color: '18391A' }),
            new TextRun({ text: '  |  Blog for Review  |  ', font: 'Arial', size: 28, color: '18391A' }),
            new TextRun({ text: reviewDate, font: 'Arial', size: 28, color: '18391A' }),
          ],
          spacing: { after: 160 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0', space: 4 } },
        }),
        new Paragraph({ children: [], spacing: { after: 200 } }),

        // ── Blog content ─────────────────────────────────────────────────────
        ...segments.flatMap(seg => segToParas(seg)),
      ],
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  const uint8  = new Uint8Array(buffer)
  const slug   = (blogTitle || 'blog')
    .replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase().slice(0, 60)

  return new Response(uint8, {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${slug}.docx"`,
    },
  })
}
