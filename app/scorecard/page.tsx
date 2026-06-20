'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

type Client = {
  id: number
  client_name: string
  website_url: string
  niche: string
  csm_assigned: string
  ads_specialist: string
  seo_specialist: string
}

type ScoreRow = {
  id: number
  client_id: number
  location_label: string
  csm: string
  ads_specialist: string
  seo_specialist: string
  satisfaction: string
  google_target: string
  google_status: string
  meta_target: string
  meta_status: string
  yelp_target: string
  yelp_status: string
  seo_target: string
  seo_status: string
  master_clients: {
    client_name: string
    website_url: string
    niche: string
  }
}

type SelectedEntry = {
  client_id: number
  locations: string[]
  showLocations: boolean
}

const statusStyle: Record<string, string> = {
  'On Track':      'bg-green-100 text-green-800',
  'Trending Good': 'bg-teal-100 text-teal-800',
  'Trending Bad':  'bg-amber-100 text-amber-800',
  'Off Track':     'bg-red-100 text-red-700',
  'Discover':      'bg-gray-100 text-gray-500',
  'N/A':           'bg-gray-100 text-gray-400',
}

const satStyle: Record<string, string> = {
  'Doing Great!': 'bg-green-100 text-green-800',
  'FIRE!':        'bg-amber-100 text-amber-800',
  'At Risk':      'bg-red-100 text-red-700',
  'Onboarding':   'bg-blue-100 text-blue-800',
  'N/A':          'bg-gray-100 text-gray-400',
}

const statusOptions = ['', 'On Track', 'Trending Good', 'Trending Bad', 'Off Track', 'Discover', 'N/A']
const satOptions    = ['', 'Doing Great!', 'FIRE!', 'At Risk', 'Onboarding', 'N/A']
const csmOptions    = ['', 'Nikki', 'Sarah', 'Ross']
const adsOptions    = ['', 'Glenda', 'May', 'Ruchel', 'Kendrick', 'Ross']
const seoOptions    = ['', 'Eloisa', 'Lindey', 'Mikel', 'SEO Team']

