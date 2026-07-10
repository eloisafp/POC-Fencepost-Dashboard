import { NextRequest } from 'next/server'
import { supabaseServer } from '../../../../lib/keyword-pipeline/server'
import { buildWorkbook } from '../../../../lib/keyword-pipeline/workbook'

// GET /api/keyword-pipeline/export?run_id=123
// Direct download: builds the workbook and streams it back as an attachment.
// Nothing is stored — use POST /api/keyword-pipeline/export/save for that.
export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get('run_id')
  if (!runId) return Response.json({ error: 'run_id is required' }, { status: 400 })

  try {
    const { buffer, filename } = await buildWorkbook(supabaseServer(), runId)
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err: any) {
    console.error('keyword-pipeline/export error:', err)
    const status = err.message === 'Run not found' ? 404 : 500
    return Response.json({ error: err.message || 'Failed to build export' }, { status })
  }
}
