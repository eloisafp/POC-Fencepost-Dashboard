import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

// Called by Make when a blog is finished generating
export async function POST(req: NextRequest) {
  try {
    const { row_id, gdoc_url, status, error_msg } = await req.json()
    if (!row_id) return Response.json({ error: 'row_id required' }, { status: 400 })

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { error } = await sb
      .from('blog_posts')
      .update({
        status:    status    || 'done',
        gdoc_url:  gdoc_url  || null,
        error_msg: error_msg || null,
      })
      .eq('id', row_id)

    if (error) throw error
    return Response.json({ ok: true })
  } catch (err: any) {
    console.error('blog-callback error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
