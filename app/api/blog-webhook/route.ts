import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

// Fired by the dashboard to queue a blog row and trigger Make
export async function POST(req: NextRequest) {
  if (!process.env.MAKE_BLOG_WEBHOOK_URL) {
    return Response.json({ error: 'MAKE_BLOG_WEBHOOK_URL not configured in .env.local' }, { status: 500 })
  }

  try {
    const { id, company_name, keyword, blog_title, blog_month } = await req.json()

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Mark row as queued
    const { error } = await sb
      .from('blog_posts')
      .update({ status: 'queued' })
      .eq('id', id)

    if (error) throw error

    // Fire Make webhook — don't await, let it run async
    fetch(process.env.MAKE_BLOG_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        row_id:       id,
        company_name,
        keyword,
        blog_title,
        blog_month:   blog_month || '',
      }),
    }).catch(err => console.error('Make webhook fire error:', err))

    return Response.json({ ok: true })
  } catch (err: any) {
    console.error('blog-webhook error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
