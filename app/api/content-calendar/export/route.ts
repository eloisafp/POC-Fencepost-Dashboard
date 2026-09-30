import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { supabaseServer } from '../../../../lib/keyword-pipeline/server'

// GET /api/content-calendar/export?round_id=123 -> .xlsx download
// Tabs: Content Calendar (the deliverable) | Keyword Pool | Not Included (and why) | Competitors
export const maxDuration = 120

const HEADER_FILL = 'FFF1F5F9'
const MONTH_FILL = 'FFEFF6FF'

function header(sheet: ExcelJS.Worksheet, columns: string[], widths: number[]) {
  const row = sheet.addRow(columns)
  row.font = { bold: true }
  row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } } })
  columns.forEach((_, i) => { sheet.getColumn(i + 1).width = widths[i] ?? 18 })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

export async function GET(req: NextRequest) {
  try {
    const roundId = req.nextUrl.searchParams.get('round_id')
    if (!roundId) return Response.json({ error: 'round_id is required' }, { status: 400 })

    const sb = supabaseServer()
    const { data: round } = await sb.from('content_calendar_rounds').select('*').eq('id', roundId).single()
    if (!round) return Response.json({ error: 'Round not found' }, { status: 404 })

    const { data: items } = await sb.from('content_calendar_items')
      .select('*').eq('round_id', roundId).order('month_index').order('id')

    const wb = new ExcelJS.Workbook()
    wb.creator = 'Fencepost Dashboard'

    // ---- Tab 1: Content Calendar --------------------------------------------
    const cal = wb.addWorksheet('Content Calendar')
    header(cal,
      ['Month', 'Keyword', 'Blog Title', "Why It's Useful", 'Intent', 'Volume', 'KD', 'CPC', 'Source', 'Competitor'],
      [16, 30, 46, 64, 9, 10, 7, 9, 17, 22])

    let lastMonth = ''
    for (const it of items || []) {
      const row = cal.addRow([
        it.month_label ?? '', it.keyword ?? '', it.blog_title ?? '', it.why_useful ?? '',
        it.intent ?? '', it.volume ?? '', it.kd ?? '', it.cpc ?? '', it.source ?? '', it.competitor ?? '',
      ])
      row.alignment = { vertical: 'top', wrapText: true }
      // Band each new month so the 12-month rhythm is readable at a glance
      if (it.month_label !== lastMonth) {
        row.getCell(1).font = { bold: true }
        row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MONTH_FILL } } })
        lastMonth = it.month_label
      }
    }

    // ---- Tab 2: Keyword Pool -------------------------------------------------
    const pool = wb.addWorksheet('Keyword Pool')
    header(pool, ['Keyword', 'Volume', 'KD', 'CPC', 'Intent', 'Source', 'Competitor'], [38, 10, 7, 9, 9, 17, 24])
    for (const k of (round.keyword_pool || []) as any[]) {
      pool.addRow([k.keyword ?? '', k.volume ?? '', k.kd ?? '', k.cpc ?? '', k.intent ?? '', k.source ?? '', k.competitor ?? ''])
    }

    // ---- Tab 3: Not Included (and why) --------------------------------------
    const notInc = wb.addWorksheet('Not Included (and why)')
    header(notInc, ['Topic requested', 'Why it was not included'], [38, 70])
    const excludedRows = (round.excluded || []) as any[]
    if (excludedRows.length === 0) {
      notInc.addRow(['—', 'Everything requested in the brief was covered.'])
    } else {
      for (const e of excludedRows) notInc.addRow([e.topic ?? '', e.reason ?? ''])
    }
    notInc.getColumn(2).alignment = { wrapText: true, vertical: 'top' }

    // ---- Tab 4: Competitors --------------------------------------------------
    const comps = wb.addWorksheet('Competitors')
    header(comps, ['Competitor', 'Domain', 'How it was chosen'], [28, 30, 26])
    for (const c of (round.competitors || []) as any[]) {
      comps.addRow([c.name ?? '', c.domain ?? '', c.auto ? 'Auto-derived from SERPs' : 'Provided'])
    }

    // ---- Tab 5: Run summary --------------------------------------------------
    const info = wb.addWorksheet('Run Summary')
    header(info, ['Field', 'Value'], [26, 90])
    const mofu = (items || []).filter(i => i.intent === 'MOFU').length
    const rows: [string, any][] = [
      ['Client', round.client_name ?? ''],
      ['Blogs per month', round.blogs_per_month],
      ['Total posts planned', (items || []).length],
      ['MOFU / BOFU', `${mofu} / ${(items || []).length - mofu}`],
      ['Keyword pool size', ((round.keyword_pool || []) as any[]).length],
      ['Notes source', round.notes_source ?? ''],
      ['Brief', round.notes ?? ''],
      ['Seeds used', ((round.seeds || []) as any[]).join(', ')],
      ['Ahrefs units used', round.ahrefs_units_used ?? 0],
      ['Generated', new Date(round.created_at).toLocaleString('en-US')],
    ]
    for (const [k, v] of rows) info.addRow([k, v])
    for (const w of (round.warnings || []) as string[]) info.addRow(['Warning', w])
    info.getColumn(2).alignment = { wrapText: true, vertical: 'top' }

    const buffer = await wb.xlsx.writeBuffer()
    const safeName = String(round.client_name || 'Client').replace(/[^a-z0-9]+/gi, '')
    const stamp = new Date().toISOString().slice(0, 7)
    const filename = `${safeName}_Content-Calendar_${stamp}.xlsx`

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err: any) {
    console.error('content-calendar/export error:', err)
    return Response.json({ error: err.message || 'Export failed' }, { status: 500 })
  }
}
