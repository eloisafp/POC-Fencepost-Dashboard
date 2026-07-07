import { supabase } from '../lib/supabase'
import { type Block, type SEOMeta } from './pageParser'

// ── Counter ───────────────────────────────────────────────────────────────────

export async function getNextDocNumber(clientName: string): Promise<number> {
  const { data, error } = await supabase.rpc('increment_doc_counter', { p_client_name: clientName })
  if (error) throw new Error(`Counter error: ${error.message}`)
  return data as number
}

// ── Doc creation ──────────────────────────────────────────────────────────────

export async function createMasterDoc(
  title: string,
  folderId: string,
  accessToken: string,
): Promise<string> {
  const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!createRes.ok) throw new Error(`Create doc failed: ${await createRes.text()}`)
  const { documentId } = await createRes.json()

  // Get current parents so we can remove them when adding the target folder
  const fileRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${documentId}?fields=parents`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const fileData = await fileRes.json()
  const currentParents = (fileData.parents ?? []).join(',')

  await fetch(
    `https://www.googleapis.com/drive/v3/files/${documentId}?addParents=${folderId}${currentParents ? `&removeParents=${currentParents}` : ''}&fields=id`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}` } },
  )

  return documentId
}

// ── Tab management ────────────────────────────────────────────────────────────

const DOC_TIMEOUT_MS = 30_000

export async function getDefaultTabId(docId: string, accessToken: string): Promise<string | null> {
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}?includeTabsContent=false`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(DOC_TIMEOUT_MS) },
  )
  const doc = await res.json()
  return doc.tabs?.[0]?.tabProperties?.tabId ?? null
}

export async function renameTab(
  docId: string,
  tabId: string | null,
  title: string,
  accessToken: string,
): Promise<void> {
  if (!tabId) return
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ updateTabProperties: { tabProperties: { tabId, title }, fields: 'title' } }],
    }),
    signal: AbortSignal.timeout(DOC_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Rename tab failed: ${await res.text()}`)
}

