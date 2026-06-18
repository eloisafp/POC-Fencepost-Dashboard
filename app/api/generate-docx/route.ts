import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, VerticalAlign,
} from 'docx'
// Note: Table/TableRow/TableCell/WidthType/VerticalAlign used by twocol block

// ── Types (mirror of page.tsx Block) ─────────────────────────────────────────
type Block =
  | { type: 'h1';        text: string }
  | { type: 'h2';        text: string }
  | { type: 'h3';        text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list';      items: string[] }
  | { type: 'cta';       text: string }
  | { type: 'image';     caption: string }
  | { type: 'step';      number: number; title: string; body: string }
  | { type: 'faq';       question: string; answer: string }
  | { type: 'twocol';    left: Block[]; right: Block[]; leftWidth?: number }

type SEOMeta = { titleTag: string; metaDescription: string; urlSlug: string }
type Form    = { companyName: string; service: string; city: string; state: string; subServices: string; websiteUrl: string; pageType?: string }

// ── Constants ─────────────────────────────────────────────────────────────────
const CONTENT_WIDTH = 9360   // US Letter 8.5" - 2×1" margins, in DXA
const BORDER_NONE   = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const ALL_NONE      = { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE }

// ── Block → docx paragraphs ───────────────────────────────────────────────────

function blocksToDocx(blocks: Block[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  for (const b of blocks) {
    out.push(...blockToDocx(b))
  }
  return out
}

function blockToDocx(b: Block): (Paragraph | Table)[] {
  switch (b.type) {

    case 'h1':
      return [new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: b.text, bold: true, font: 'Arial', size: 36 })],
        spacing: { before: 0, after: 200 },
      })]

    case 'h2':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: b.text, bold: true, font: 'Arial', size: 28 })],
          spacing: { before: 400, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0', space: 4 } },
        }),
      ]

    case 'h3':
      return [new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: b.text, bold: true, font: 'Arial', size: 24 })],
        spacing: { before: 240, after: 80 },
      })]

    case 'paragraph':
      return [new Paragraph({
        children: [new TextRun({ text: b.text, font: 'Arial', size: 24 })],
        spacing: { before: 0, after: 160 },
      })]

    case 'list':
      return b.items.map(item => new Paragraph({
        numbering: { reference: 'bullets', level: 0 },
        children: [new TextRun({ text: item, font: 'Arial', size: 24 })],
        spacing: { before: 60, after: 60 },
      }))

    case 'step':
      return [
        new Paragraph({
          children: [
            new TextRun({ text: `Step ${b.number}: `, bold: true, font: 'Arial', size: 24, color: '18181B' }),
            new TextRun({ text: b.title, bold: true, font: 'Arial', size: 24, color: '18181B' }),
          ],
          spacing: { before: 240, after: 80 },
        }),
        new Paragraph({
          children: [new TextRun({ text: b.body, font: 'Arial', size: 24, color: '475569' })],
          indent: { left: 360 },
          spacing: { before: 0, after: 160 },
        }),
      ]

    case 'faq':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: b.question, bold: true, font: 'Arial', size: 24, color: '334155' })],
          spacing: { before: 240, after: 80 },
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0', space: 4 } },
        }),
        new Paragraph({
          children: [new TextRun({ text: b.answer, font: 'Arial', size: 24, color: '64748B' })],
          spacing: { before: 0, after: 160 },
        }),
      ]

    case 'cta':
      return [new Paragraph({
        children: [new TextRun({ text: `→ ${b.text}`, bold: true, font: 'Arial', size: 24, color: '18181B' })],
        spacing: { before: 200, after: 200 },
        shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
        border: {
          top:    { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0', space: 2 },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0', space: 2 },
          left:   { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0', space: 2 },
          right:  { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0', space: 2 },
        },
      })]

    case 'image': {
      const isHtmlEmbed = b.caption.trim().startsWith('<')
      const label = isHtmlEmbed ? '[ HTML Embed — view in browser ]' : `📷  ${b.caption}`
      return [new Paragraph({
        children: [new TextRun({ text: label, font: 'Arial', size: 22, color: isHtmlEmbed ? '6366F1' : '94A3B8', italics: !isHtmlEmbed })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 200 },
        shading: { fill: isHtmlEmbed ? 'EEF2FF' : 'F1F5F9', type: ShadingType.CLEAR },
        border: {
          top:    { style: BorderStyle.DASHED, size: 6, color: isHtmlEmbed ? 'A5B4FC' : 'CBD5E1', space: 6 },
          bottom: { style: BorderStyle.DASHED, size: 6, color: isHtmlEmbed ? 'A5B4FC' : 'CBD5E1', space: 6 },
          left:   { style: BorderStyle.DASHED, size: 6, color: isHtmlEmbed ? 'A5B4FC' : 'CBD5E1', space: 6 },
          right:  { style: BorderStyle.DASHED, size: 6, color: isHtmlEmbed ? 'A5B4FC' : 'CBD5E1', space: 6 },
        },
      })]
    }

    case 'twocol': {
      const lw    = b.leftWidth ?? 45
      const leftW = Math.round(CONTENT_WIDTH * lw / 100)
      const rightW = CONTENT_WIDTH - leftW

      const cellStyle = (children: (Paragraph | Table)[]) =>
        new TableCell({
          borders: ALL_NONE,
          width: { size: leftW, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 0, right: 240 },
          verticalAlign: VerticalAlign.TOP,
          children,
        })

      return [new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths: [leftW, rightW],
        borders: {
          top: BORDER_NONE, bottom: BORDER_NONE,
          left: BORDER_NONE, right: BORDER_NONE,
        },
        rows: [new TableRow({
          children: [
            new TableCell({
              borders: ALL_NONE,
              width: { size: leftW, type: WidthType.DXA },
              margins: { top: 80, bottom: 80, left: 0, right: 240 },
              verticalAlign: VerticalAlign.TOP,
              children: blocksToDocx(b.left) as Paragraph[],
            }),
            new TableCell({
              borders: ALL_NONE,
              width: { size: rightW, type: WidthType.DXA },
              margins: { top: 80, bottom: 80, left: 120, right: 0 },
              verticalAlign: VerticalAlign.TOP,
              children: blocksToDocx(b.right) as Paragraph[],
            }),
          ],
        })],
      })]
    }

    default:
      return []
  }
}

