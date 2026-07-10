import ExcelJS from 'exceljs'
import type { SupabaseClient } from '@supabase/supabase-js'

// Phase 5 — builds the multi-tab Excel workbook for a run. Shared by the direct
// download route (GET /api/keyword-pipeline/export) and the save-to-storage route
// (POST /api/keyword-pipeline/export/save).
// Tab spec (ported from lib/keyword-pipeline/pipeline-overview.md, colors generalized
// per-run instead of hardcoded to one client's service names):
//   1. Content Calendar — blog rows then location rows, color-coded by service_category
//   2. KW Summary — one row per cluster (aggregated live from keyword_pipeline_keywords), + TOTAL
//   3. All Keywords — flat list, Bucket colored same as tab 1
//   4. Keyword Map — one row per existing_pages entry flagged include_in_keyword_map
//   5+. One tab per cluster (slug truncated to Excel's 31-char tab-name limit)

const SERVICE_PALETTE = ['FFE8A838', 'FF2E75B6', 'FF548235', 'FF7030A0', 'FFC00000', 'FF00B0B9']

function colorForService(service: string | null, order: string[]): string {
  if (!service) return 'FF9CA3AF' // gray for uncategorized
  let idx = order.indexOf(service)
  if (idx === -1) { order.push(service); idx = order.length - 1 }
  return SERVICE_PALETTE[idx % SERVICE_PALETTE.length]
}

function headerRow(sheet: ExcelJS.Worksheet, columns: string[]) {
  const row = sheet.addRow(columns)
  row.font = { bold: true }
  row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } } })
}

