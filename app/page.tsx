'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from './lib/supabase'
import Papa from 'papaparse'

type ClientLink = {
  id: number
  client_id: number
  anchor_text: string
  url: string
}

type Client = {
  id: number
  client_name: string
  website_url: string
  niche: string
  csm_assigned: string
  ads_specialist: string
  seo_specialist: string
  package_plan: string
  status: string
  intake_form_link: string
  seo_workbook_link: string
  client_folder_link: string
  shared_assets_link: string
  content_guidelines_url: string
  blog_folder_url: string
  location_page_folder_url: string
}

const emptyForm: Omit<Client, 'id'> = {
  client_name: '', website_url: '', niche: '', csm_assigned: '',
  ads_specialist: '', seo_specialist: '', package_plan: '', status: '',
  intake_form_link: '', seo_workbook_link: '', client_folder_link: '', shared_assets_link: '',
  content_guidelines_url: '', blog_folder_url: '', location_page_folder_url: '',
}

const statusStyle: Record<string, string> = {
  active:     'bg-green-100 text-green-800',
  onboarding: 'bg-blue-100 text-blue-800',
  inactive:   'bg-gray-100 text-gray-500',
  archived:   'bg-red-100 text-red-700',
}

const csmOptions     = ['', 'Nikki', 'Sarah', 'Ross']
const adsOptions     = ['', 'Glenda', 'May', 'Ruchel', 'Kendrick', 'Ross']
const seoOptions     = ['', 'Eloisa', 'Lindey', 'Mikel', 'SEO Team']
const packageOptions = ['', 'SEO Only', 'SEO + AEO', 'Full Fencepost', 'Ads Only']
const statusOptions  = ['', 'active', 'onboarding', 'inactive', 'archived']

