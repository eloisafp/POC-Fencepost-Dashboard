'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

type MasterClient = { id: number; client_name: string; website_url: string | null }
type PostRow = {
  id: number
  master_client_id: number
  client_name: string
  website_url: string | null
  status: string
  month_year: string | null
  related_url: string | null
  cta: string | null
  notes: string | null
  content: string | null
}

const STATUSES = ['Generate', 'For Review', 'Scheduled', 'Published'] as const
const CTAS = ['Call Now', 'Learn More', 'Buy Now'] as const

const STATUS_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  'Generate':   { bg: '#f8fafc', text: '#52525b', border: '#e2e8f0' },
  'For Review': { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  'Scheduled':  { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  'Published':  { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
}

const inp = 'w-full h-8 border border-gray-200 rounded-md px-2.5 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white placeholder-gray-300'
const cellInp = 'w-full border border-transparent hover:border-gray-200 focus:border-gray-300 rounded px-1.5 py-1 text-xs text-gray-800 outline-none bg-transparent focus:bg-white'

const monthYearNow = () => new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function postJson(url: string, body: any) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
  return json
}

function MultiClientDropdown({ clients, value, onChange }: {
  clients: MasterClient[]
  value: MasterClient[]
  onChange: (cs: MasterClient[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filtered = q.trim() ? clients.filter(c => c.client_name.toLowerCase().includes(q.toLowerCase())) : clients
  const selectedIds = new Set(value.map(c => c.id))

  function toggle(c: MasterClient) {
    onChange(selectedIds.has(c.id) ? value.filter(v => v.id !== c.id) : [...value, c])
  }

  return (
    <div ref={ref} style={{ position: 'relative', width: 320 }}>
      <div
        onClick={() => setOpen(true)}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 32, border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 6px', cursor: 'text', background: '#fff' }}
      >
        {value.map(c => (
          <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, background: '#f1f5f9', color: '#334155', borderRadius: 4, padding: '2px 6px' }}>
            {c.client_name}
            <button onClick={e => { e.stopPropagation(); toggle(c) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        ))}
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={value.length === 0 ? 'Search clients…' : ''}
          style={{ flex: 1, minWidth: 80, border: 'none', outline: 'none', fontSize: 12, padding: '2px' }}
        />
      </div>
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', marginTop: 4, maxHeight: 240, overflowY: 'auto' }}>
          {filtered.map(c => (
            <button key={c.id} onMouseDown={e => { e.preventDefault(); toggle(c) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, color: '#334155', background: selectedIds.has(c.id) ? '#f8fafc' : 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}>
              <input type="checkbox" checked={selectedIds.has(c.id)} readOnly style={{ pointerEvents: 'none' }} />
              {c.client_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function GbpPostingPage() {
  const [clients, setClients] = useState<MasterClient[]>([])
  const [selectedClients, setSelectedClients] = useState<MasterClient[]>([])
  const [count, setCount] = useState(4)
  const [rows, setRows] = useState<PostRow[]>([])
  const [adding, setAdding] = useState(false)
  const [generatingIds, setGeneratingIds] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<string | null>(null)
  const [urlModal, setUrlModal] = useState<{ rows: PostRow[]; bulk: boolean } | null>(null)
  const pendingBulk = useRef<number[]>([])

  // Auto-fit textareas (content + related URL) to their text on every change
  const areaRefs = useRef(new Map<string, HTMLTextAreaElement>())
  useEffect(() => {
    areaRefs.current.forEach(el => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px` })
  }, [rows])
  const bindArea = (key: string) => (el: HTMLTextAreaElement | null) => {
    if (el) areaRefs.current.set(key, el)
    else areaRefs.current.delete(key)
  }

  // Learn More / Buy Now point the reader somewhere — a Related URL is required
  const needsUrl = (r: PostRow) => !r.related_url?.trim() && r.cta !== 'Call Now'

  async function loadRows() {
    const { data } = await supabase
      .from('gbp_post_drafts')
      .select('id, master_client_id, client_name, website_url, status, month_year, related_url, cta, notes, content')
      .order('created_at', { ascending: false })
      .limit(300)
    setRows((data || []) as PostRow[])
  }

  useEffect(() => {
    supabase.from('master_clients').select('id, client_name, website_url').order('client_name')
      .then(({ data }) => { if (data) setClients(data as MasterClient[]) })
    loadRows()
  }, [])

  async function addRows(n: number) {
    if (selectedClients.length === 0) return
    setAdding(true); setError(null)
    const inserts = selectedClients.flatMap(client => Array.from({ length: n }, () => ({
      master_client_id: client.id,
      client_name: client.client_name,
      website_url: client.website_url,
      status: 'Generate',
      month_year: monthYearNow(),
      cta: 'Learn More',
    })))
    const { error: insErr } = await supabase.from('gbp_post_drafts').insert(inserts)
    if (insErr) setError(insErr.message)
    await loadRows()
    setAdding(false)
    setSelectedClients([])
  }

  // Inline edit: update state immediately, persist to DB
  async function updateRow(id: number, patch: Partial<PostRow>) {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)))
    await supabase.from('gbp_post_drafts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  }

  async function deleteRow(id: number) {
    if (!window.confirm('Delete this post row? This cannot be undone.')) return
    await supabase.from('gbp_post_drafts').delete().eq('id', id)
    setRows(rs => rs.filter(r => r.id !== id))
    setSelected(s => { const n = new Set(s); n.delete(id); return n })
  }

  async function deleteSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`Delete ${selected.size} selected row${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return
    await supabase.from('gbp_post_drafts').delete().in('id', [...selected])
    setRows(rs => rs.filter(r => !selected.has(r.id)))
    setSelected(new Set())
  }

  function toggleSelect(id: number) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSelectAll() {
    setSelected(s => (s.size === rows.length ? new Set() : new Set(rows.map(r => r.id))))
  }

  async function copyContent(row: PostRow) {
    if (!row.content) return
    await navigator.clipboard.writeText(row.content)
    setCopiedId(row.id)
    setTimeout(() => setCopiedId(c => (c === row.id ? null : c)), 1500)
  }

  async function generate(id: number): Promise<string | null> {
    setGeneratingIds(s => new Set(s).add(id))
    let err: string | null = null
    try {
      const r = await postJson('/api/gbp-posting/generate', { post_id: id })
      setRows(rs => rs.map(row => (row.id === id ? { ...row, content: r.content, status: 'For Review' } : row)))
    } catch (e: any) {
      err = `Post #${id}: ${e.message}`
    }
    setGeneratingIds(s => { const n = new Set(s); n.delete(id); return n })
    return err
  }

  async function generateOne(row: PostRow) {
    if (needsUrl(row)) { setUrlModal({ rows: [row], bulk: false }); return }
    setError(null)
    const err = await generate(row.id)
    if (err) setError(err)
  }

  // Sequential bulk run over rows still in "Generate" status, 15s rest between calls
  async function runBulk(ids: number[]) {
    if (ids.length === 0) return
    setBulkRunning(true); setError(null)
    const errs: string[] = []
    for (let i = 0; i < ids.length; i++) {
      setBulkProgress(`Generating ${i + 1} of ${ids.length}…`)
      const err = await generate(ids[i])
      if (err) errs.push(err)
      if (i < ids.length - 1) {
        setBulkProgress(`${i + 1} of ${ids.length} done — resting 3s before the next…`)
        await sleep(3000)
      }
    }
    setBulkProgress(null); setBulkRunning(false)
    if (errs.length) setError(errs.join(' | '))
  }

  function generateAll() {
    const targets = rows.filter(r => r.status === 'Generate')
    if (targets.length === 0) return
    const invalid = targets.filter(needsUrl)
    const valid = targets.filter(r => !needsUrl(r)).map(r => r.id)
    if (invalid.length > 0) {
      pendingBulk.current = valid
      setUrlModal({ rows: invalid, bulk: true })
    } else {
      runBulk(valid)
    }
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1240, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: '#18181b', marginBottom: 4, textAlign: 'center' }}>GBP Post Generator</h1>
      <p style={{ fontSize: 12, color: '#71717a', marginBottom: 20, textAlign: 'center' }}>
        AI writes each post (max 50 words) from the client&apos;s intake form, content guidelines, and the related URL.
      </p>

      {/* Add posts bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <MultiClientDropdown clients={clients} value={selectedClients} onChange={setSelectedClients} />
        <span style={{ fontSize: 11, color: '#71717a' }}>posts per client:</span>
        <input
          type="number" min={1} max={20} value={count}
          onChange={e => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          className={inp} style={{ width: 64 }}
        />
        <button
          onClick={() => addRows(count)}
          disabled={selectedClients.length === 0 || adding}
          className="text-xs px-3 h-8 rounded-md bg-zinc-900 text-white font-medium disabled:opacity-40"
        >
          {adding
            ? 'Adding…'
            : selectedClients.length > 1
              ? `+ Add ${count} to table × ${selectedClients.length} clients`
              : `+ Add ${count} to table`}
        </button>
        {selected.size > 0 && (
          <button
            onClick={deleteSelected}
            className="text-xs px-3 h-8 rounded-md border border-red-300 bg-red-50 text-red-600 font-medium"
          >
            🗑 Delete selected ({selected.size})
          </button>
        )}
      </div>

      {error && <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>{error}</div>}

      {/* Table header bar: bulk generation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 8 }}>
        {bulkProgress && <span style={{ fontSize: 11, color: '#2563eb' }}>{bulkProgress}</span>}
        <button
          onClick={generateAll}
          disabled={bulkRunning || rows.filter(r => r.status === 'Generate').length === 0}
          className="text-xs px-3 h-8 rounded-md bg-zinc-900 text-white font-medium disabled:opacity-40"
        >
          {bulkRunning ? 'Generating all…' : `⚡ Generate All (${rows.filter(r => r.status === 'Generate').length})`}
        </button>
      </div>

      {/* Missing Related URL reminder */}
      {urlModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(24,24,27,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '20px 22px', width: 420, maxWidth: 'calc(100vw - 48px)', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#b45309', marginBottom: 8 }}>⚠ Related URL required</div>
            <div style={{ fontSize: 12, color: '#52525b', lineHeight: 1.6, marginBottom: 12 }}>
              {urlModal.bulk
                ? <>These rows use a <b>Learn More</b> or <b>Buy Now</b> CTA but have no Related URL — the button needs a page to point to. Add a Related URL before generating them:</>
                : <>This row uses a <b>{urlModal.rows[0]?.cta}</b> CTA but has no Related URL — the button needs a page to point to. Add a Related URL before generating the GBP Post Content.</>}
            </div>
            {urlModal.bulk && (
              <ul style={{ fontSize: 12, color: '#18181b', marginBottom: 12, paddingLeft: 18 }}>
                {urlModal.rows.map(r => <li key={r.id}>#{r.id} — {r.client_name} ({r.cta})</li>)}
              </ul>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setUrlModal(null)} className="text-xs px-3 h-8 rounded-md border border-gray-300 bg-white text-gray-700">
                {urlModal.bulk ? 'Cancel' : 'OK — I’ll add the URL'}
              </button>
              {urlModal.bulk && pendingBulk.current.length > 0 && (
                <button
                  onClick={() => { const ids = pendingBulk.current; pendingBulk.current = []; setUrlModal(null); runBulk(ids) }}
                  className="text-xs px-3 h-8 rounded-md bg-zinc-900 text-white font-medium"
                >
                  Skip these, generate {pendingBulk.current.length} valid
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Posts table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: '#18181b', minWidth: 1080 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#71717a', textAlign: 'left' }}>
                <th style={{ padding: '8px 6px', width: 30 }}>
                  <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} />
                </th>
                <th style={{ padding: '8px 10px', width: 110 }}>Status</th>
                <th style={{ padding: '8px 10px', width: 140 }}>Client</th>
                <th style={{ padding: '8px 10px', width: 150 }}>Website URL</th>
                <th style={{ padding: '8px 10px', width: 105 }}>Month Year</th>
                <th style={{ padding: '8px 10px', width: 180 }}>Related URL</th>
                <th style={{ padding: '8px 10px', width: 100 }}>CTA</th>
                <th style={{ padding: '8px 10px', width: 150 }}>Additional Notes</th>
                <th style={{ padding: '8px 10px' }}>GBP Post Content</th>
                <th style={{ padding: '8px 10px', width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '20px 12px', color: '#94a3b8' }}>No posts yet — pick a client above and add rows.</td></tr>
              ) : rows.map(row => {
                const st = STATUS_STYLE[row.status] || STATUS_STYLE['Generate']
                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', background: selected.has(row.id) ? '#f8fafc' : undefined }}>
                    <td style={{ padding: '10px 6px' }}>
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} style={{ cursor: 'pointer' }} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <select
                        value={row.status}
                        onChange={e => updateRow(row.id, { status: e.target.value })}
                        style={{ width: '100%', fontSize: 11, fontWeight: 500, padding: '4px 6px', borderRadius: 99, background: st.bg, color: st.text, border: `1px solid ${st.border}`, cursor: 'pointer' }}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 500 }}>{row.client_name}</td>
                    <td style={{ padding: '8px 10px' }}>
                      {row.website_url
                        ? <a href={row.website_url.startsWith('http') ? row.website_url : `https://${row.website_url}`} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontSize: 11, wordBreak: 'break-all' }}>{row.website_url.replace(/^https?:\/\//, '')}</a>
                        : <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <input className={cellInp} value={row.month_year ?? ''} onChange={e => setRows(rs => rs.map(r => r.id === row.id ? { ...r, month_year: e.target.value } : r))} onBlur={e => updateRow(row.id, { month_year: e.target.value })} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <textarea
                        ref={bindArea(`url-${row.id}`)}
                        className={cellInp} rows={1} placeholder="https://…"
                        value={row.related_url ?? ''}
                        onChange={e => setRows(rs => rs.map(r => r.id === row.id ? { ...r, related_url: e.target.value } : r))}
                        onBlur={e => updateRow(row.id, { related_url: e.target.value })}
                        style={{ resize: 'none', overflow: 'hidden', wordBreak: 'break-all', lineHeight: 1.4 }}
                      />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <select
                        value={row.cta ?? 'Learn More'}
                        onChange={e => updateRow(row.id, { cta: e.target.value })}
                        style={{ width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 6, background: '#fff', color: '#334155', border: '1px solid #e2e8f0', cursor: 'pointer' }}
                      >
                        {CTAS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <textarea
                        className={cellInp} rows={2} placeholder="topic, offer, angle…"
                        value={row.notes ?? ''}
                        onChange={e => setRows(rs => rs.map(r => r.id === row.id ? { ...r, notes: e.target.value } : r))}
                        onBlur={e => updateRow(row.id, { notes: e.target.value })}
                        style={{ resize: 'vertical', minHeight: 30 }}
                      />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {row.content ? (
                        <div>
                          <textarea
                            ref={bindArea(`content-${row.id}`)}
                            className={cellInp} rows={1}
                            value={row.content}
                            onChange={e => setRows(rs => rs.map(r => r.id === row.id ? { ...r, content: e.target.value } : r))}
                            onBlur={e => updateRow(row.id, { content: e.target.value })}
                            style={{ resize: 'none', overflow: 'hidden', lineHeight: 1.45 }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
                            <span style={{ fontSize: 10, color: countWords(row.content) > 50 ? '#dc2626' : '#94a3b8' }}>{countWords(row.content)}/50 words</span>
                            <button
                              onClick={() => copyContent(row)}
                              title="Copy post content"
                              style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: copiedId === row.id ? '#16a34a' : '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                            >
                              {copiedId === row.id ? (
                                <>✓ Copied!</>
                              ) : (
                                <>
                                  <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                  Copy
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => generateOne(row)}
                              disabled={generatingIds.has(row.id) || bulkRunning}
                              style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                            >
                              {generatingIds.has(row.id) ? 'Regenerating…' : '↺ Regenerate'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => generateOne(row)}
                          disabled={generatingIds.has(row.id) || bulkRunning}
                          className="text-[11px] font-medium px-3 h-7 rounded-md bg-zinc-900 text-white disabled:opacity-40"
                        >
                          {generatingIds.has(row.id) ? 'Generating…' : '✨ Generate'}
                        </button>
                      )}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <button onClick={() => deleteRow(row.id)} title="Delete row"
                        style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', color: '#dc2626' }}>
                        <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