// Inline editable cell — select dropdown
function InlineSelect({
  value, options, styleMap, placeholder = '—', rowId, field, onSave
}: {
  value: string
  options: string[]
  styleMap?: Record<string, string>
  placeholder?: string
  rowId: number
  field: string
  onSave: (id: number, field: string, val: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLSelectElement>(null)

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  if (!editing) {
    return (
      <div onDoubleClick={() => setEditing(true)} className="cursor-pointer group min-w-[80px]" title="Double-click to edit">
        {value
          ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styleMap?.[value] ?? 'text-gray-700'}`}>{value}</span>
          : <span className="text-gray-400 text-xs group-hover:text-gray-500 transition-colors">{placeholder}</span>
        }
      </div>
    )
  }

  return (
    <select
      ref={ref}
      defaultValue={value}
      onBlur={e => { onSave(rowId, field, e.target.value); setEditing(false) }}
      onChange={e => { onSave(rowId, field, e.target.value); setEditing(false) }}
      className="h-7 border border-gray-300 rounded px-1 text-xs text-gray-800 outline-none bg-white focus:ring-1 focus:ring-blue-400"
      autoFocus
    >
      {options.map(o => <option key={o} value={o}>{o || '— select —'}</option>)}
    </select>
  )
}

// Inline editable cell — text input
function InlineText({
  value, placeholder = '—', rowId, field, onSave
}: {
  value: string
  placeholder?: string
  rowId: number
  field: string
  onSave: (id: number, field: string, val: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (editing) { setDraft(value); ref.current?.focus() } }, [editing])

  if (!editing) {
    return (
      <div onDoubleClick={() => setEditing(true)} className="cursor-pointer group max-w-[160px]" title="Double-click to edit">
        {value
          ? <span className="text-gray-700 text-xs break-words whitespace-pre-wrap">{value}</span>
          : <span className="text-gray-400 text-xs group-hover:text-gray-500 transition-colors">{placeholder}</span>
        }
      </div>
    )
  }

  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { onSave(rowId, field, draft); setEditing(false) }}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(rowId, field, draft); setEditing(false) }
        if (e.key === 'Escape') { setEditing(false) }
      }}
      rows={3}
      className="border border-gray-300 rounded px-2 py-1 text-xs text-gray-800 outline-none bg-white focus:ring-1 focus:ring-blue-400 resize-none w-36"
      autoFocus
    />
  )
}

// Channel cell — status badge + target text inline editable
type LogEntry = {
  id: number
  scorecard_id: number
  channel: string
  entry: string
  created_at: string
}

// ── Note popover (channel-aware structured entry) ─────────────────────────────

function NotePopover({ channel, target, logs, onAdd, onDelete, onClose }: {
  channel: string
  target: string
  logs: LogEntry[]
  onAdd: (entry: string) => Promise<void>
  onDelete: (id: number) => void
  onClose: () => void
}) {
  const [text, setText]   = useState('')
  const [saving, setSaving] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { taRef.current?.focus() }, [])

  async function handleAdd() {
    if (!text.trim()) return
    setSaving(true)
    await onAdd(text.trim())
    setText('')
    setSaving(false)
    taRef.current?.focus()
  }

  return (
    <div className="absolute right-0 top-5 z-50 rounded-lg"
      style={{ width: 240, background: '#fefce8', border: '1px solid #fde68a', boxShadow: '0 4px 16px rgba(0,0,0,0.13)' }}>

      {/* Header */}
      <div className="flex items-start justify-between px-3 pt-2.5 pb-1.5">
        <div>
          <span className="text-[10px] font-semibold text-yellow-700 uppercase tracking-wide capitalize">{channel}</span>
          {target && <p className="text-[10px] text-yellow-600 italic mt-0.5 leading-snug">🎯 {target}</p>}
        </div>
        <button onClick={onClose} className="text-yellow-300 hover:text-yellow-600 mt-0.5 flex-shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Existing entries */}
      {logs.length > 0 && (
        <div className="mx-2 mb-2 rounded border border-yellow-200 overflow-hidden">
          {logs.map((log, i) => (
            <div key={log.id}
              className={`px-2 py-1.5 group flex items-start justify-between gap-1 ${i < logs.length - 1 ? 'border-b border-yellow-100' : ''}`}
              style={{ background: '#fef9c3' }}>
              <p className="text-[11px] font-mono break-words leading-snug flex-1 whitespace-pre-wrap" style={{ color: '#713f12' }}>{log.entry}</p>
              <button onClick={() => onDelete(log.id)}
                className="text-yellow-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 mt-0.5">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* New entry textarea */}
      <div className="px-2 pb-2">
        <textarea
          ref={taRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd() } }}
          placeholder={'Add note…\n(Enter to save, Shift+Enter for new line)'}
          rows={3}
          className="w-full rounded px-2 py-1.5 text-[11px] font-mono outline-none focus:ring-1 focus:ring-yellow-400 resize-none placeholder-yellow-300"
          style={{ background: '#fef9c3', border: '1px solid #fde68a', color: '#713f12' }}
        />
      </div>
    </div>
  )
}

function ChannelCell({
  status, target, rowId, statusField, targetField, onSave, channel, logs, onAddLog, onDeleteLog
}: {
  status: string; target: string
  rowId: number; statusField: string; targetField: string
  onSave: (id: number, field: string, val: string) => void
  channel: string
  logs: LogEntry[]
  onAddLog: (scorecard_id: number, channel: string, entry: string) => void
  onDeleteLog: (log_id: number) => void
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const channelLogs = logs.filter(l => l.scorecard_id === rowId && l.channel === channel)
  const hasLogs = channelLogs.length > 0

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setNoteOpen(false)
    }
    if (noteOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [noteOpen])

  return (
    <div className="relative flex flex-col gap-1 pr-2" ref={ref}>

      {/* GSheets-style corner triangle note indicator */}
      <div
        onClick={() => setNoteOpen(v => !v)}
        title={hasLogs ? `${channelLogs.length} note${channelLogs.length !== 1 ? 's' : ''}` : 'Add note'}
        className="absolute top-0 right-0 cursor-pointer"
        style={{
          width: 0, height: 0,
          borderLeft: '7px solid transparent',
          borderTop: `7px solid ${hasLogs ? '#f59e0b' : '#d1d5db'}`,
        }}
      />

      <InlineSelect value={status} options={statusOptions} styleMap={statusStyle}
        placeholder="Set status" rowId={rowId} field={statusField} onSave={onSave} />

      {/* Editable target */}
      <InlineText value={target} placeholder="Add target…" rowId={rowId} field={targetField} onSave={onSave} />

      {/* Sticky-note popover */}
      {noteOpen && (
        <NotePopover
          channel={channel}
          target={target}
          logs={channelLogs}
          onAdd={(entry) => onAddLog(rowId, channel, entry) as unknown as Promise<void>}
          onDelete={onDeleteLog}
          onClose={() => setNoteOpen(false)}
        />
      )}
    </div>
  )
}

export default function ScorecardPage() {
  const [rows, setRows]       = useState<ScoreRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]       = useState('')
  const [csmFilter, setCsmFilter] = useState('all')
  const [satFilter, setSatFilter] = useState('all')
  const [seoFilter, setSeoFilter] = useState('all')
  const [adsFilter, setAdsFilter] = useState('all')

  const [showAddModal, setShowAddModal] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [entries, setEntries]           = useState<SelectedEntry[]>([])
  const [adding, setAdding]             = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<ScoreRow | null>(null)
  const [deleting, setDeleting]         = useState(false)
  const [logs, setLogs]                 = useState<LogEntry[]>([])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [{ data: sc }, { data: cl }, { data: lg }] = await Promise.all([
      supabase.from('scorecard').select('*, master_clients(client_name, website_url, niche)').order('id'),
      supabase.from('master_clients').select('id, client_name, website_url, niche, csm_assigned, ads_specialist, seo_specialist').order('client_name'),
      supabase.from('scorecard_logs').select('*').order('created_at', { ascending: false }),
    ])
    if (sc) setRows(sc as any)
    if (cl) setClients(cl)
    if (lg) setLogs(lg)
    setLoading(false)
  }

  // Auto save on cell change
  async function handleSave(id: number, field: string, val: string) {
    const oldRow = rows.find(r => r.id === id)
    const oldVal: string = oldRow ? (oldRow as any)[field] ?? '' : ''

    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r))
    await supabase.from('scorecard').update({ [field]: val }).eq('id', id)

    // Auto-log target changes
    if (field.endsWith('_target') && val.trim() !== oldVal.trim()) {
      const channel = field.replace('_target', '')
      const entry = oldVal.trim()
        ? `Target updated: "${oldVal.trim()}" → "${val.trim()}"`
        : `Target set: "${val.trim()}"`
      const { data, error } = await supabase
        .from('scorecard_logs')
        .insert({ scorecard_id: id, channel, entry })
        .select()
        .single()
      if (!error && data) setLogs(prev => [data as LogEntry, ...prev])
    }
  }

  async function handleAddLog(scorecard_id: number, channel: string, entry: string) {
    const { data, error } = await supabase.from('scorecard_logs').insert({ scorecard_id, channel, entry }).select().single()
    if (!error && data) setLogs(prev => [data, ...prev])
  }

  async function handleDeleteLog(log_id: number) {
    const { error } = await supabase.from('scorecard_logs').delete().eq('id', log_id)
    if (!error) setLogs(prev => prev.filter(l => l.id !== log_id))
  }

  // Delete
  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.from('scorecard').delete().eq('id', deleteTarget.id)
    if (!error) setRows(prev => prev.filter(r => r.id !== deleteTarget.id))
    setDeleting(false)
    setDeleteTarget(null)
  }

  const existingClientIds = new Set(rows.map(r => r.client_id))
  const availableClients  = clients.filter(c => c.client_name.toLowerCase().includes(clientSearch.toLowerCase()))
  const selectedIds       = entries.map(e => e.client_id)
  const availableCount    = availableClients.filter(c => !existingClientIds.has(c.id)).length
  const allSelected       = entries.length === availableCount && availableCount > 0

  function isSelected(id: number) { return selectedIds.includes(id) }
  function isAdded(id: number)    { return existingClientIds.has(id) }

  function toggleClient(c: Client) {
    if (isAdded(c.id)) return
    if (isSelected(c.id)) {
      setEntries(prev => prev.filter(e => e.client_id !== c.id))
    } else {
      setEntries(prev => [...prev, { client_id: c.id, locations: [], showLocations: false }])
    }
  }

  function selectAll() {
    const available = availableClients.filter(c => !isAdded(c.id))
    if (entries.length === available.length) {
      setEntries([])
    } else {
      setEntries(available.map(c => ({ client_id: c.id, locations: [], showLocations: false })))
    }
  }

  function toggleLocations(client_id: number) {
    setEntries(prev => prev.map(e =>
      e.client_id === client_id
        ? { ...e, showLocations: !e.showLocations, locations: e.locations.length === 0 && !e.showLocations ? [''] : e.locations }
        : e
    ))
  }

  function updateLocation(client_id: number, idx: number, val: string) {
    setEntries(prev => prev.map(e =>
      e.client_id === client_id
        ? { ...e, locations: e.locations.map((l, i) => i === idx ? val : l) }
        : e
    ))
  }

  function addLocation(client_id: number) {
    setEntries(prev => prev.map(e =>
      e.client_id === client_id ? { ...e, locations: [...e.locations, ''] } : e
    ))
  }

  function removeLocation(client_id: number, idx: number) {
    setEntries(prev => prev.map(e =>
      e.client_id === client_id
        ? { ...e, locations: e.locations.filter((_, i) => i !== idx) }
        : e
    ))
  }

  const totalEntries = entries.reduce((sum, e) => {
    const locs = e.locations.filter(l => l.trim() !== '')
    return sum + (locs.length > 0 ? locs.length : 1)
  }, 0)

  async function addClients() {
    if (!entries.length) return
    setAdding(true)
    const toInsert: any[] = []
    for (const entry of entries) {
      const c    = clients.find(x => x.id === entry.client_id)!
      const locs = entry.locations.filter(l => l.trim() !== '')
      if (locs.length === 0) {
        toInsert.push({
          client_id: entry.client_id, location_label: '',
          csm: c.csm_assigned || '', ads_specialist: c.ads_specialist || '', seo_specialist: c.seo_specialist || '',
          satisfaction: '', google_target: '', google_status: '',
          meta_target: '', meta_status: '', yelp_target: '', yelp_status: '',
          seo_target: '', seo_status: '',
        })
      } else {
        for (const loc of locs) {
          toInsert.push({
            client_id: entry.client_id, location_label: loc.trim(),
            csm: c.csm_assigned || '', ads_specialist: c.ads_specialist || '', seo_specialist: c.seo_specialist || '',
            satisfaction: '', google_target: '', google_status: '',
            meta_target: '', meta_status: '', yelp_target: '', yelp_status: '',
            seo_target: '', seo_status: '',
          })
        }
      }
    }
    const { data, error } = await supabase.from('scorecard').insert(toInsert).select('*, master_clients(client_name, website_url, niche)')
    if (!error && data) setRows(prev => [...prev, ...(data as any)])
    setAdding(false)
    setEntries([])
    setClientSearch('')
    setShowAddModal(false)
  }

  const counts = {
    total:      rows.length,
    fire:       rows.filter(r => r.satisfaction === 'FIRE!').length,
    great:      rows.filter(r => r.satisfaction === 'Doing Great!').length,
    risk:       rows.filter(r => r.satisfaction === 'At Risk').length,
    onboarding: rows.filter(r => r.satisfaction === 'Onboarding').length,
  }

  const filtered = rows.filter(r => {
    const name = r.master_clients?.client_name?.toLowerCase() || ''
    const loc  = r.location_label?.toLowerCase() || ''
    const matchSearch = name.includes(search.toLowerCase()) || loc.includes(search.toLowerCase())
    const matchCsm    = csmFilter === 'all' || r.csm === csmFilter
    const matchSat    = satFilter === 'all' || r.satisfaction === satFilter
    const matchSeo    = seoFilter === 'all' || r.seo_specialist === seoFilter
    const matchAds    = adsFilter === 'all' || r.ads_specialist === adsFilter
    return matchSearch && matchCsm && matchSat && matchSeo && matchAds
  })

  return (
    <div className="p-5 max-w-[1400px] mx-auto">

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-base font-semibold text-gray-800 tracking-tight">Scorecard</h1>
        <button onClick={() => setShowAddModal(true)}
          className="bg-zinc-900 text-white text-xs rounded-md px-3 h-8 flex items-center gap-1.5 hover:bg-zinc-700 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add clients to scorecard
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        {[
          { label: 'Total',       value: counts.total,      color: 'text-gray-800'  },
          { label: 'FIRE!',       value: counts.fire,       color: 'text-amber-700' },
          { label: 'Doing great', value: counts.great,      color: 'text-green-700' },
          { label: 'At risk',     value: counts.risk,       color: 'text-red-600'   },
          { label: 'Onboarding',  value: counts.onboarding, color: 'text-blue-700'  },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-lg border border-gray-100 px-3 py-2.5">
            <p className="text-xs text-gray-400 mb-0.5">{s.label}</p>
            <p className={`text-xl font-semibold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-md px-2.5 h-8 flex-1 min-w-[160px]">
          <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
          </svg>
          <input type="text" placeholder="Search company..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-xs outline-none w-full text-gray-700 placeholder-gray-300" />
        </div>
        <select value={csmFilter} onChange={e => setCsmFilter(e.target.value)}
          className="bg-white border border-gray-200 rounded-md px-2.5 h-8 text-xs text-gray-500 outline-none">
          <option value="all">All CSMs</option>
          {csmOptions.filter(Boolean).map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={seoFilter} onChange={e => setSeoFilter(e.target.value)}
          className="bg-white border border-gray-200 rounded-md px-2.5 h-8 text-xs text-gray-500 outline-none">
          <option value="all">All SEO</option>
          {seoOptions.filter(Boolean).map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={adsFilter} onChange={e => setAdsFilter(e.target.value)}
          className="bg-white border border-gray-200 rounded-md px-2.5 h-8 text-xs text-gray-500 outline-none">
          <option value="all">All Ads</option>
          {adsOptions.filter(Boolean).map(a => <option key={a}>{a}</option>)}
        </select>
        <select value={satFilter} onChange={e => setSatFilter(e.target.value)}
          className="bg-white border border-gray-200 rounded-md px-2.5 h-8 text-xs text-gray-500 outline-none">
          <option value="all">All satisfaction</option>
          {satOptions.filter(Boolean).map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200" style={{ overflowX: 'auto', maxHeight: '68vh', overflowY: 'auto' }}>
          <table className="w-full min-w-[1200px]" style={{ fontSize: 12, borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr className="border-b border-gray-200">
                <th className="sticky top-0 left-0 z-20 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider border-r border-gray-100" style={{ minWidth: 160 }}>Client</th>
                <th className="sticky top-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">CSM</th>
                <th className="sticky top-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">Ads</th>
                <th className="sticky top-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">SEO</th>
                <th className="sticky top-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">Satisfaction</th>
                <th className="sticky top-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">Google</th>
                <th className="sticky top-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">Meta</th>
                <th className="sticky top-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">SEO channel</th>
                <th className="sticky top-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">Yelp</th>
                <th className="sticky top-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const c           = clients.find(x => x.id === r.client_id)
                const displayName = r.master_clients?.client_name
                  ? (r.location_label ? `${r.master_clients.client_name} — ${r.location_label}` : r.master_clients.client_name)
                  : '—'
                return (
                  <tr key={r.id} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`} style={{ verticalAlign: 'top' }}>
                    <td className={`px-3 py-2 sticky left-0 z-10 border-r border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                      <div className="font-medium text-gray-800 whitespace-nowrap text-xs">{displayName}</div>
                    </td>
                    <td className="px-3 py-2">
                      <InlineSelect value={r.csm || ''} options={csmOptions} placeholder="—"
                        rowId={r.id} field="csm" onSave={handleSave} />
                    </td>
                    <td className="px-3 py-2">
                      <InlineSelect value={r.ads_specialist || ''} options={adsOptions} placeholder="—"
                        rowId={r.id} field="ads_specialist" onSave={handleSave} />
                    </td>
                    <td className="px-3 py-2">
                      <InlineSelect value={r.seo_specialist || ''} options={seoOptions} placeholder="—"
                        rowId={r.id} field="seo_specialist" onSave={handleSave} />
                    </td>
                    <td className="px-3 py-2">
                      <InlineSelect value={r.satisfaction || ''} options={satOptions} styleMap={satStyle}
                        placeholder="Set status" rowId={r.id} field="satisfaction" onSave={handleSave} />
                    </td>
                    <td className="px-3 py-2 align-top" style={{ minWidth: 160, width: 160 }}>
                      <ChannelCell status={r.google_status} target={r.google_target}
                        rowId={r.id} statusField="google_status" targetField="google_target" onSave={handleSave}
                        channel="google" logs={logs} onAddLog={handleAddLog} onDeleteLog={handleDeleteLog} />
                    </td>
                    <td className="px-3 py-2 align-top" style={{ minWidth: 160, width: 160 }}>
                      <ChannelCell status={r.meta_status} target={r.meta_target}
                        rowId={r.id} statusField="meta_status" targetField="meta_target" onSave={handleSave}
                        channel="meta" logs={logs} onAddLog={handleAddLog} onDeleteLog={handleDeleteLog} />
                    </td>
                    <td className="px-3 py-2 align-top" style={{ minWidth: 160, width: 160 }}>
                      <ChannelCell status={r.seo_status} target={r.seo_target}
                        rowId={r.id} statusField="seo_status" targetField="seo_target" onSave={handleSave}
                        channel="seo" logs={logs} onAddLog={handleAddLog} onDeleteLog={handleDeleteLog} />
                    </td>
                    <td className="px-3 py-2 align-top" style={{ minWidth: 160, width: 160 }}>
                      <ChannelCell status={r.yelp_status} target={r.yelp_target}
                        rowId={r.id} statusField="yelp_status" targetField="yelp_target" onSave={handleSave}
                        channel="yelp" logs={logs} onAddLog={handleAddLog} onDeleteLog={handleDeleteLog} />
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => setDeleteTarget(r)}
                        className="text-red-300 hover:text-red-500 border border-red-100 rounded px-2 py-1 hover:bg-red-50 transition-colors flex items-center gap-1" style={{ fontSize: 11 }}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-xs text-gray-400">No scorecard entries yet — add clients above</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add clients modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-800">Add clients to scorecard</h2>
              <button onClick={() => { setShowAddModal(false); setEntries([]); setClientSearch('') }} className="text-gray-300 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3 overflow-y-auto flex-1">
              <p className="text-xs font-medium text-gray-300 uppercase tracking-wider">Select clients from master list</p>
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-md px-2.5 h-8">
                <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
                </svg>
                <input type="text" placeholder="Search clients..." value={clientSearch}
                  onChange={e => setClientSearch(e.target.value)}
                  className="bg-transparent text-xs outline-none w-full text-gray-700 placeholder-gray-300" />
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div onClick={selectAll} className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors">
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${allSelected ? 'bg-zinc-900 border-zinc-900' : 'border-gray-300'}`}>
                    {allSelected && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <span className="text-xs font-medium text-gray-600">Select all available</span>
                  <span className="text-xs text-gray-400 ml-auto">{availableCount} available</span>
                </div>
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {availableClients.map(c => {
                    const added    = isAdded(c.id)
                    const selected = isSelected(c.id)
                    const entry    = entries.find(e => e.client_id === c.id)
                    const locCount = entry?.locations.filter(l => l.trim() !== '').length ?? 0
                    return (
                      <div key={c.id} className={`border-b border-gray-100 last:border-0 ${added ? 'opacity-40' : ''}`}>
                        <div onClick={() => toggleClient(c)}
                          className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${added ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
                          <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${selected ? 'bg-zinc-900 border-zinc-900' : 'border-gray-300'}`}>
                            {selected && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                          </div>
                          <div className="flex-1">
                            <div className="text-xs font-medium text-gray-800">{c.client_name}</div>
                            <div className="text-xs text-gray-400">{c.niche}</div>
                          </div>
                          {added && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">Already added</span>}
                          {selected && !added && (
                            <button onClick={e => { e.stopPropagation(); toggleLocations(c.id) }}
                              className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded border flex-shrink-0 transition-colors ${entry?.showLocations ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-400 hover:border-blue-200 hover:text-blue-500'}`}>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              {locCount > 0 ? `Locations (${locCount})` : '+ Add location'}
                            </button>
                          )}
                        </div>
                        {selected && entry?.showLocations && (
                          <div className="px-3 pb-3 pt-1 bg-blue-50/40 border-t border-blue-100">
                            {entry.locations.map((loc, idx) => (
                              <div key={idx} className="flex items-center gap-2 mb-1.5">
                                <input type="text" placeholder="e.g. Birmingham, AL" value={loc}
                                  onChange={e => updateLocation(c.id, idx, e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  className="flex-1 h-7 border border-gray-200 rounded px-2 text-xs outline-none focus:ring-1 focus:ring-blue-300 bg-white text-gray-800 placeholder-gray-300" />
                                {entry.locations.length > 1 && (
                                  <button onClick={e => { e.stopPropagation(); removeLocation(c.id, idx) }} className="text-gray-300 hover:text-red-400 transition-colors">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                )}
                              </div>
                            ))}
                            <button onClick={e => { e.stopPropagation(); addLocation(c.id) }}
                              className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1 mt-1">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                              Add another location
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {entries.length > 0 && (
                <p className="text-xs text-gray-400">
                  <span className="font-medium text-gray-700">{entries.length} client{entries.length !== 1 ? 's' : ''}</span>
                  {totalEntries !== entries.length && <> · <span className="font-medium text-gray-700">{totalEntries} entries</span></>}
                  {' '}will be added
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-gray-100">
              <button onClick={() => { setShowAddModal(false); setEntries([]); setClientSearch('') }}
                className="h-8 px-3.5 rounded-md border border-gray-200 text-xs text-gray-500 hover:bg-gray-50">Cancel</button>
              <button onClick={addClients} disabled={!entries.length || adding}
                className="h-8 px-3.5 rounded-md bg-zinc-900 text-white text-xs hover:bg-zinc-700 disabled:opacity-40 transition-colors">
                {adding ? 'Adding...' : `Add ${totalEntries} entr${totalEntries !== 1 ? 'ies' : 'y'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-red-100 w-full max-w-sm p-5">
            <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center mb-3">
              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">
              Delete {deleteTarget.master_clients?.client_name}{deleteTarget.location_label ? ` — ${deleteTarget.location_label}` : ''}?
            </h3>
            <p className="text-xs text-gray-400 mb-4">This will permanently remove this scorecard entry.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="h-8 px-3.5 rounded-md border border-gray-200 text-xs text-gray-500 hover:bg-gray-50">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting}
                className="h-8 px-3.5 rounded-md bg-red-500 text-white text-xs hover:bg-red-600 disabled:opacity-40 transition-colors">
                {deleting ? 'Deleting...' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}