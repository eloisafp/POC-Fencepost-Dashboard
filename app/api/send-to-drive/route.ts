export async function POST(req: Request) {
  const webhookUrl = process.env.MAKE_WEBHOOK_URL
  if (!webhookUrl) {
    return Response.json({ error: 'MAKE_WEBHOOK_URL not set' }, { status: 500 })
  }

  const payload = await req.json()

  const makeRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const text = await makeRes.text()
  console.log('[send-to-drive] Make response:', text)
  return new Response(text, { status: makeRes.status })
}
