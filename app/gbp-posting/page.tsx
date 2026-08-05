'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

type MasterClient = { id: number; client_name: string; website_url: string | null; niche: string | null; shared_assets_link: string | null }
type PostRow = {
  id: number
  master_client_id: number
  client_name: string
  website_url: string | null
  status: string
  post_type: string | null
  week: number | null
  month_year: string | null
  related_url: string | null
  cta: string | null
  notes: string | null
  content: string | null
}

const STATUSES = ['Generate', 'For Review', 'Ready', 'Scheduled', 'Published'] as const
const CTAS = ['Call Now', 'Book', 'Learn More', 'Buy Now'] as const
const URL_REQUIRED_CTAS = new Set(['Learn More', 'Buy Now'])
const POST_TYPES = ['General', 'Blog post', 'Booking CTA', 'Book Call', 'Industry fact'] as const

const STATUS_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  'Generate':   { bg: '#f8fafc', text: '#52525b', border: '#e2e8f0' },
  'For Review': { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  'Ready':      { bg: '#eef2ff', text: '#4338ca', border: '#c7d2fe' },
  'Scheduled':  { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  'Published':  { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
}
const POST_TYPE_STYLE: Record<string, { bg: string; text: string }> = {
  'General':       { bg: '#f8fafc', text: '#52525b' },
  'Blog post':     { bg: '#eff6ff', text: '#1d4ed8' },
  'Booking CTA':   { bg: '#f0fdf4', text: '#15803d' },
  'Book Call':     { bg: '#f0fdfa', text: '#0f766e' },
  'Industry fact': { bg: '#fdf4ff', text: '#a21caf' },
}

const cellInp = 'w-full border border-transparent hover:border-gray-200 focus:border-gray-300 rounded px-1.5 py-1 text-xs text-gray-800 outline-none bg-transparent focus:bg-white'
const btnDark = 'text-xs px-3 h-8 rounded-md bg-zinc-900 text-white font-medium disabled:opacity-40'
const btnLight = 'text-xs px-3 h-8 rounded-md border border-gray-300 bg-white text-gray-700 font-medium disabled:opacity-40'

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
  clients: MasterClient[]; value: MasterClient[]; onChange: (cs: MasterClient[]) => void
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
  const toggle = (c: MasterClient) => onChange(selectedIds.has(c.id) ? value.filter(v => v.id !== c.id) : [...value, c])
  return (
    <div ref={ref} style={{ position: 'relative', width: 320 }}>
      <div onClick={() => setOpen(true)} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 32, border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 6px', cursor: 'text', background: '#fff' }}>
        {value.map(c => (
          <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, background: '#f1f5f9', color: '#334155', borderRadius: 4, padding: '2px 6px' }}>
            {c.client_name}
            <button onClick={e => { e.stopPropagation(); toggle(c) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        ))}
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} placeholder={value.length === 0 ? 'Search clients…' : ''} style={{ flex: 1, minWidth: 80, border: 'none', outline: 'none', fontSize: 12, padding: '2px' }} />
      </div>
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', marginTop: 4, maxHeight: 240, overflowY: 'auto' }}>
          {filtered.map(c => (
            <button key={c.id} onMouseDown={e => { e.preventDefault(); toggle(c) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, color: '#334155', background: selectedIds.has(c.id) ? '#f8fafc' : 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}>
              <input type="checkbox" checked={selectedIds.has(c.id)} readOnly style={{ pointerEvents: 'none' }} />{c.client_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function GbpPostingPage() {
  const [clients, setClients] = useState<MasterClient[]>([])
  const [rows, setRows] = useState<PostRow[]>([])
  const [openClients, setOpenClients] = useState<number[]>([])   // client ids shown as cards (incl. empty added ones)
  const [selectedForAdd, setSelectedForAdd] = useState<MasterClient[]>([])
  const [busyClient, setBusyClient] = useState<number | null>(null)
  const [generatingIds, setGeneratingIds] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<string | null>(null)
  const [urlModal, setUrlModal] = useState<{ rows: PostRow[]; validIds: number[] } | null>(null)

  const areaRefs = useRef(new Map<string, HTMLTextAreaElement>())
  // Re-fit on rows change AND on collapse/expand (re-opened cards remount their
  // textareas at 1 row, so they need re-measuring or the content is cut off).
  useEffect(() => { areaRefs.current.forEach(el => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px` }) }, [rows, collapsed])
  const bindArea = (key: string) => (el: HTMLTextAreaElement | null) => { if (el) areaRefs.current.set(key, el); else areaRefs.current.delete(key) }

  const needsUrl = (r: PostRow) => !r.related_url?.trim() && URL_REQUIRED_CTAS.has(r.cta ?? '')

  async function loadRows() {
    const { data } = await supabase
      .from('gbp_post_drafts')
      .select('id, master_client_id, client_name, website_url, status, post_type, week, month_year, related_url, cta, notes, content')
      .order('created_at', { ascending: false }).limit(500)
    const list = (data || []) as PostRow[]
    setRows(list)
    // Make sure every client with posts has a visible card
    setOpenClients(prev => {
      const merged = [...prev]
      for (const r of list) if (!merged.includes(r.master_client_id)) merged.push(r.master_client_id)
      return merged
    })
  }

  useEffect(() => {
    supabase.from('master_clients').select('id, client_name, website_url, niche, shared_assets_link').order('client_name').then(({ data }) => { if (data) setClients(data as MasterClient[]) })
    loadRows()
  }, [])

  function clientMeta(id: number): MasterClient {
    const c = clients.find(x => x.id === id)
    if (c) return c
    const r = rows.find(x => x.master_client_id === id)
    return { id, client_name: r?.client_name || `Client ${id}`, website_url: r?.website_url || null, niche: null, shared_assets_link: null }
  }

  function addCards() {
    if (selectedForAdd.length === 0) return
    setOpenClients(prev => [...selectedForAdd.map(c => c.id).filter(id => !prev.includes(id)), ...prev])
    setSelectedForAdd([])
  }

  async function updateRow(id: number, patch: Partial<PostRow>) {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)))
    await supabase.from('gbp_post_drafts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  }

  async function addPosts(clientId: number, n: number) {
    const c = clientMeta(clientId)
    setBusyClient(clientId); setError(null)
    const inserts = Array.from({ length: n }, () => ({ master_client_id: c.id, client_name: c.client_name, website_url: c.website_url, status: 'Generate', post_type: 'General', month_year: monthYearNow(), cta: 'Learn More' }))
    const { error: e } = await supabase.from('gbp_post_drafts').insert(inserts)
    if (e) setError(e.message)
    await loadRows(); setBusyClient(null)
  }

  // 4-post monthly plan (repeats the sequence: Blog, Booking CTA, Industry
  // fact, Book Call). Each click CONTINUES the week numbering from the client's
  // existing posts (1st click W1-4, 2nd W5-8…). The month label is always the
  // current month it's created in. Rows are blank — set service via Notes.
  async function generatePlan(clientId: number) {
    const c = clientMeta(clientId)
    setBusyClient(clientId); setError(null)
    try {
      const existing = rows.filter(r => r.master_client_id === clientId)
      const maxWeek = existing.reduce((m, r) => Math.max(m, r.week ?? 0), 0)
      const startWeek = maxWeek + 1
      const my = monthYearNow()
      const base = { master_client_id: c.id, client_name: c.client_name, website_url: c.website_url, status: 'Generate', month_year: my }
      const inserts = [
        { ...base, week: startWeek,     post_type: 'Blog post',     cta: 'Learn More', related_url: null,          notes: null },
        { ...base, week: startWeek + 1, post_type: 'Booking CTA',   cta: 'Book',       related_url: null,          notes: null },
        { ...base, week: startWeek + 2, post_type: 'Industry fact', cta: 'Learn More', related_url: c.website_url, notes: null },
        { ...base, week: startWeek + 3, post_type: 'Book Call',     cta: 'Call Now',   related_url: null,          notes: null },
      ]
      const { error: e } = await supabase.from('gbp_post_drafts').insert(inserts)
      if (e) setError(e.message)
      await loadRows()
    } finally { setBusyClient(null) }
  }

  async function deleteRow(id: number) {
    if (!window.confirm('Delete this post row? This cannot be undone.')) return
    await supabase.from('gbp_post_drafts').delete().eq('id', id)
    setRows(rs => rs.filter(r => r.id !== id))
    setSelected(s => { const n = new Set(s); n.delete(id); return n })
  }

  async function removeCard(clientId: number, clientRows: PostRow[]) {
    if (clientRows.length > 0) {
      if (!window.confirm(`Delete all ${clientRows.length} post(s) for this client? This cannot be undone.`)) return
      await supabase.from('gbp_post_drafts').delete().eq('master_client_id', clientId)
    }
    setOpenClients(prev => prev.filter(id => id !== clientId))
    setRows(rs => rs.filter(r => r.master_client_id !== clientId))
  }

  async function deleteSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`Delete ${selected.size} selected row${selected.size === 1 ? '' : 's'}?`)) return
    await supabase.from('gbp_post_drafts').delete().in('id', [...selected])
    setRows(rs => rs.filter(r => !selected.has(r.id)))
    setSelected(new Set())
  }

  const toggleSelect = (id: number) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleCollapse = (id: number) => setCollapsed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function copyContent(row: PostRow) {
    if (!row.content) return
    await navigator.clipboard.writeText(row.content)
    setCopiedId(row.id); setTimeout(() => setCopiedId(c => (c === row.id ? null : c)), 1500)
  }

  async function generate(id: number): Promise<string | null> {
    setGeneratingIds(s => new Set(s).add(id))
    let err: string | null = null
    try {
      const r = await postJson('/api/gbp-posting/generate', { post_id: id })
      setRows(rs => rs.map(row => (row.id === id ? { ...row, content: r.content, status: 'For Review' } : row)))
    } catch (e: any) { err = `Post #${id}: ${e.message}` }
    setGeneratingIds(s => { const n = new Set(s); n.delete(id); return n })
    return err
  }

  async function generateOne(row: PostRow) {
    if (needsUrl(row)) { setUrlModal({ rows: [row], validIds: [] }); return }
    setError(null); const err = await generate(row.id); if (err) setError(err)
  }

  async function runBulk(ids: number[]) {
    if (ids.length === 0) return
    setBulkRunning(true); setError(null)
    const errs: string[] = []
    for (let i = 0; i < ids.length; i++) {
      setBulkProgress(`Generating ${i + 1} of ${ids.length}…`)
      const err = await generate(ids[i]); if (err) errs.push(err)
      if (i < ids.length - 1) { setBulkProgress(`${i + 1} of ${ids.length} done — resting 3s…`); await sleep(3000) }
    }
    setBulkProgress(null); setBulkRunning(false)
    if (errs.length) setError(errs.join(' | '))
  }

  // Split a target set into ready vs missing-URL; prompt on the latter.
  function startBulk(targetRows: PostRow[]) {
    const targets = targetRows.filter(r => r.status === 'Generate')
    if (targets.length === 0) return
    const invalid = targets.filter(needsUrl)
    const valid = targets.filter(r => !needsUrl(r)).map(r => r.id)
    if (invalid.length > 0) setUrlModal({ rows: invalid, validIds: valid })
    else runBulk(valid)
  }

  function exportCsv() {
    const headers = ['Client', 'Website URL', 'Post Type', 'Week', 'Status', 'Month Year', 'Related URL', 'CTA', 'Additional Notes', 'GBP Post Content']
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [headers.map(esc).join(',')]
    rows.forEach(r => lines.push([r.client_name, r.website_url, r.post_type, r.week, r.status, r.month_year, r.related_url, r.cta, r.notes, r.content].map(esc).join(',')))
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `gbp-posts-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const cardIds = openClients
  const generateCount = rows.filter(r => r.status === 'Generate').length

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1180, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: '#18181b', marginBottom: 4, textAlign: 'center' }}>GBP Post Generator</h1>
      <p style={{ fontSize: 12, color: '#71717a', marginBottom: 20, textAlign: 'center' }}>Each client has its own set of posts. AI writes each post (max 50 words) from the client&apos;s intake form, guidelines, and post type.</p>

      {/* Top bar — sticky so Generate all stays reachable while scrolling */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, background: '#f5f5f4', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', marginBottom: 8, flexWrap: 'wrap', borderBottom: '1px solid #e5e7eb' }}>
        <MultiClientDropdown clients={clients} value={selectedForAdd} onChange={setSelectedForAdd} />
        <button onClick={addCards} disabled={selectedForAdd.length === 0} className={btnDark}>+ Add client{selectedForAdd.length > 1 ? `s (${selectedForAdd.length})` : ''}</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {bulkProgress && <span style={{ fontSize: 11, color: '#2563eb' }}>{bulkProgress}</span>}
          {selected.size > 0 && <button onClick={deleteSelected} className="text-xs px-3 h-8 rounded-md border border-red-300 bg-red-50 text-red-600 font-medium">🗑 Delete selected ({selected.size})</button>}
          <button onClick={exportCsv} disabled={rows.length === 0} className={btnLight}>⬇ Export CSV</button>
          <button onClick={() => startBulk(rows)} disabled={bulkRunning || generateCount === 0} className={btnDark}>⚡ Generate all ({generateCount})</button>
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>{error}</div>}

      {cardIds.length === 0 ? (
        <div style={{ background: '#fff', border: '1px dashed #e2e8f0', borderRadius: 12, padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
          No clients yet — search a client above and click &quot;Add client&quot; to start their post set.
        </div>
      ) : cardIds.map(cid => {
        const c = clientMeta(cid)
        // Order by week (W1→W4) so a plan reads in sequence; weekless manual
        // rows (week=null) sort after, keeping the query's newest-first order.
        const clientRows = rows.filter(r => r.master_client_id === cid)
          .slice().sort((a, b) => (a.week ?? 99) - (b.week ?? 99))
        return (
          <ClientCard
            key={cid} client={c} rows={clientRows} collapsed={collapsed.has(cid)} busy={busyClient === cid} bulkRunning={bulkRunning}
            generatingIds={generatingIds} selected={selected} copiedId={copiedId} bindArea={bindArea}
            onToggleCollapse={() => toggleCollapse(cid)} onAddPosts={(n) => addPosts(cid, n)} onGeneratePlan={() => generatePlan(cid)}
            onGenerateAll={() => startBulk(clientRows)} onRemove={() => removeCard(cid, clientRows)}
            onUpdateRow={updateRow} onDeleteRow={deleteRow} onGenerateOne={generateOne} onCopy={copyContent} onToggleSelect={toggleSelect} setRows={setRows}
          />
        )
      })}

      {urlModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(24,24,27,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '20px 22px', width: 440, maxWidth: 'calc(100vw - 48px)', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#b45309', marginBottom: 8 }}>⚠ Related URL required</div>
            <div style={{ fontSize: 12, color: '#52525b', lineHeight: 1.6, marginBottom: 12 }}>These rows use a <b>Learn More</b> or <b>Buy Now</b> CTA but have no Related URL — add one before generating (e.g. the blog link for Blog-post rows):</div>
            <ul style={{ fontSize: 12, color: '#18181b', marginBottom: 12, paddingLeft: 18 }}>{urlModal.rows.map(r => <li key={r.id}>{r.client_name} — {r.post_type} ({r.cta})</li>)}</ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setUrlModal(null)} className={btnLight}>OK — I&apos;ll add it</button>
              {urlModal.validIds.length > 0 && <button onClick={() => { const ids = urlModal.validIds; setUrlModal(null); runBulk(ids) }} className={btnDark}>Skip, generate {urlModal.validIds.length} ready</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ClientCard(props: {
  client: MasterClient; rows: PostRow[]; collapsed: boolean; busy: boolean; bulkRunning: boolean
  generatingIds: Set<number>; selected: Set<number>; copiedId: number | null; bindArea: (k: string) => (el: HTMLTextAreaElement | null) => void
  onToggleCollapse: () => void; onAddPosts: (n: number) => void; onGeneratePlan: () => void; onGenerateAll: () => void; onRemove: () => void
  onUpdateRow: (id: number, patch: Partial<PostRow>) => void; onDeleteRow: (id: number) => void; onGenerateOne: (r: PostRow) => void
  onCopy: (r: PostRow) => void; onToggleSelect: (id: number) => void; setRows: React.Dispatch<React.SetStateAction<PostRow[]>>
}) {
  const { client: c, rows, collapsed, busy, bulkRunning, generatingIds, selected, copiedId, bindArea } = props
  const [count, setCount] = useState(4)
  const genCount = rows.filter(r => r.status === 'Generate').length

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, marginBottom: 14, overflow: 'hidden' }}>
      {/* Card header: client + website + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: collapsed ? 'none' : '1px solid #f1f5f9', flexWrap: 'wrap' }}>
        <button onClick={props.onToggleCollapse} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 12 }}>{collapsed ? '▶' : '▼'}</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#18181b' }}>{c.client_name}</div>
          {c.website_url
            ? <a href={c.website_url.startsWith('http') ? c.website_url : `https://${c.website_url}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#2563eb' }}>{c.website_url.replace(/^https?:\/\//, '')}</a>
            : <span style={{ fontSize: 11, color: '#cbd5e1' }}>no website URL</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>Niche</span>
              <span style={{ fontSize: 11, color: c.niche ? '#334155' : '#cbd5e1' }} title="From the client record — used for Industry fact posts">{c.niche || 'not set'}</span>
            </span>
            {c.shared_assets_link
              ? <a href={c.shared_assets_link.startsWith('http') ? c.shared_assets_link : `https://${c.shared_assets_link}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0d9488', display: 'inline-flex', alignItems: 'center', gap: 3 }} title="Client image assets folder">🖼 Image assets</a>
              : <span style={{ fontSize: 11, color: '#cbd5e1', display: 'inline-flex', alignItems: 'center', gap: 3 }}>🖼 no image assets link</span>}
          </div>
        </div>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{rows.length} post{rows.length === 1 ? '' : 's'}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={props.onGeneratePlan} disabled={busy} className={btnLight} title="Create a 4-week plan (Blog · Booking CTA · Industry fact · Booking CTA)">{busy ? 'Working…' : '📅 Monthly plan'}</button>
          <input type="number" min={1} max={20} value={count} onChange={e => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} style={{ width: 48, height: 32, border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, textAlign: 'center', color: '#334155' }} />
          <button onClick={() => props.onAddPosts(count)} disabled={busy} className={btnLight}>+ Add</button>
          <button onClick={props.onGenerateAll} disabled={bulkRunning || genCount === 0} className={btnDark}>⚡ Generate all ({genCount})</button>
          <button onClick={props.onRemove} title="Remove client / delete its posts" style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', color: '#dc2626' }}>
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ overflowX: 'auto' }}>
          {rows.length === 0 ? (
            <div style={{ padding: '16px', fontSize: 12, color: '#94a3b8' }}>No posts yet — click &quot;Monthly plan&quot; or &quot;+ Add&quot; above.</div>
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: '#18181b', minWidth: 860 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#71717a', textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px', width: 28 }}></th>
                  <th style={{ padding: '8px 10px', width: 105 }}>Status</th>
                  <th style={{ padding: '8px 10px', width: 120 }}>Post Type</th>
                  <th style={{ padding: '8px 10px', width: 95 }}>Month</th>
                  <th style={{ padding: '8px 10px', width: 170 }}>Related URL</th>
                  <th style={{ padding: '8px 10px', width: 95 }}>CTA</th>
                  <th style={{ padding: '8px 10px', width: 150 }}>Additional Notes</th>
                  <th style={{ padding: '8px 10px' }}>GBP Post Content</th>
                  <th style={{ padding: '8px 10px', width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const st = STATUS_STYLE[row.status] || STATUS_STYLE['Generate']
                  const pt = POST_TYPE_STYLE[row.post_type || 'General'] || POST_TYPE_STYLE['General']
                  return (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', background: selected.has(row.id) ? '#f8fafc' : undefined }}>
                      <td style={{ padding: '10px 6px' }}><input type="checkbox" checked={selected.has(row.id)} onChange={() => props.onToggleSelect(row.id)} style={{ cursor: 'pointer' }} /></td>
                      <td style={{ padding: '8px 10px' }}>
                        <select value={row.status} onChange={e => props.onUpdateRow(row.id, { status: e.target.value })} style={{ width: '100%', fontSize: 11, fontWeight: 500, padding: '4px 6px', borderRadius: 99, background: st.bg, color: st.text, border: `1px solid ${st.border}`, cursor: 'pointer' }}>
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <select value={row.post_type || 'General'} onChange={e => props.onUpdateRow(row.id, { post_type: e.target.value })} style={{ width: '100%', fontSize: 11, fontWeight: 500, padding: '4px 6px', borderRadius: 6, background: pt.bg, color: pt.text, border: '1px solid #e2e8f0', cursor: 'pointer' }}>
                          {POST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {row.week && <div style={{ fontSize: 9, fontWeight: 600, color: '#7c3aed', marginBottom: 2 }}>WEEK {row.week}</div>}
                        <input className={cellInp} value={row.month_year ?? ''} onChange={e => props.setRows(rs => rs.map(r => r.id === row.id ? { ...r, month_year: e.target.value } : r))} onBlur={e => props.onUpdateRow(row.id, { month_year: e.target.value })} />
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <textarea ref={bindArea(`url-${row.id}`)} className={cellInp} rows={1} placeholder="https://…" value={row.related_url ?? ''}
                          onChange={e => props.setRows(rs => rs.map(r => r.id === row.id ? { ...r, related_url: e.target.value } : r))} onBlur={e => props.onUpdateRow(row.id, { related_url: e.target.value })}
                          style={{ resize: 'none', overflow: 'hidden', wordBreak: 'break-all', lineHeight: 1.4 }} />
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <select value={row.cta ?? 'Learn More'} onChange={e => props.onUpdateRow(row.id, { cta: e.target.value })} style={{ width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 6, background: '#fff', color: '#334155', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
                          {CTAS.map(x => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <textarea className={cellInp} rows={2} placeholder="topic, offer, service…" value={row.notes ?? ''}
                          onChange={e => props.setRows(rs => rs.map(r => r.id === row.id ? { ...r, notes: e.target.value } : r))} onBlur={e => props.onUpdateRow(row.id, { notes: e.target.value })}
                          style={{ resize: 'vertical', minHeight: 30 }} />
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {row.content ? (
                          <div>
                            <textarea ref={bindArea(`content-${row.id}`)} className={cellInp} rows={1} value={row.content}
                              onChange={e => props.setRows(rs => rs.map(r => r.id === row.id ? { ...r, content: e.target.value } : r))} onBlur={e => props.onUpdateRow(row.id, { content: e.target.value })}
                              style={{ resize: 'none', overflow: 'hidden', lineHeight: 1.45 }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
                              <span style={{ fontSize: 10, color: countWords(row.content) > 50 ? '#dc2626' : '#94a3b8' }}>{countWords(row.content)}/50 words</span>
                              <button onClick={() => props.onCopy(row)} title="Copy" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: copiedId === row.id ? '#16a34a' : '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                {copiedId === row.id ? '✓ Copied!' : 'Copy'}
                              </button>
                              <button onClick={() => props.onGenerateOne(row)} disabled={generatingIds.has(row.id) || bulkRunning} style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                {generatingIds.has(row.id) ? 'Regenerating…' : '↺ Regenerate'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => props.onGenerateOne(row)} disabled={generatingIds.has(row.id) || bulkRunning} className="text-[11px] font-medium px-3 h-7 rounded-md bg-zinc-900 text-white disabled:opacity-40">
                            {generatingIds.has(row.id) ? 'Generating…' : '✨ Generate'}
                          </button>
                        )}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        <button onClick={() => props.onDeleteRow(row.id)} title="Delete row" style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', color: '#dc2626' }}>
                          <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