export async function buildWorkbook(sb: SupabaseClient, runId: string | number): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const { data: run, error: runError } = await sb
    .from('keyword_pipeline_runs')
    .select('client_slug, existing_pages, intake')
    .eq('id', runId)
    .single()
  if (runError || !run) throw new Error('Run not found')

  const [{ data: clusters }, { data: keywords }, { data: items }] = await Promise.all([
    sb.from('keyword_pipeline_clusters').select('*').eq('run_id', runId),
    sb.from('keyword_pipeline_keywords').select('*').eq('run_id', runId),
    sb.from('keyword_pipeline_content_plan_items').select('*').eq('run_id', runId),
  ])

  const clusterById = new Map((clusters || []).map(c => [c.id, c]))
  const serviceOrder: string[] = []

  const workbook = new ExcelJS.Workbook()

  // Tab 1 — Content Calendar
  const calendar = workbook.addWorksheet('Content Calendar')
  headerRow(calendar, ['Type', 'Title', 'Service Category', 'Target Keyword', 'City', 'State', 'Priority', 'Est. Words', 'Volume', 'KD', 'Cluster ID', 'Notes'])
  const blogItems = (items || []).filter(i => i.content_track === 'blog')
  const locationItems = (items || []).filter(i => i.content_track !== 'blog')
  for (const item of [...blogItems, ...locationItems]) {
    const type = item.content_track === 'blog'
      ? 'Blog Post'
      : item.page_status === 'optimize' ? 'Location Page — Optimize' : 'Location Page — New'
    const row = calendar.addRow([
      type, item.title, item.service_category, item.primary_keyword,
      item.city, item.state, null, null, item.volume, item.kd, item.cluster_id, item.angle,
    ])
    const color = colorForService(item.service_category, serviceOrder)
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
  }

  // Tab 2 — KW Summary (aggregated live from keyword_pipeline_keywords, never stored)
  const summary = workbook.addWorksheet('KW Summary')
  headerRow(summary, ['Bucket', 'Topic Label', '# Keywords', 'Total Search Volume', 'Avg Monthly Volume', 'Avg KD', 'Avg CPC ($)', '% of Total'])
  const totalVolumeAll = (keywords || []).reduce((s, k) => s + (k.monthly_volume || 0), 0)
  for (const cluster of clusters || []) {
    const kws = (keywords || []).filter(k => k.cluster_id === cluster.id)
    const totalVolume = kws.reduce((s, k) => s + (k.monthly_volume || 0), 0)
    const avg = (field: 'monthly_volume' | 'kd' | 'cpc') =>
      kws.length ? kws.reduce((s, k) => s + (k[field] || 0), 0) / kws.length : 0
    summary.addRow([
      cluster.service_category, cluster.label, kws.length, totalVolume,
      avg('monthly_volume'), avg('kd'), avg('cpc'),
      totalVolumeAll ? totalVolume / totalVolumeAll : 0,
    ])
  }
  summary.addRow(['TOTAL', '', (keywords || []).length, totalVolumeAll, '', '', '', 1])

  // Tab 3 — All Keywords
  const allKw = workbook.addWorksheet('All Keywords')
  headerRow(allKw, ['Bucket', 'Keyword', 'Monthly Volume', 'KD', 'CPC ($)', 'Source', 'Search Intent', 'Traffic Potential'])
  for (const k of keywords || []) {
    const cluster = k.cluster_id ? clusterById.get(k.cluster_id) : null
    const row = allKw.addRow([
      cluster?.label || 'Uncategorized', k.keyword, k.monthly_volume, k.kd,
      k.cpc, k.source, k.search_intent, k.traffic_potential,
    ])
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorForService(cluster?.service_category || null, serviceOrder) } }
  }

  // Tab 4 — Keyword Map
  const kwMap = workbook.addWorksheet('Keyword Map')
  headerRow(kwMap, ['Existing URL', 'Proposed Keyword', 'Volume', 'KD', 'Suggested Meta Title', 'Suggested Meta Description'])
  const primaryCity: string | undefined = run.intake?.primary_location?.city
  const existingPages: any[] = Array.isArray(run.existing_pages) ? run.existing_pages : []
  const usedKeywordIds = new Set<number>()
  for (const page of existingPages.filter(p => p.include_in_keyword_map)) {
    // Tokens from the URL path, e.g. /services/ac-repair -> ["services","ac","repair"]
    const pathTokens = (page.url || '').toLowerCase().replace(/^https?:\/\/[^/]+/, '')
      .split(/[^a-z0-9]+/).filter((t: string) => t.length > 2)
    const scored = (keywords || []).filter(k => !usedKeywordIds.has(k.id)).map(k => {
      let score = (k.monthly_volume || 0) - (k.kd || 0) * 5
      if (primaryCity && k.keyword?.toLowerCase().includes(primaryCity.toLowerCase())) score += 150
      // Relevance to this page: reward keyword words appearing in the URL path
      const kwWords = (k.keyword || '').toLowerCase().split(/\s+/)
      const overlap = kwWords.filter((w: string) => pathTokens.includes(w)).length
      score += overlap * 400
      return { k, score, overlap }
    }).sort((a, b) => b.score - a.score)
    // Only map a keyword that actually relates to the page
    const best = scored.find(s => s.overlap > 0)?.k
    if (!best) continue
    usedKeywordIds.add(best.id)
    const title = `${best.keyword} | ${page.current_title || ''}`.slice(0, 60)
    const desc = (page.current_meta_description || `Learn about ${best.keyword}.`).slice(0, 155)
    kwMap.addRow([page.url, best.keyword, best.monthly_volume, best.kd, title, desc])
  }

  // Tabs 5+ — one per cluster
  for (const cluster of clusters || []) {
    const sheet = workbook.addWorksheet(cluster.slug.slice(0, 31))
    headerRow(sheet, ['Keyword', 'Monthly Volume', 'KD', 'CPC ($)', 'Search Intent', 'Traffic Potential', 'Source'])
    const color = colorForService(cluster.service_category, serviceOrder)
    sheet.getRow(1).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } } })
    for (const k of (keywords || []).filter(k => k.cluster_id === cluster.id)) {
      sheet.addRow([k.keyword, k.monthly_volume, k.kd, k.cpc, k.search_intent, k.traffic_potential, k.source])
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return { buffer: buffer as ArrayBuffer, filename: `${run.client_slug}-keywords-content-calendar.xlsx` }
}