export async function addTab(
  docId: string,
  title: string,
  accessToken: string,
): Promise<string> {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ createTab: { tabProperties: { title, nestingLevel: 0 } } }],
    }),
    signal: AbortSignal.timeout(DOC_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Add tab failed: ${await res.text()}`)
  const data = await res.json()
  return data.replies?.[0]?.createTab?.tabProperties?.tabId ?? ''
}

// ── Content writing ───────────────────────────────────────────────────────────

export async function writeContentToTab(
  docId: string,
  tabId: string | null,
  seo: SEOMeta,
  blocks: Block[],
  accessToken: string,
  pageHeader?: string,
  append?: boolean,
): Promise<void> {
  const apiBase = `https://docs.googleapis.com/v1/documents/${docId}`
  const auth = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }

  const TIMEOUT_MS = 30_000

  async function doBatch(requests: any[]) {
    if (!requests.length) return
    const r = await fetch(`${apiBase}:batchUpdate`, {
      method: 'POST', headers: auth, body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) throw new Error(`Write content failed (${r.status}): ${await r.text()}`)
  }

  async function readBodyContent(): Promise<any[]> {
    const r = await fetch(`${apiBase}?includeTabsContent=true`, {
      headers: auth,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) throw new Error(`Read doc failed (${r.status}): ${await r.text()}`)
    const doc = await r.json()
    if (tabId) {
      return doc.tabs?.find((t: any) => t.tabProperties?.tabId === tabId)
        ?.documentTab?.body?.content ?? []
    }
    return doc.tabs?.[0]?.documentTab?.body?.content ?? doc.body?.content ?? []
  }

  async function getDocEnd(): Promise<number> {
    const content = await readBodyContent()
    if (!content.length) return 1
    return content[content.length - 1].endIndex - 1
  }

  const mkLoc = (index: number): any => tabId ? { index, tabId } : { index }
  const mkRng = (startIndex: number, endIndex: number): any =>
    tabId ? { startIndex, endIndex, tabId } : { startIndex, endIndex }

  // Build insert + style requests for a flat list of blocks (no twocol) at a given start index.
  // Returns inserts[], styles[], and total chars inserted.
  function buildFlat(
    blockList: Block[],
    startAt: number,
  ): { inserts: any[]; styles: any[]; length: number } {
    const inserts: any[] = []
    const styles: any[] = []
    let idx = startAt

    const ins = (text: string) => {
      inserts.push({ insertText: { location: mkLoc(idx), text } })
      idx += text.length
    }
    const sty = (s: number, e: number, ns: string) =>
      styles.push({
        updateParagraphStyle: {
          range: mkRng(s, e),
          paragraphStyle: { namedStyleType: ns },
          fields: 'namedStyleType',
        },
      })

    for (const b of blockList) {
      switch (b.type) {
        case 'h1': { const s = idx; ins(b.text + '\n'); sty(s, idx, 'HEADING_1'); break }
        case 'h2': { const s = idx; ins(b.text + '\n'); sty(s, idx, 'HEADING_2'); break }
        case 'h3': { const s = idx; ins(b.text + '\n'); sty(s, idx, 'HEADING_3'); break }
        case 'paragraph':
        case 'cta': { const s = idx; ins(b.text + '\n'); sty(s, idx, 'NORMAL_TEXT'); break }
        case 'image': { const s = idx; ins(`[Image: ${b.caption}]\n`); sty(s, idx, 'NORMAL_TEXT'); break }
        case 'step': {
          const s = idx; ins(`Step ${b.number}: ${b.title}\n`); sty(s, idx, 'HEADING_3')
          if (b.body) { const p = idx; ins(b.body + '\n'); sty(p, idx, 'NORMAL_TEXT') }
          break
        }
        case 'faq': {
          const s = idx; ins(b.question + '\n'); sty(s, idx, 'HEADING_3')
          const a = idx; ins(b.answer + '\n'); sty(a, idx, 'NORMAL_TEXT')
          break
        }
        case 'list': {
          if (!b.items.length) break
          const rs = idx
          for (const item of b.items) ins(item + '\n')
          styles.push({
            createParagraphBullets: {
              range: mkRng(rs, idx),
              bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
            },
          })
          break
        }
      }
    }

    return { inserts, styles, length: idx - startAt }
  }

  // ── Build header + SEO as first batch ─────────────────────────────────────

  let wi = append ? await getDocEnd() : 1
  const prefInserts: any[] = []
  const prefStyles: any[] = []

  const pIns = (text: string) => {
    prefInserts.push({ insertText: { location: mkLoc(wi), text } })
    wi += text.length
  }
  const pSty = (s: number, e: number, ns: string) =>
    prefStyles.push({
      updateParagraphStyle: {
        range: mkRng(s, e),
        paragraphStyle: { namedStyleType: ns },
        fields: 'namedStyleType',
      },
    })

  if (pageHeader) {
    const s = wi; pIns(pageHeader + '\n')
    pSty(s, wi, 'HEADING_1')
    prefStyles.push({
      updateTextStyle: {
        range: mkRng(s, wi),
        textStyle: {
          fontSize: { magnitude: 14, unit: 'PT' },
          foregroundColor: { color: { rgbColor: { red: 24 / 255, green: 57 / 255, blue: 26 / 255 } } },
          bold: true,
        },
        fields: 'fontSize,foregroundColor,bold',
      },
    })
    // Horizontal rule under the header
    prefStyles.push({
      updateParagraphStyle: {
        range: mkRng(s, wi),
        paragraphStyle: {
          borderBottom: {
            color: { color: { rgbColor: { red: 0.8, green: 0.8, blue: 0.8 } } },
            width: { magnitude: 1, unit: 'PT' },
            dashStyle: 'SOLID',
            padding: { magnitude: 4, unit: 'PT' },
          },
          spaceBelow: { magnitude: 6, unit: 'PT' },
        },
        fields: 'borderBottom,spaceBelow',
      },
    })
  }

  const seoS = wi
  pIns(`Title Tag: ${seo.titleTag}\nMeta Description: ${seo.metaDescription}\nURL: ${seo.urlSlug}\n\n`)
  pSty(seoS, wi, 'NORMAL_TEXT')

  // ── Segment blocks: runs of flat blocks separated by twocol entries ────────

  type TwoColBlock = Block & { type: 'twocol' }
  type Segment = { flat: Block[]; twocol: TwoColBlock | null }
  const segments: Segment[] = []
  let currentFlat: Block[] = []
  for (const b of blocks) {
    if (b.type === 'twocol') {
      segments.push({ flat: currentFlat, twocol: b as TwoColBlock })
      currentFlat = []
    } else {
      currentFlat.push(b)
    }
  }
  segments.push({ flat: currentFlat, twocol: null })

  // ── First batch: prefix + first flat segment ───────────────────────────────

  const { inserts: s0i, styles: s0s } = buildFlat(segments[0].flat, wi)
  await doBatch([...prefInserts, ...s0i, ...prefStyles, ...s0s])

  // ── Process remaining segments (each preceded by a twocol table) ───────────

  for (let si = 1; si < segments.length; si++) {
    const tc = segments[si - 1].twocol!

    // 1. Insert 1×2 table at current doc end
    const tableAt = await getDocEnd()
    await doBatch([{ insertTable: { rows: 1, columns: 2, location: mkLoc(tableAt) } }])

    // 2. Read doc to find actual table start + cell paragraph start indices
    // Note: insertTable may insert a newline before the table, so the actual
    // table.startIndex may be tableAt+1. Capture it here for use in cell/column style requests.
    const content = await readBodyContent()
    let cell1Start = -1, cell2Start = -1, actualTableStart = -1
    for (const elem of content) {
      if (elem.table && elem.startIndex >= tableAt - 1) {
        const cells = elem.table?.tableRows?.[0]?.tableCells
        if (cells?.length >= 2) {
          actualTableStart = elem.startIndex
          cell1Start = cells[0].content?.[0]?.startIndex ?? cells[0].startIndex + 2
          cell2Start = cells[1].content?.[0]?.startIndex ?? cells[1].startIndex + 2
          break
        }
      }
    }
    if (cell1Start < 0) throw new Error('Could not find table cell indices after insertTable')

    // 3. Build cell content — cell2 start shifts by however much we insert into cell1
    const { inserts: li, styles: ls, length: ll } = buildFlat(tc.left, cell1Start)
    const { inserts: ri, styles: rs } = buildFlat(tc.right, cell2Start + ll)

    // 4. Remove cell borders (borderless table like reference DOCX)
    const noBorder = {
      color: { color: { rgbColor: {} } },
      width: { magnitude: 0, unit: 'PT' },
      dashStyle: 'SOLID',
    }
    const borderFields = 'borderLeft,borderRight,borderTop,borderBottom'
    const removeBorders = (colIndex: number) => ({
      updateTableCellStyle: {
        tableRange: {
          tableCellLocation: {
            tableStartLocation: mkLoc(actualTableStart),
            rowIndex: 0,
            columnIndex: colIndex,
          },
          rowSpan: 1,
          columnSpan: 1,
        },
        tableCellStyle: {
          borderLeft: noBorder, borderRight: noBorder,
          borderTop: noBorder, borderBottom: noBorder,
        },
        fields: borderFields,
      },
    })

    // Set column widths proportionally based on leftWidth (US Letter content = 468pt)
    const CONTENT_PT = 468
    const leftPct    = tc.leftWidth ?? 45
    const leftPt     = Math.round(CONTENT_PT * leftPct / 100)
    const rightPt    = CONTENT_PT - leftPt
    const setColWidth = (colIndex: number, widthPt: number) => ({
      updateTableColumnProperties: {
        tableStartLocation: mkLoc(actualTableStart),
        columnIndices: [colIndex],
        tableColumnProperties: {
          widthType: 'FIXED_WIDTH',
          width: { magnitude: widthPt, unit: 'PT' },
        },
        fields: 'widthType,width',
      },
    })

    await doBatch([...li, ...ri, ...ls, ...rs,
      removeBorders(0), removeBorders(1),
      setColWidth(0, leftPt), setColWidth(1, rightPt),
    ])

    // 5. Write this segment's flat content
    if (segments[si].flat.length > 0) {
      const segStart = await getDocEnd()
      const { inserts, styles } = buildFlat(segments[si].flat, segStart)
      await doBatch([...inserts, ...styles])
    }
  }
}
