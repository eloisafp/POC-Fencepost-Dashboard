export async function POST(req: Request) {
  const { url } = await req.json()
  if (!url) return Response.json({ error: 'No URL provided' }, { status: 400 })

  // Extract Google Doc ID from any GDoc URL format
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (!match) return Response.json({ error: 'Invalid Google Doc URL' }, { status: 400 })

  const docId     = match[1]
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`

  try {
    const res = await fetch(exportUrl)
    if (!res.ok) return Response.json({ error: 'Could not fetch document. Make sure it is shared as "Anyone with the link can view".' }, { status: 400 })
    const text = await res.text()
    return Response.json({ text: text.trim() })
  } catch {
    return Response.json({ error: 'Failed to fetch document' }, { status: 500 })
  }
}