// Inline select
function InlineSelect({
  value, options, styleMap, placeholder = '—', rowId, field, onSave
}: {
  value: string; options: string[]; styleMap?: Record<string, string>
  placeholder?: string; rowId: number; field: string
  onSave: (id: number, field: string, val: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLSelectElement>(null)
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  if (!editing) return (
    <div onDoubleClick={() => setEditing(true)} className="cursor-pointer group" title="Double-click to edit">
      {value
        ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styleMap?.[value] ?? 'text-gray-700'}`}>{value}</span>
        : <span className="text-gray-400 text-xs group-hover:text-gray-500">{placeholder}</span>
      }
    </div>
  )

  return (
    <select ref={ref} defaultValue={value} autoFocus
      onBlur={e => { onSave(rowId, field, e.target.value); setEditing(false) }}
      onChange={e => { onSave(rowId, field, e.target.value); setEditing(false) }}
      className="h-7 border border-gray-300 rounded px-1 text-xs text-gray-800 outline-none bg-white focus:ring-1 focus:ring-blue-400">
      {options.map(o => <option key={o} value={o}>{o || '— select —'}</option>)}
    </select>
  )
}

// Inline text
function InlineText({
  value, placeholder = '—', rowId, field, onSave, link = false, showUrl = false
}: {
  value: string; placeholder?: string; rowId: number; field: string
  onSave: (id: number, field: string, val: string) => void; link?: boolean; showUrl?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) { setDraft(value); ref.current?.focus() } }, [editing])

  if (!editing) return (
    <div onDoubleClick={() => setEditing(true)} className="cursor-pointer group" title="Double-click to edit">
      {value
        ? link
          ? <a href={value} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              className="text-blue-400 hover:underline text-xs">
              {showUrl ? value.replace(/https?:\/\//, '').replace(/\/$/, '') : placeholder}
            </a>
          : <span className="text-gray-700 text-xs">{value}</span>
        : <span className="text-gray-300 text-xs group-hover:text-gray-400">{placeholder}</span>
      }
    </div>
  )

  return (
    <input ref={ref} value={draft} autoFocus
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { onSave(rowId, field, draft); setEditing(false) }}
      onKeyDown={e => { if (e.key === 'Enter') { onSave(rowId, field, draft); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
      className="h-7 border border-gray-300 rounded px-2 text-xs text-gray-800 outline-none bg-white focus:ring-1 focus:ring-blue-400 w-full min-w-[120px]"
    />
  )
}

function ClientLinksCell({ clientId, links, onAdd, onDelete }: {
  clientId: number
  links: ClientLink[]
  onAdd: (anchor_text: string, url: string) => void
  onDelete: (id: number) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [anchor, setAnchor]     = useState('')
  const [url, setUrl]           = useState('')
  const anchorRef               = useRef<HTMLInputElement>(null)

  useEffect(() => { if (showForm) anchorRef.current?.focus() }, [showForm])

  function handleAdd() {
    if (!anchor.trim() || !url.trim()) return
    onAdd(anchor.trim(), url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`)
    setAnchor('')
    setUrl('')
    setShowForm(false)
  }

  return (
    <div className="flex flex-col gap-0.5">
      {/* Custom links */}
      {links.map(l => (
        <div key={l.id} className="group flex items-center gap-1">
          <a href={l.url} target="_blank" rel="noreferrer"
            className="text-blue-400 hover:underline text-xs truncate max-w-[140px]"
            title={l.url}>
            {l.anchor_text}
          </a>
          <button onClick={() => onDelete(l.id)}
            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}

      {/* Add form */}
      {showForm ? (
        <div className="flex flex-col gap-1 mt-1 p-1.5 bg-gray-50 rounded border border-gray-200">
          <input ref={anchorRef} value={anchor} onChange={e => setAnchor(e.target.value)}
            placeholder="Anchor text"
            className="h-6 border border-gray-200 rounded px-2 text-xs outline-none focus:ring-1 focus:ring-blue-300 bg-white text-gray-800 placeholder-gray-300" />
          <input value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://..."
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowForm(false) }}
            className="h-6 border border-gray-200 rounded px-2 text-xs outline-none focus:ring-1 focus:ring-blue-300 bg-white text-gray-800 placeholder-gray-300" />
          <div className="flex gap-1">
            <button onClick={handleAdd} disabled={!anchor.trim() || !url.trim()}
              className="flex-1 h-6 bg-zinc-900 text-white text-xs rounded hover:bg-zinc-700 disabled:opacity-40 transition-colors">
              Save
            </button>
            <button onClick={() => { setShowForm(false); setAnchor(''); setUrl('') }}
              className="h-6 px-2 border border-gray-200 text-xs text-gray-400 rounded hover:bg-gray-100 transition-colors">
              ✕
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1 text-xs text-gray-300 hover:text-blue-400 transition-colors mt-0.5 w-fit">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add link
        </button>
      )}
    </div>
  )
}

export default function Home() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [teamFilter, setTeamFilter]     = useState('all')

  const [showAdd, setShowAdd]         = useState(false)
  const [form, setForm]               = useState<Omit<Client, 'id'>>(emptyForm)
  const [saving, setSaving]           = useState(false)
  const [duplicateError, setDuplicateError] = useState('')
  const [deleteTarget, setDeleteTarget]   = useState<Client | null>(null)
  const [deleting, setDeleting]           = useState(false)
  const [clientLinks, setClientLinks]     = useState<ClientLink[]>([])
  const [selectedIds, setSelectedIds]     = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting]   = useState(false)

  useEffect(() => { fetchClients(); fetchClientLinks() }, [])

  async function fetchClients() {
    const { data, error } = await supabase.from('master_clients').select('*').order('client_name')
    if (!error && data) setClients(data)
    setLoading(false)
  }

  async function fetchClientLinks() {
    const { data } = await supabase.from('client_links').select('*').order('created_at')
    if (data) setClientLinks(data)
  }

  async function addClientLink(client_id: number, anchor_text: string, url: string) {
    const { data, error } = await supabase.from('client_links').insert({ client_id, anchor_text, url }).select().single()
    if (!error && data) setClientLinks(prev => [...prev, data as ClientLink])
  }

  async function deleteClientLink(id: number) {
    const { error } = await supabase.from('client_links').delete().eq('id', id)
    if (!error) setClientLinks(prev => prev.filter(l => l.id !== id))
  }

  async function handleSave(id: number, field: string, val: string) {
    const oldName = clients.find(c => c.id === id)?.client_name
    setClients(prev => prev.map(c => c.id === id ? { ...c, [field]: val } : c))
    await supabase.from('master_clients').update({ [field]: val }).eq('id', id)
    // If client_name changed, sync to clients table so Internal Links join stays intact
    if (field === 'client_name' && oldName && val !== oldName) {
      const newSlug = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      await supabase.from('clients')
        .update({ client_name: val, client_slug: newSlug })
        .ilike('client_name', oldName)
    }
  }

  async function addClient() {
    if (!form.client_name || !form.website_url || !form.niche) return

    // Check for duplicates
    const nameDupe = clients.find(c => c.client_name.toLowerCase() === form.client_name.toLowerCase())
    const urlDupe  = clients.find(c => c.website_url.toLowerCase() === form.website_url.toLowerCase())
    if (nameDupe) { setDuplicateError(`A client named "${nameDupe.client_name}" already exists.`); return }
    if (urlDupe)  { setDuplicateError(`Website URL already used by "${urlDupe.client_name}".`); return }

    setSaving(true)
    const { data, error } = await supabase.from('master_clients').insert(form).select().single()
    if (!error && data) {
      setClients(prev => [...prev, data].sort((a, b) => a.client_name.localeCompare(b.client_name)))
      // Mirror into clients table so this client appears in Internal Links
      const slug = form.client_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      await supabase.from('clients').insert({ client_name: form.client_name, client_slug: slug, status: 'active' })
    }
    setSaving(false)
    setShowAdd(false)
    setForm(emptyForm)
    setDuplicateError('')
  }

  const CSV_FIELDS: (keyof Omit<Client, 'id'>)[] = [
    'client_name', 'website_url', 'niche', 'status',
    'csm_assigned', 'seo_specialist', 'ads_specialist', 'package_plan',
    'intake_form_link', 'content_guidelines_url',
    'seo_workbook_link', 'client_folder_link', 'shared_assets_link', 'blog_folder_url', 'location_page_folder_url',
  ]

  function exportCsv() {
    const rows = clients.map(c =>
      CSV_FIELDS.map(f => `"${((c[f] as string) || '').replace(/"/g, '""')}"`).join(',')
    )
    const csv  = [CSV_FIELDS.join(','), ...rows].join('\n')
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `fencepost-clients-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  async function handleImportCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setImporting(true)
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (result) => {
        const rows = result.data as any[]
        let added = 0, updated = 0
        for (const row of rows) {
          const name = (row.client_name || '').trim()
          if (!name) continue
          const existing    = clients.find(c => c.client_name.toLowerCase() === name.toLowerCase())
          const urlConflict = !existing && clients.find(c => c.website_url?.toLowerCase() === (row.website_url || '').toLowerCase())
          const payload: any = {}
          CSV_FIELDS.forEach(f => { if (row[f] !== undefined && row[f] !== '') payload[f] = row[f] })
          if (existing) {
            await supabase.from('master_clients').update(payload).eq('id', existing.id)
            updated++
          } else if (urlConflict) {
            // skip — URL already taken by another client
          } else {
            if (!row.website_url) continue
            await supabase.from('master_clients').insert({ ...emptyForm, ...payload })
            // Mirror into clients table so the new client appears in Internal Links
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            await supabase.from('clients').insert({ client_name: name, client_slug: slug, status: 'active' })
            added++
          }
        }
        await fetchClients()
        setImporting(false)
        alert(`Import complete: ${added} added, ${updated} updated`)
      },
    })
    e.target.value = ''
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.from('master_clients').delete().eq('id', deleteTarget.id)
    if (!error) {
      setClients(prev => prev.filter(c => c.id !== deleteTarget.id))
      // Find legacy client id, delete all their internal links, then delete the client row
      const { data: legacyClient } = await supabase
        .from('clients').select('id').ilike('client_name', deleteTarget.client_name).maybeSingle()
      if (legacyClient) {
        await supabase.from('internal_links').delete().eq('client_id', legacyClient.id)
        await supabase.from('clients').delete().eq('id', legacyClient.id)
      }
    }
    setDeleting(false)
    setDeleteTarget(null)
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    const ids = Array.from(selectedIds)
    const namesToDelete = clients.filter(c => selectedIds.has(c.id)).map(c => c.client_name)
    const { error } = await supabase.from('master_clients').delete().in('id', ids)
    if (!error) {
      setClients(prev => prev.filter(c => !selectedIds.has(c.id)))
      setSelectedIds(new Set())
      // For each deleted client: delete their internal links then the client row
      for (const name of namesToDelete) {
        const { data: legacyClient } = await supabase
          .from('clients').select('id').ilike('client_name', name).maybeSingle()
        if (legacyClient) {
          await supabase.from('internal_links').delete().eq('client_id', legacyClient.id)
          await supabase.from('clients').delete().eq('id', legacyClient.id)
        }
      }
    }
    setBulkDeleting(false)
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)))
    }
  }

  const allTeamMembers = [...new Set([
    ...clients.map(c => c.seo_specialist),
    ...clients.map(c => c.ads_specialist),
    ...clients.map(c => c.csm_assigned),
  ].filter(Boolean))].sort()

  const filtered = clients.filter(c => {
    const matchSearch = c.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.niche?.toLowerCase().includes(search.toLowerCase()) ||
      c.website_url?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || c.status === statusFilter
    const matchTeam   = teamFilter === 'all' || c.seo_specialist === teamFilter || c.ads_specialist === teamFilter || c.csm_assigned === teamFilter
    return matchSearch && matchStatus && matchTeam
  })

  const counts = {
    activeTotal: clients.filter(c => c.status === 'active' || c.status === 'onboarding').length,
    onboarding:  clients.filter(c => c.status === 'onboarding').length,
    inactive:    clients.filter(c => c.status === 'inactive').length,
  }

  const inputCls  = 'w-full h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white'
  const selectCls = 'w-full h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white'
  const labelCls  = 'block text-xs font-medium text-gray-400 mb-1'

  return (
    <div className="p-5 max-w-[1400px] mx-auto">

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-base font-semibold text-gray-800 tracking-tight">Fencepost clients list</h1>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Total active clients', value: counts.activeTotal, color: 'text-gray-800'  },
          { label: 'Onboarding',           value: counts.onboarding,  color: 'text-blue-700'  },
          { label: 'Inactive',             value: counts.inactive,    color: 'text-gray-400'  },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-lg border border-gray-100 px-3 py-2.5">
            <p className="text-xs text-gray-400 mb-0.5">{s.label}</p>
            <p className={`text-xl font-semibold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex gap-2 mb-3">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-md px-2.5 h-8 flex-1">
          <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
          </svg>
          <input type="text" placeholder="Search by name, niche, or URL..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-xs outline-none w-full text-gray-700 placeholder-gray-300" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-white border border-gray-200 rounded-md px-2.5 h-8 text-xs text-gray-500 outline-none">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="onboarding">Onboarding</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
          className="bg-white border border-gray-200 rounded-md px-2.5 h-8 text-xs text-gray-500 outline-none">
          <option value="all">All team members</option>
          {allTeamMembers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {/* Export CSV */}
        <button onClick={exportCsv}
          className="bg-white border border-gray-200 text-gray-500 text-xs rounded-md px-3 h-8 flex items-center gap-1.5 hover:bg-gray-50 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV
        </button>

        {/* Import CSV */}
        <label className={`bg-white border border-gray-200 text-gray-500 text-xs rounded-md px-3 h-8 flex items-center gap-1.5 hover:bg-gray-50 transition-colors cursor-pointer ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          {importing ? 'Importing…' : 'Import CSV'}
          <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={handleImportCsv} />
        </label>

        <button onClick={() => setShowAdd(true)}
          className="bg-zinc-900 text-white text-xs rounded-md px-3 h-8 flex items-center gap-1.5 hover:bg-zinc-700 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add client
        </button>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-zinc-900 text-white rounded-lg px-4 py-2.5 mb-2">
          <span className="text-xs font-medium">{selectedIds.size} client{selectedIds.size !== 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())}
              className="text-xs px-3 h-7 rounded-md border border-zinc-600 text-zinc-300 hover:bg-zinc-800 transition-colors">
              Deselect all
            </button>
            <button onClick={bulkDelete} disabled={bulkDeleting}
              className="text-xs px-3 h-7 rounded-md bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? <p className="text-xs text-gray-400">Loading...</p> : (
        <div className="bg-white rounded-lg border border-gray-200" style={{ overflowX: 'auto', maxHeight: '68vh', overflowY: 'auto' }}>
          <table className="w-full min-w-[1300px]" style={{ fontSize: 12 }}>
            <thead>
              <tr className="border-b border-gray-200">
                <th className="sticky top-0 left-0 z-20 bg-gray-50 px-3 py-2 w-8">
                  <input type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filtered.length }}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-zinc-900 cursor-pointer" />
                </th>
                {['Client', 'Niche', 'Status', 'CSM', 'SEO', 'Ads', 'Package', 'Links', ''].map((h, i) => (
                  <th key={i} className={`sticky top-0 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider ${i === 0 ? 'z-20 border-r border-gray-100 min-w-[180px]' : 'z-10'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id} className={`border-b border-gray-100 ${selectedIds.has(c.id) ? 'bg-blue-50/40' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                  <td className={`px-3 py-2 sticky left-0 z-10 w-8 ${selectedIds.has(c.id) ? 'bg-blue-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-zinc-900 cursor-pointer" />
                  </td>
                  {/* Client name + URL */}
                  <td className={`px-3 py-2 sticky left-0 z-10 border-r border-gray-100 min-w-[180px] ${selectedIds.has(c.id) ? 'bg-blue-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    <InlineText value={c.client_name} placeholder="Client name" rowId={c.id} field="client_name" onSave={handleSave} />
                    <InlineText value={c.website_url} placeholder="website url" rowId={c.id} field="website_url" onSave={handleSave} link showUrl />
                  </td>
                  <td className="px-3 py-2 min-w-[100px]">
                    <InlineText value={c.niche} placeholder="Add niche" rowId={c.id} field="niche" onSave={handleSave} />
                  </td>
                  <td className="px-3 py-2">
                    <InlineSelect value={c.status} options={statusOptions} styleMap={statusStyle}
                      placeholder="Set status" rowId={c.id} field="status" onSave={handleSave} />
                  </td>
                  <td className="px-3 py-2">
                    <InlineSelect value={c.csm_assigned} options={csmOptions} placeholder="—"
                      rowId={c.id} field="csm_assigned" onSave={handleSave} />
                  </td>
                  <td className="px-3 py-2">
                    <InlineSelect value={c.seo_specialist} options={seoOptions} placeholder="—"
                      rowId={c.id} field="seo_specialist" onSave={handleSave} />
                  </td>
                  <td className="px-3 py-2">
                    <InlineSelect value={c.ads_specialist} options={adsOptions} placeholder="—"
                      rowId={c.id} field="ads_specialist" onSave={handleSave} />
                  </td>
                  <td className="px-3 py-2">
                    <InlineSelect value={c.package_plan} options={packageOptions} placeholder="—"
                      rowId={c.id} field="package_plan" onSave={handleSave} />
                  </td>
                  <td className="px-3 py-2 min-w-[180px]">
                    <div className="flex flex-col gap-0.5">
                      <InlineText value={c.intake_form_link}        placeholder="Intake form"         rowId={c.id} field="intake_form_link"        onSave={handleSave} link />
                      <InlineText value={c.content_guidelines_url} placeholder="Content guidelines"  rowId={c.id} field="content_guidelines_url"  onSave={handleSave} link />
                      <InlineText value={c.seo_workbook_link}      placeholder="SEO workbook"        rowId={c.id} field="seo_workbook_link"       onSave={handleSave} link />
                      <InlineText value={c.client_folder_link}     placeholder="GDrive folder"       rowId={c.id} field="client_folder_link"      onSave={handleSave} link />
                      <InlineText value={c.shared_assets_link}     placeholder="Image assets"        rowId={c.id} field="shared_assets_link"      onSave={handleSave} link />
                      <InlineText value={c.blog_folder_url}        placeholder="Blog folder"         rowId={c.id} field="blog_folder_url"         onSave={handleSave} link />
                      <InlineText value={c.location_page_folder_url} placeholder="Location pages folder" rowId={c.id} field="location_page_folder_url" onSave={handleSave} link />
                      {clientLinks.filter(l => l.client_id === c.id).length > 0 && (
                        <div className="border-t border-gray-100 mt-1 pt-1" />
                      )}
                      <ClientLinksCell
                        clientId={c.id}
                        links={clientLinks.filter(l => l.client_id === c.id)}
                        onAdd={(anchor, url) => addClientLink(c.id, anchor, url)}
                        onDelete={deleteClientLink}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => setDeleteTarget(c)}
                      className="text-red-300 hover:text-red-500 border border-red-100 rounded px-2 py-1 hover:bg-red-50 transition-colors flex items-center gap-1" style={{ fontSize: 11 }}>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-gray-400">No clients found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add client modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-800">Add new client</h2>
              <button onClick={() => { setShowAdd(false); setForm(emptyForm); setDuplicateError('') }} className="text-gray-300 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {duplicateError && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  {duplicateError}
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-gray-300 uppercase tracking-wider mb-2.5">Core info</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div><label className={labelCls}>Client name <span className="text-red-400">*</span></label><input className={inputCls} placeholder="e.g. All Glass" value={form.client_name} onChange={e => { setForm(f => ({ ...f, client_name: e.target.value })); setDuplicateError('') }} /></div>
                  <div><label className={labelCls}>Website URL <span className="text-red-400">*</span></label><input className={inputCls} placeholder="https://..." value={form.website_url} onChange={e => { setForm(f => ({ ...f, website_url: e.target.value })); setDuplicateError('') }} /></div>
                  <div><label className={labelCls}>Niche <span className="text-red-400">*</span></label><input className={inputCls} placeholder="e.g. Roofing" value={form.niche} onChange={e => setForm(f => ({ ...f, niche: e.target.value }))} /></div>
                  <div><label className={labelCls}>Status</label>
                    <select className={selectCls} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                      <option value="">— select —</option>
                      <option value="active">Active</option><option value="onboarding">Onboarding</option>
                      <option value="inactive">Inactive</option><option value="archived">Archived</option>
                    </select>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-300 uppercase tracking-wider mb-2.5">Account info</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div><label className={labelCls}>CSM assigned</label>
                    <select className={selectCls} value={form.csm_assigned} onChange={e => setForm(f => ({ ...f, csm_assigned: e.target.value }))}>
                      <option value="">— select —</option>
                      {csmOptions.filter(Boolean).map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div><label className={labelCls}>SEO specialist</label>
                    <select className={selectCls} value={form.seo_specialist} onChange={e => setForm(f => ({ ...f, seo_specialist: e.target.value }))}>
                      <option value="">— select —</option>
                      {seoOptions.filter(Boolean).map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div><label className={labelCls}>Ads specialist</label>
                    <select className={selectCls} value={form.ads_specialist} onChange={e => setForm(f => ({ ...f, ads_specialist: e.target.value }))}>
                      <option value="">— select —</option>
                      {adsOptions.filter(Boolean).map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div><label className={labelCls}>Package plan</label>
                    <select className={selectCls} value={form.package_plan} onChange={e => setForm(f => ({ ...f, package_plan: e.target.value }))}>
                      <option value="">— select —</option>
                      {packageOptions.filter(Boolean).map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-300 uppercase tracking-wider mb-2.5">SEO resources</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div><label className={labelCls}>Intake form link</label><input className={inputCls} placeholder="https://docs.google.com/..." value={form.intake_form_link} onChange={e => setForm(f => ({ ...f, intake_form_link: e.target.value }))} /></div>
                  <div><label className={labelCls}>Content guidelines link</label><input className={inputCls} placeholder="https://docs.google.com/..." value={form.content_guidelines_url} onChange={e => setForm(f => ({ ...f, content_guidelines_url: e.target.value }))} /></div>
                  <div><label className={labelCls}>SEO workbook link</label><input className={inputCls} placeholder="https://..." value={form.seo_workbook_link} onChange={e => setForm(f => ({ ...f, seo_workbook_link: e.target.value }))} /></div>
                  <div><label className={labelCls}>GDrive folder link</label><input className={inputCls} placeholder="https://..." value={form.client_folder_link} onChange={e => setForm(f => ({ ...f, client_folder_link: e.target.value }))} /></div>
                  <div><label className={labelCls}>Image assets link</label><input className={inputCls} placeholder="https://..." value={form.shared_assets_link} onChange={e => setForm(f => ({ ...f, shared_assets_link: e.target.value }))} /></div>
                  <div><label className={labelCls}>Blog folder link</label><input className={inputCls} placeholder="https://drive.google.com/drive/folders/..." value={form.blog_folder_url} onChange={e => setForm(f => ({ ...f, blog_folder_url: e.target.value }))} /></div>
                  <div><label className={labelCls}>Location pages folder</label><input className={inputCls} placeholder="https://drive.google.com/drive/folders/..." value={form.location_page_folder_url} onChange={e => setForm(f => ({ ...f, location_page_folder_url: e.target.value }))} /></div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-gray-100">
              <button onClick={() => { setShowAdd(false); setForm(emptyForm); setDuplicateError('') }} className="h-8 px-3.5 rounded-md border border-gray-200 text-xs text-gray-500 hover:bg-gray-50">Cancel</button>
              <button onClick={addClient} disabled={saving || !form.client_name || !form.website_url || !form.niche}
                className="h-8 px-3.5 rounded-md bg-zinc-900 text-white text-xs hover:bg-zinc-700 disabled:opacity-40 transition-colors">
                {saving ? 'Saving...' : 'Save client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-red-100 w-full max-w-sm p-5">
            <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center mb-3">
              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Delete {deleteTarget.client_name}?</h3>
            <p className="text-xs text-gray-400 mb-4">This will permanently remove this client and cannot be undone.</p>
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