// ── SEO meta block ────────────────────────────────────────────────────────────

function seoMetaBlock(seo: SEOMeta): Paragraph[] {
  function metaLine(label: string, value: string): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({ text: `${label}: `, font: 'Arial', size: 22, bold: true, color: '334155' }),
        new TextRun({ text: value || '—', font: 'Arial', size: 22, color: '475569' }),
      ],
      spacing: { before: 0, after: 80 },
    })
  }

  return [
    metaLine('Title Tag',        seo.titleTag),
    metaLine('Meta Description', seo.metaDescription),
    metaLine('URL',              seo.urlSlug),
  ]
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { seo, blocks, form }: { seo: SEOMeta; blocks: Block[]; form: Form } = await req.json()

  const reviewDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 560, hanging: 360 } } },
          }],
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 24 } },
      },
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
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 },
        },
      },
      children: [
        // ── Review banner ──────────────────────────────────────────────────
        new Paragraph({
          children: [
            new TextRun({ text: form.companyName.toUpperCase(), font: 'Arial', size: 28, bold: true, color: '18391A' }),
            new TextRun({ text: ` - ${[form.service, form.city].filter(Boolean).join(' ')}`, font: 'Arial', size: 28, bold: true, color: '18391A' }),
            new TextRun({ text: '  |  Page For Review  |  ', font: 'Arial', size: 28, color: '18391A' }),
            new TextRun({ text: reviewDate, font: 'Arial', size: 28, color: '18391A' }),
          ],
          spacing: { after: 160 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0', space: 4 } },
        }),
        ...seoMetaBlock(seo),
        new Paragraph({ children: [], spacing: { after: 320 } }),

        // ── Page content ───────────────────────────────────────────────────
        ...blocksToDocx(blocks) as Paragraph[],
      ],
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  const uint8  = new Uint8Array(buffer)

  const slug = (seo.urlSlug || `${form.service}-${form.city || 'page'}`)
    .replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase()

  return new Response(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${slug}.docx"`,
    },
  })
}
