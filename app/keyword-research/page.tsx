'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import RunWorkspace from './RunWorkspace'

type MasterClient = { id: number; client_name: string; website_url: string }
type Run = { id: number; client_slug: string; phase: string; created_at: string }

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
  const [runs, setRuns]                 = useState<Run[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [creating, setCreating]         = useState(false)

  useEffect(() => {
    supabase.from('master_clients').select('id, client_name, website_url').order('client_name')
      .then(({ data }) => { if (data) setClients(data as MasterClient[]) })
  }, [])

  const loadRuns = useCallback(async (clientId: number) => {
    const { data } = await supabase
      .from('keyword_pipeline_runs')
      .select('id, client_slug, phase, created_at')
      .eq('master_client_id', clientId)
      .order('created_at', { ascending: false })
    if (data) setRuns(data as Run[])
  }, [])

  useEffect(() => {
    if (client) { setSelectedRunId(null); loadRuns(client.id) }
    else { setRuns([]); setSelectedRunId(null) }
  }, [client, loadRuns])

  async function createRun() {
    if (!client) return
    setCreating(true)
    const { data, error } = await supabase
      .from('keyword_pipeline_runs')
      .insert({ master_client_id: client.id, client_slug: slugify(client.client_name) })
      .select('id')
      .single()
    setCreating(false)
    if (!error && data) {
      await loadRuns(client.id)
      setSelectedRunId(data.id)
    }
  }

  if (selectedRunId) {
    return <RunWorkspace runId={selectedRunId} onBack={() => setSelectedRunId(null)} />
  }

  return (
    <div style={{ padding: '48px 24px 24px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: '#18181b', marginBottom: 4, textAlign: 'center' }}>Keyword Research → Content Plan</h1>
      <p style={{ fontSize: 12, color: '#71717a', marginBottom: 20, textAlign: 'center' }}>Client intake → Ahrefs keyword research → clustering → content plan → Excel export.</p>

      <div style={{ marginBottom: 20 }}>
        <ClientDropdown clients={clients} value={client} onChange={setClient} />
      </div>

      {client && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>Runs for {client.client_name}</span>
            <button
              onClick={createRun}
              disabled={creating}
              className="text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white disabled:opacity-50"
            >
              {creating ? 'Creating…' : '+ New run'}
            </button>
          </div>

          {runs.length === 0 && (
            <div style={{ fontSize: 12, color: '#94a3b8', padding: '16px 0' }}>No runs yet — start one above.</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {runs.map(run => (
              <button
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ fontSize: 12, color: '#334155' }}>{run.client_slug}</span>
                <span style={{ fontSize: 10, color: '#71717a', textTransform: 'uppercase', letterSpacing: '.04em' }}>{run.phase}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
