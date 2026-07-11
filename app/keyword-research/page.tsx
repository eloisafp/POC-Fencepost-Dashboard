'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import RunWorkspace from './RunWorkspace'

type MasterClient = { id: number; client_name: string; website_url: string }
type ExportRow = {
  id: number
  filename: string
  public_url: string | null
  size_bytes: number | null
  created_at: string
  client_slug: string | null
}

function formatExportDate(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const inp = 'w-full h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white placeholder-gray-300'

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function ClientDropdown({ clients, value, onChange }: {
  clients: MasterClient[]
  value: MasterClient | null
  onChange: (c: MasterClient) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ]       = useState('')
  const ref             = useRef<HTMLDivElement>(null)

  useEffect(() => { setQ(value?.client_name || '') }, [value])

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filtered = q.trim()
    ? clients.filter(c => c.client_name.toLowerCase().includes(q.toLowerCase()))
    : clients

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        className={inp}
        placeholder="Search clients..."
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)', marginTop: 4,
          maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.map(c => (
            <button
              key={c.id}
              onMouseDown={e => { e.preventDefault(); onChange(c); setOpen(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, color: '#334155', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              {c.client_name}
              {c.website_url && <span style={{ color: '#94a3b8', marginLeft: 8, fontSize: 11 }}>{c.website_url}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function KeywordResearchPage() {
  const [clients, setClients]           = useState<MasterClient[]>([])
  const [client, setClient]             = useState<MasterClient | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [autoRunId, setAutoRunId]       = useState<number | null>(null)
  const [creating, setCreating]         = useState(false)
  const [confirmOpen, setConfirmOpen]   = useState(false)
  const [showPrevious, setShowPrevious] = useState(false)
  const [allExports, setAllExports]     = useState<ExportRow[]>([])
  const [loadingExports, setLoadingExports] = useState(false)

  useEffect(() => {
    supabase.from('master_clients').select('id, client_name, website_url').order('client_name')
      .then(({ data }) => { if (data) setClients(data as MasterClient[]) })
  }, [])

  useEffect(() => { setSelectedRunId(null) }, [client])

  async function createRun() {
    if (!client) return
    setConfirmOpen(false)
    setCreating(true)
    const { data, error } = await supabase
      .from('keyword_pipeline_runs')
      .insert({ master_client_id: client.id, client_slug: slugify(client.client_name) })
      .select('id')
      .single()
    setCreating(false)
    if (!error && data) { setAutoRunId(data.id); setSelectedRunId(data.id) }
  }

  async function loadAllExports() {
    setLoadingExports(true)
    const { data } = await supabase
      .from('keyword_pipeline_exports')
      .select('id, filename, public_url, size_bytes, created_at, client_slug')
      .order('created_at', { ascending: false })
      .limit(200)
    setAllExports((data || []) as unknown as ExportRow[])
    setLoadingExports(false)
  }

  // Global list: every saved export across ALL clients, newest first
  async function viewPrevious() {
    setShowPrevious(s => !s)
    if (showPrevious) return
    await loadAllExports()
  }

  async function deleteExport(exportId: number) {
    if (!window.confirm('Delete this export file permanently? This cannot be undone.')) return
    const res = await fetch('/api/keyword-pipeline/export/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ export_id: exportId }),
    })
    if (res.ok) await loadAllExports()
  }

  if (selectedRunId) {
    return (
      <RunWorkspace
        key={selectedRunId}
        runId={selectedRunId}
        autoRun={selectedRunId === autoRunId}
        onBack={() => setSelectedRunId(null)}
      />
    )
  }

  return (
    <div style={{ padding: '48px 24px 24px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: '#18181b', marginBottom: 4, textAlign: 'center' }}>Keyword Research → Content Plan</h1>
      <p style={{ fontSize: 12, color: '#71717a', marginBottom: 20, textAlign: 'center' }}>Client intake → Ahrefs keyword research → clustering → content plan → Excel export.</p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <ClientDropdown clients={clients} value={client} onChange={setClient} />
        </div>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={!client || creating}
          className="text-xs px-3 h-8 rounded-md bg-zinc-900 text-white disabled:opacity-50 shrink-0"
        >
          {creating ? 'Creating…' : '+ New run'}
        </button>
        <button
          onClick={viewPrevious}
          className="text-xs px-3 h-8 rounded-md border border-gray-300 bg-white text-gray-700 shrink-0"
        >
          {showPrevious ? 'Hide Exports' : 'View Previous'}
        </button>
      </div>

      {confirmOpen && client && (
        <div
          onClick={() => setConfirmOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(24,24,27,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, padding: '20px 22px', width: 380, maxWidth: 'calc(100vw - 48px)', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: '#18181b', marginBottom: 6 }}>
              Run full pipeline for {client.client_name}?
            </div>
            <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.5, marginBottom: 8 }}>
              This runs all phases automatically — intake parsing, seed keywords, competitors, Ahrefs keyword fetch, AI clustering, content plan, and the Excel export.
            </div>
            <div style={{ fontSize: 11, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '7px 10px', marginBottom: 16 }}>
              Uses Ahrefs API units and OpenRouter credits. Make sure the client&apos;s intake form link is set on the Clients page.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setConfirmOpen(false)}
                className="text-xs px-3 h-8 rounded-md border border-gray-300 bg-white text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={createRun}
                className="text-xs px-3 h-8 rounded-md bg-zinc-900 text-white font-medium"
              >
                Yes, run pipeline
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrevious && (
        <div style={{ marginTop: 20, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 20px 8px', fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #f1f5f9' }}>
            All saved exports — every client
          </div>

          {loadingExports && <div style={{ padding: 20, fontSize: 12, color: '#94a3b8' }}>Loading…</div>}

          {!loadingExports && allExports.length === 0 && (
            <div style={{ padding: 20, fontSize: 12, color: '#94a3b8' }}>
              No saved exports yet — open a run and click <span style={{ color: '#52525b', fontWeight: 500 }}>Generate New Export</span> on its View Exports tab.
            </div>
          )}

          {allExports.map((e, i) => (
            <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: i === allExports.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#52525b', fontVariantNumeric: 'tabular-nums' }}>
                {allExports.length - i}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#18181b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 3 }}>
                  {e.filename}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#94a3b8' }}>
                  <span style={{ padding: '1px 7px', borderRadius: 99, fontSize: 10, fontWeight: 500, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#52525b' }}>
                    {e.client_slug ?? 'unknown client'}
                  </span>
                  <span style={{ color: '#e2e8f0' }}>·</span>
                  <span>{formatExportDate(e.created_at)}</span>
                  <span style={{ color: '#e2e8f0' }}>·</span>
                  <span>{formatSize(e.size_bytes)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <a
                  href={e.public_url ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 5, height: 30, padding: '0 10px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#0369a1', textDecoration: 'none', whiteSpace: 'nowrap' }}
                >
                  <svg width="12" height="12" fill="none" stroke="#0284c7" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </a>
                <button
                  onClick={() => deleteExport(e.id)}
                  title="Delete this export"
                  style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', color: '#dc2626', flexShrink: 0 }}
                >
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
