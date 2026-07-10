import { NextRequest } from 'next/server'
import { supabaseServer } from '../../../../../lib/keyword-pipeline/server'
import { buildWorkbook } from '../../../../../lib/keyword-pipeline/workbook'

// POST { run_id: number } -> { export: { id, filename, public_url, size_bytes, created_at } }
// Generates the workbook, uploads it to the public 'keyword-exports' Storage
// bucket, and records it in keyword_pipeline_exports. Each save is a new
// version — existing files are never overwritten.
export async function POST(req: NextRequest) {
  try {
    const { run_id } = await req.json()
    if (!run_id) return Response.json({ error: 'run_id is required' }, { status: 400 })

    const sb = supabaseServer()
    const { buffer, filename } = await buildWorkbook(sb, run_id)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const storagePath = `run-${run_id}/${stamp}-${filename}`

    const { error: uploadError } = await sb.storage
      .from('keyword-exports')
      .upload(storagePath, buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

    const { data: pub } = sb.storage.from('keyword-exports').getPublicUrl(storagePath)

    const { data: record, error: insertError } = await sb
      .from('keyword_pipeline_exports')
      .insert({
        run_id,
        filename,
        storage_path: storagePath,
        public_url: pub.publicUrl,
        size_bytes: buffer.byteLength,
      })
      .select('id, filename, public_url, size_bytes, created_at')
      .single()
    if (insertError) throw insertError

    return Response.json({ export: record })
  } catch (err: any) {
    console.error('keyword-pipeline/export/save error:', err)
    const status = err.message === 'Run not found' ? 404 : 500
    return Response.json({ error: err.message || 'Failed to save export' }, { status })
  }
}
