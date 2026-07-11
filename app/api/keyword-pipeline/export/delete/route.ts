import { NextRequest } from 'next/server'
import { supabaseServer } from '../../../../../lib/keyword-pipeline/server'

// POST { export_id: number } -> { deleted: true }
// Removes the file from the keyword-exports bucket, then the metadata row.
export async function POST(req: NextRequest) {
  try {
    const { export_id } = await req.json()
    if (!export_id) return Response.json({ error: 'export_id is required' }, { status: 400 })

    const sb = supabaseServer()

    const { data: record, error: fetchError } = await sb
      .from('keyword_pipeline_exports')
      .select('id, storage_path')
      .eq('id', export_id)
      .single()
    if (fetchError || !record) return Response.json({ error: 'Export not found' }, { status: 404 })

    const { error: storageError } = await sb.storage.from('keyword-exports').remove([record.storage_path])
    if (storageError) throw new Error(`Storage delete failed: ${storageError.message}`)

    const { error: deleteError } = await sb.from('keyword_pipeline_exports').delete().eq('id', export_id)
    if (deleteError) throw deleteError

    return Response.json({ deleted: true })
  } catch (err: any) {
    console.error('keyword-pipeline/export/delete error:', err)
    return Response.json({ error: err.message || 'Failed to delete export' }, { status: 500 })
  }
}
