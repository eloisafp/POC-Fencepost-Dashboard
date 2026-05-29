// Shared parser logic used by both single and bulk generators

export type PageType = 'service-location' | 'service-only'

export type Block =
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

export type SEOMeta = { titleTag: string; metaDescription: string; urlSlug: string }

export function parseBlocks(content: string): Block[] {
  const lines = content.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const t = lines[i].trim()
    if (!t) { i++; continue }

    if (t.startsWith('# ')) {
      blocks.push({ type: 'h1', text: t.slice(2) }); i++
    } else if (t.startsWith('## ')) {
      blocks.push({ type: 'h2', text: t.slice(3) }); i++
    } else if (t.startsWith('### ')) {
      blocks.push({ type: 'h3', text: t.slice(4) }); i++
    } else if (/^\*\*Step \d+:/.test(t)) {
      const m = t.match(/^\*\*Step (\d+): (.+?)\**$/)
      const number = m ? parseInt(m[1]) : blocks.filter(b => b.type === 'step').length + 1
      const title = m ? m[2].replace(/\*+$/, '') : t.replace(/\*\*/g, '')
      i++
      let body = ''
      while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith('#') && !/^\*\*/.test(lines[i].trim())) {
        body += (body ? ' ' : '') + lines[i].trim(); i++
      }
      blocks.push({ type: 'step', number, title, body })
    } else if (/^\*\*[^*]+\?[^*]*\*\*$/.test(t) || /^\*\*[^*]+\?\s*$/.test(t)) {
      const question = t.replace(/\*\*/g, '')
      i++
      let answer = ''
      while (i < lines.length && lines[i].trim() && !/^\*\*/.test(lines[i].trim()) && !lines[i].trim().startsWith('#')) {
        answer += (answer ? ' ' : '') + lines[i].trim(); i++
      }
      blocks.push({ type: 'faq', question, answer })
    } else if (/^\*\*[^*]+\*\*$/.test(t)) {
      blocks.push({ type: 'h3', text: t.replace(/\*\*/g, '') }); i++
    } else if (t.startsWith('- ') || t.startsWith('• ')) {
      const items: string[] = []
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('• '))) {
        items.push(lines[i].trim().slice(2)); i++
      }
      blocks.push({ type: 'list', items })
    } else if (/^\[COL-LEFT\]$/i.test(t)) {
      i++
      const leftLines: string[] = []
      while (i < lines.length && !/^\[COL-RIGHT\]$/i.test(lines[i].trim())) {
        leftLines.push(lines[i]); i++
      }
      if (i < lines.length) i++
      const rightLines: string[] = []
      while (i < lines.length && !/^\[COL-END\]$/i.test(lines[i].trim())) {
        rightLines.push(lines[i]); i++
      }
      if (i < lines.length) i++
      blocks.push({
        type: 'twocol',
        left:  parseBlocks(leftLines.join('\n')),
        right: parseBlocks(rightLines.join('\n')),
      })
    } else if (/^\[IMAGE:/i.test(t)) {
      const caption = t.replace(/^\[IMAGE:\s*/i, '').replace(/\]$/, '').trim()
      blocks.push({ type: 'image', caption }); i++
    } else if (/^\[.+\]$/.test(t)) {
      blocks.push({ type: 'cta', text: t.slice(1, -1) }); i++
    } else {
      blocks.push({ type: 'paragraph', text: t }); i++
    }
  }
  return blocks
}

export function postProcessBlocks(blocks: Block[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < blocks.length) {
    const b = blocks[i]
    if (b.type === 'image' && i + 1 < blocks.length && blocks[i + 1].type === 'h2') {
      const right: Block[] = []
      let j = i + 1
      right.push(blocks[j++])
      while (j < blocks.length && blocks[j].type !== 'h2') right.push(blocks[j++])
      out.push({ type: 'twocol', left: [b], right })
      i = j
    } else {
      out.push(b); i++
    }
  }
  return out
}

export function parseOutput(text: string): { seo: SEOMeta; content: string } {
  const seoBlock     = text.match(/---SEO---\r?\n([\s\S]*?)(?:---PAGE---|$)/)?.[1] ?? ''
  const contentBlock = text.match(/---PAGE---\r?\n([\s\S]*?)(?:---END---|$)/)?.[1]?.trimEnd() ?? ''
  return {
    seo: {
      titleTag:        seoBlock.match(/TITLE:\s*(.+)/)?.[1]?.trim() ?? '',
      metaDescription: seoBlock.match(/META:\s*(.+)/)?.[1]?.trim() ?? '',
      urlSlug:         seoBlock.match(/URL:\s*(.+)/)?.[1]?.trim() ?? '',
    },
    content: contentBlock,
  }
}
