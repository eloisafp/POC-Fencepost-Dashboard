'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { parseOutput, parseBlocks, postProcessBlocks, type Block } from './pageParser'
import { loadTemplates, extractHtmlEmbeds, applyHtmlEmbeds, type PageTemplate } from './templateStore'

declare const google: any

// ── Types ─────────────────────────────────────────────────────────────────────

type PageType  = 'service-location' | 'service-only'
type RowStatus = 'pending' | 'generating' | 'done' | 'error'
type Mode      = 'service-location' | 'service-only'

type BulkRow = {
  id:          number
  service:     string
  city:        string
  state:       string
  subServices: string
  pageType:    PageType
  keyword:     string
  aeoQuestion: string
  status:      RowStatus
  errorMsg?:   string
  docUrl?:     string
}

type ClientGroup = {
  uid:           string
  companyName:   string
  websiteUrl:    string
  folderId:      string
  folderName:    string
  templateId:    string
  collapsed:     boolean
  rows:          BulkRow[]
  isRunning:     boolean
  pausedAtIndex: number | null
  generateLimit: number
  contextStatus: { intake: boolean; guidelines: boolean } | null
}

type MasterClient = { id: number; client_name: string; website_url: string; location_page_folder_url: string }

function localUid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }

function dbRowToLocal(row: any): BulkRow {
  return {
    id:          row.id,
    service:     row.service      || '',
    city:        row.city         || '',
    state:       row.state        || '',
    subServices: row.sub_services || '',
    pageType:    (row.page_type === 'service-only' ? 'service-only' : 'service-location') as PageType,
    keyword:     row.keyword      || '',
    aeoQuestion: row.aeo_question || '',
    status:      (row.status      || 'pending') as RowStatus,
    errorMsg:    row.error_msg    || undefined,
    docUrl:      row.doc_url      || undefined,
  }
}

// ── InlineClientSelector ──────────────────────────────────────────────────────

function InlineClientSelector({ value, onChange, onSelect, placeholder }: {
  value: string; onChange: (v: string) => void
  onSelect: (c: MasterClient) => void; placeholder?: string
}) {
  const [clients, setClients] = useState<MasterClient[]>([])
  const [open, setOpen]       = useState(false)
  const wrapRef               = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.from('master_clients').select('id, client_name, website_url, location_page_folder_url').order('client_name')
      .then(({ data }: { data: MasterClient[] | null }) => { if (data) setClients(data) })
  }, [])

  useEffect(() => {
    function h(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filtered = value.trim() ? clients.filter(c => c.client_name.toLowerCase().includes(value.toLowerCase())) : clients

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className="h-8 border border-gray-200 rounded-md px-2.5 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-indigo-300 bg-white w-48"
        placeholder={placeholder ?? 'Client name'}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginTop: 2, maxHeight: 180, overflowY: 'auto', minWidth: 200 }}>
          {filtered.map(c => (
            <button key={c.id}
              onMouseDown={e => { e.preventDefault(); onChange(c.client_name); onSelect(c); setOpen(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                fontSize: 11, color: '#334155', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
              {c.client_name}
              {c.website_url && <span style={{ color: '#94a3b8', marginLeft: 6, fontSize: 10 }}>{c.website_url}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchGdocText(url: string): Promise<string> {
  if (!url) return ''
  try {
    const res = await fetch('/api/fetch-gdoc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
    if (!res.ok) return ''
    const { text } = await res.json()
    return text || ''
  } catch { return '' }
}

async function generateRow(
  row: BulkRow,
  companyName: string,
  websiteUrl: string,
  folderId: string,
  templateSections?: PageTemplate['sections'],
  intakeFormContent?: string,
  contentGuidelinesContent?: string,
): Promise<{ docUrl?: string }> {
  const genRes = await fetch('/api/generate-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName, service: row.service,
      city: row.city, state: row.state,
      subServices: row.subServices, websiteUrl,
      pageType: row.pageType,
      templateSections,
      intakeFormContent,
      contentGuidelinesContent,
      keyword:     row.keyword     || undefined,
      aeoQuestion: row.aeoQuestion || undefined,
    }),
  })
  if (!genRes.ok || !genRes.body) throw new Error('Generation failed')

  const reader  = genRes.body.getReader()
  const decoder = new TextDecoder()
  let accumulated = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    accumulated += decoder.decode(value, { stream: true })
  }

  const { seo, content } = parseOutput(accumulated)
  if (!content) throw new Error('Empty content received')
  const embeds = extractHtmlEmbeds(templateSections ?? [], { service: row.service, city: row.city, state: row.state, company: companyName })
  const blocks: Block[] = postProcessBlocks(parseBlocks(applyHtmlEmbeds(content, embeds)))

  const docxRes = await fetch('/api/generate-docx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seo, blocks, form: { companyName, service: row.service, city: row.city, state: row.state, subServices: row.subServices, websiteUrl, pageType: row.pageType } }),
  })
  if (!docxRes.ok) throw new Error('DOCX generation failed')

  const arrayBuffer = await docxRes.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)

  const monthYear = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const keyword   = [row.service, row.city].filter(Boolean).join(' ')
  const filename  = `${companyName} - ${keyword} - ${monthYear}.docx`

  const driveRes = await fetch('/api/send-to-drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, folderId, fileBase64: base64, companyName, service: row.service, city: row.city || '', state: row.state || '', pageType: row.pageType, titleTag: seo.titleTag, urlSlug: seo.urlSlug }),
  })
  if (!driveRes.ok) throw new Error(`Drive upload failed (${driveRes.status})`)

  const rawResponse = await driveRes.text()
  function toEditUrl(url: string) { return url.replace(/\/view(\?|$)/, '/edit$1') }
  const trimmed = rawResponse.trim()
  if (trimmed.startsWith('http')) return { docUrl: toEditUrl(trimmed) }
  try {
    const json   = JSON.parse(trimmed)
    const docUrl = json.docUrl ?? json.webViewLink ?? json.webContentLink ?? json.link ?? json.url ?? undefined
    return { docUrl: docUrl ? toEditUrl(docUrl) : undefined }
  } catch { return {} }
}

// ── Status icon ───────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: RowStatus }) {
  if (status === 'pending')    return <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-gray-300" /></span>
  if (status === 'generating') return <span className="w-5 h-5 rounded-full bg-blue-50 flex items-center justify-center"><svg className="w-3 h-3 text-blue-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg></span>
  if (status === 'done')       return <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center"><svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg></span>
  return <span className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center"><svg className="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></span>
}

// ── ClientGroupCard ───────────────────────────────────────────────────────────

function ClientGroupCard({ group, mode, templates, openDrivePicker, onUpdate, onDelete }: {
  group: ClientGroup
  mode: Mode
  templates: PageTemplate[]
  openDrivePicker: (cb: (id: string, name: string) => void) => void
  onUpdate: (update: Partial<ClientGroup> | ((g: ClientGroup) => ClientGroup)) => void
  onDelete: () => void
}) {
  const isLocMode = mode === 'service-location'
  const blankRow  = { service: '', city: '', state: '', subServices: '', keyword: '', aeoQuestion: '', pageType: mode as PageType }

  const [showAdd,     setShowAdd]     = useState(false)
  const [newRow,      setNewRow]      = useState(blankRow)
  const [addBusy,     setAddBusy]     = useState(false)
  const [csvError,    setCsvError]    = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ rowId: number; field: string } | null>(null)
  const abortRef                      = useRef(false)

  const doneCount    = group.rows.filter(r => r.status === 'done').length
  const errorCount   = group.rows.filter(r => r.status === 'error').length
  const pendingCount = group.rows.filter(r => r.status === 'pending').length
  const progress     = group.rows.length ? Math.round((doneCount + errorCount) / group.rows.length * 100) : 0

  function updateRows(fn: (rows: BulkRow[]) => BulkRow[]) {
    onUpdate(g => ({ ...g, rows: fn(g.rows) }))
  }

  function updateRowById(id: number, patch: Partial<BulkRow>) {
    updateRows(rows => rows.map(r => r.id === id ? { ...r, ...patch } : r))
    const dbPatch: Record<string, any> = {}
    if ('status'      in patch) dbPatch.status       = patch.status
    if ('docUrl'      in patch) dbPatch.doc_url      = patch.docUrl      ?? null
    if ('errorMsg'    in patch) dbPatch.error_msg    = patch.errorMsg    ?? null
    if ('service'     in patch) dbPatch.service      = patch.service
    if ('city'        in patch) dbPatch.city         = patch.city        || null
    if ('state'       in patch) dbPatch.state        = patch.state       || null
    if ('subServices' in patch) dbPatch.sub_services = patch.subServices || null
    if ('keyword'     in patch) dbPatch.keyword      = patch.keyword     || null
    if ('aeoQuestion' in patch) dbPatch.aeo_question = patch.aeoQuestion || null
    if ('pageType'    in patch) dbPatch.page_type    = patch.pageType
    if (Object.keys(dbPatch).length > 0) {
      supabase.from('page_queue').update(dbPatch).eq('id', id).then(() => {})
    }
  }

  // ── Editable cell ──────────────────────────────────────────────────────────

  function EditableCell({ row, field, value, className }: { row: BulkRow; field: keyof BulkRow; value: string; className?: string }) {
    const isEditing = editingCell?.rowId === row.id && editingCell?.field === field
    const [draft, setDraft] = useState(value)
    if (group.isRunning || row.status === 'generating') return <span className={className}>{value || '—'}</span>
    if (isEditing) return (
      <input autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { updateRowById(row.id, { [field]: draft }); setEditingCell(null) }}
        onKeyDown={e => { if (e.key === 'Enter') { updateRowById(row.id, { [field]: draft }); setEditingCell(null) } if (e.key === 'Escape') setEditingCell(null) }}
        className="w-full h-6 border border-indigo-300 rounded px-1.5 text-xs text-gray-900 outline-none bg-white focus:ring-1 focus:ring-indigo-400" style={{ minWidth: 60 }} />
    )
    return (
      <span onClick={() => { setDraft(value); setEditingCell({ rowId: row.id, field }) }}
        className={`${className} cursor-pointer hover:bg-indigo-50 hover:text-indigo-700 px-1 -mx-1 rounded transition-colors`} title="Click to edit">
        {value || <span className="text-gray-300 italic">—</span>}
      </span>
    )
  }

  // ── Add row ────────────────────────────────────────────────────────────────

  async function addRowManually() {
    if (!newRow.service || !group.companyName) return
    if (isLocMode && (!newRow.city || !newRow.state)) return
    setAddBusy(true)
    const { data: inserted } = await supabase.from('page_queue').insert({
      client_name:  group.companyName,
      service:      newRow.service,
      city:         newRow.city         || null,
      state:        newRow.state        || null,
      sub_services: newRow.subServices  || null,
      page_type:    mode,
      keyword:      newRow.keyword      || null,
      aeo_question: newRow.aeoQuestion  || null,
      status:       'pending',
    }).select('id').single()
    if (inserted) {
      updateRows(rows => [...rows, { ...newRow, id: inserted.id, pageType: mode, status: 'pending' }])
    }
    setNewRow(blankRow)
    setShowAdd(false)
    setAddBusy(false)
  }

  // ── CSV import (per-group) ─────────────────────────────────────────────────

  function handleClientCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setCsvError(null)
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      transformHeader: (h: string) => h.trim().replace(/^﻿/, '').toLowerCase().replace(/\s+/g, '_'),
      transform: (v: string) => (v ?? '').trim(),
      complete: async (result) => {
        if (!group.companyName) { setCsvError('Set a client name before uploading a CSV.'); return }
        const toInsert = (result.data as any[]).map(row => ({
          client_name:  group.companyName,
          service:      row['service']      || '',
          city:         row['city']         || null,
          state:        row['state']        || null,
          sub_services: row['sub_services'] || null,
          page_type:    mode,
          keyword:      row['keyword']      || null,
          aeo_question: row['aeo_question'] || null,
          status:       'pending',
        })).filter(r => r.service)
        if (toInsert.length === 0) { setCsvError('No valid rows found — make sure the CSV has a "service" column.'); return }
        const { data: inserted, error } = await supabase.from('page_queue').insert(toInsert).select('*')
        if (error) { setCsvError(`Upload failed: ${error.message}`); return }
        if (inserted) updateRows(rows => [...rows, ...inserted.map(dbRowToLocal)])
      },
    })
    e.target.value = ''
  }

  // ── Run group ──────────────────────────────────────────────────────────────

  async function runGroup(fromIndex = 0) {
    if (!group.folderId)    { alert(`Select a Drive folder for ${group.companyName || 'this client'}`); return }
    if (!group.companyName) { alert('Enter a client name first'); return }
    if (group.rows.length === 0) return

    abortRef.current = false
    onUpdate(g => ({ ...g, isRunning: true, pausedAtIndex: null }))

    const runLoop = async () => {
      const template    = templates.find(t => t.id === group.templateId)
      const currentRows = group.rows
      const limit       = group.generateLimit

      let intakeFormContent = '', contentGuidelinesContent = ''
      try {
        const { data: cd } = await supabase.from('master_clients').select('intake_form_link, content_guidelines_url').ilike('client_name', group.companyName).limit(1).single()
        if (cd) {
          const [i, g2] = await Promise.all([fetchGdocText(cd.intake_form_link || ''), fetchGdocText(cd.content_guidelines_url || '')])
          intakeFormContent = i; contentGuidelinesContent = g2
        }
        onUpdate(g => ({ ...g, contextStatus: { intake: !!intakeFormContent, guidelines: !!contentGuidelinesContent } }))
      } catch { onUpdate(g => ({ ...g, contextStatus: { intake: false, guidelines: false } })) }

      let generatedThisRun = 0

      for (let i = fromIndex; i < currentRows.length; i++) {
        if (abortRef.current) break
        if (limit > 0 && generatedThisRun >= limit) break
        const row = currentRows[i]
        if (row.status === 'done') continue
        updateRowById(row.id, { status: 'generating', errorMsg: undefined })
        try {
          const { docUrl } = await generateRow(row, group.companyName, group.websiteUrl, group.folderId, template?.sections, intakeFormContent, contentGuidelinesContent)
          updateRowById(row.id, { status: 'done', docUrl })
          generatedThisRun++
        } catch (err: any) {
          updateRowById(row.id, { status: 'error', errorMsg: err.message || 'Unknown error' })
          onUpdate(g => ({ ...g, isRunning: false, pausedAtIndex: i }))
          return
        }
        if (i < currentRows.length - 1 && !abortRef.current) {
          await new Promise(r => setTimeout(r, 10000 + Math.floor(Math.random() * 5001)))
        }
      }
      onUpdate(g => ({ ...g, isRunning: false, pausedAtIndex: null }))
    }

    if ('locks' in navigator) {
      await (navigator as any).locks.request(`page-generate-${group.uid}`, async () => { await runLoop() })
    } else {
      await runLoop()
    }
  }

  function retryFromError() { if (group.pausedAtIndex === null) return; updateRowById(group.rows[group.pausedAtIndex].id, { status: 'pending', errorMsg: undefined }); runGroup(group.pausedAtIndex) }
  function skipAndContinue() { if (group.pausedAtIndex === null) return; runGroup(group.pausedAtIndex + 1) }

  // ── CSV template helper ────────────────────────────────────────────────────

  function downloadCsvTemplate() {
    const h  = isLocMode
      ? 'service,city,state,sub_services,keyword,aeo_question'
      : 'service,sub_services,keyword,aeo_question'
    const ex = isLocMode
      ? 'Electrical Panel Upgrade,Fort Mill,SC,,electrical panel upgrade fort mill sc,"Who should I call for a panel upgrade in Fort Mill SC?"'
      : 'Electrical Panel Upgrade,,electrical panel upgrade,"Who should I call for a panel upgrade?"'
    const a  = document.createElement('a')
    a.href   = URL.createObjectURL(new Blob([h + '\n' + ex], { type: 'text/csv' }))
    a.download = `${isLocMode ? 'service-location' : 'service-only'}-template.csv`
    a.click()
  }

  // ── Add-row validation ─────────────────────────────────────────────────────

  const addDisabled = !newRow.service || addBusy || (isLocMode && (!newRow.city || !newRow.state))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

      {/* Group header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <button onClick={() => onUpdate(g => ({ ...g, collapsed: !g.collapsed }))} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0">
          <svg className={`w-4 h-4 transition-transform ${group.collapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
        </button>

        <InlineClientSelector value={group.companyName} onChange={v => onUpdate(g => ({ ...g, companyName: v }))}
          onSelect={c => {
            const m = c.location_page_folder_url?.match(/\/folders\/([a-zA-Z0-9_-]+)/)
            const folderId   = m ? m[1] : ''
            const folderName = folderId ? `${c.client_name} — Location Pages` : ''
            onUpdate(g => ({ ...g, companyName: c.client_name, websiteUrl: c.website_url || g.websiteUrl, folderId, folderName }))
          }}
          placeholder="Client name *" />

        {group.folderName ? (
          <div className="flex items-center gap-1.5 h-8 border border-green-200 bg-green-50 rounded-md px-2.5">
            <svg className="w-3 h-3 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
            <span className="text-xs text-green-700 max-w-[120px] truncate">{group.folderName}</span>
            <button onClick={() => openDrivePicker((id, name) => onUpdate(g => ({ ...g, folderId: id, folderName: name })))} className="text-xs text-green-600 hover:text-green-800 ml-1">Change</button>
          </div>
        ) : (
          <button onClick={() => openDrivePicker((id, name) => onUpdate(g => ({ ...g, folderId: id, folderName: name })))}
            className="h-8 border border-dashed border-gray-300 rounded-md px-3 text-xs text-gray-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
            Select folder
          </button>
        )}

        <select value={group.templateId} onChange={e => onUpdate(g => ({ ...g, templateId: e.target.value }))}
          className="h-8 border border-gray-200 rounded-md px-2 text-xs text-gray-700 outline-none focus:ring-1 focus:ring-gray-400 bg-white">
          <option value="">Default template</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <div className="flex-1" />

        {group.contextStatus && (
          <div className="flex items-center gap-1 shrink-0">
            <span className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded-full font-medium ${group.contextStatus.intake ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}>{group.contextStatus.intake ? '✓' : '○'} Intake</span>
            <span className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded-full font-medium ${group.contextStatus.guidelines ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}>{group.contextStatus.guidelines ? '✓' : '○'} Guidelines</span>
          </div>
        )}

        {group.collapsed && group.rows.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">{group.rows.length} rows</span>
            {doneCount > 0    && <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ {doneCount}</span>}
            {errorCount > 0   && <span className="text-red-500 bg-red-50 px-2 py-0.5 rounded-full">✗ {errorCount}</span>}
            {pendingCount > 0 && <span className="text-gray-400">{pendingCount} pending</span>}
          </div>
        )}

        {group.isRunning ? (
          <button onClick={() => { abortRef.current = true; onUpdate(g => ({ ...g, isRunning: false })) }}
            className="text-xs px-3 h-8 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition-colors flex items-center gap-1.5 shrink-0">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>Stop
          </button>
        ) : group.pausedAtIndex !== null ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={retryFromError} className="text-xs px-3 h-8 rounded-lg bg-amber-500 text-white font-medium hover:bg-amber-600 transition-colors flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>Retry
            </button>
            <button onClick={skipAndContinue} className="text-xs px-3 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">Skip &amp; Continue</button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0">
            {group.rows.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 whitespace-nowrap">Generate:</span>
                <select value={group.generateLimit} onChange={e => onUpdate(g => ({ ...g, generateLimit: parseInt(e.target.value) }))}
                  className="h-8 border border-gray-200 rounded-md px-2 text-xs text-gray-700 outline-none focus:ring-1 focus:ring-indigo-300 bg-white">
                  <option value={0}>All ({pendingCount} pending)</option>
                  {Array.from({ length: pendingCount }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} page{n !== 1 ? 's' : ''}</option>)}
                </select>
              </div>
            )}
            <button onClick={() => runGroup(0)} disabled={group.rows.length === 0 || !group.folderId || !group.companyName || pendingCount === 0}
              className="text-xs px-3 h-8 rounded-lg bg-zinc-900 text-white font-medium hover:bg-zinc-700 disabled:opacity-40 transition-colors flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>Generate
            </button>
          </div>
        )}

        {!group.isRunning && (
          <button onClick={onDelete} className="text-gray-300 hover:text-red-400 transition-colors shrink-0" title="Remove client">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        )}
      </div>

      {/* Expanded body */}
      {!group.collapsed && (
        <>
          {group.isRunning && (
            <div className="px-4 pt-3 pb-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-600">{doneCount + errorCount} / {group.rows.length} complete</span>
                <span className="text-xs text-gray-400">{progress}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-zinc-900 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {group.pausedAtIndex !== null && !group.isRunning && (
            <div className="mx-4 my-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-center gap-2">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Paused at row {group.pausedAtIndex + 1}. Click <strong className="mx-1">Retry</strong> to retry, or <strong className="mx-1">Skip &amp; Continue</strong> to move on.
            </div>
          )}

          {!group.isRunning && group.rows.length > 0 && (doneCount > 0 || errorCount > 0) && pendingCount === 0 && group.pausedAtIndex === null && (
            <div className="px-4 pt-3 pb-1 flex items-center gap-2">
              {doneCount > 0  && <span className="text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-full">✓ {doneCount} sent to Drive</span>}
              {errorCount > 0 && <span className="text-xs text-red-500 bg-red-50 px-2.5 py-1 rounded-full">✗ {errorCount} failed</span>}
            </div>
          )}

          {group.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-2.5 font-medium text-gray-400 w-6">#</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-400">Service</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-400">
                      City {isLocMode && <span className="text-red-300">*</span>}
                    </th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-400">
                      State {isLocMode && <span className="text-red-300">*</span>}
                    </th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-400 w-36">Keyword</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-400 w-48">AEO Question</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-400 w-24">Status</th>
                    <th className="px-3 py-2.5 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, i) => (
                    <tr key={row.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${group.pausedAtIndex === i ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-2.5 text-gray-300">{i + 1}</td>
                      <td className="px-3 py-2.5 text-gray-700 font-medium">
                        <EditableCell row={row} field="service" value={row.service} className="text-gray-700 font-medium" />
                      </td>
                      <td className="px-3 py-2.5">
                        <EditableCell row={row} field="city" value={row.city} className="text-gray-500" />
                      </td>
                      <td className="px-3 py-2.5">
                        <EditableCell row={row} field="state" value={row.state} className="text-gray-500" />
                      </td>
                      <td className="px-3 py-2.5 max-w-[140px]">
                        <EditableCell row={row} field="keyword" value={row.keyword} className="text-gray-500 truncate block" />
                      </td>
                      <td className="px-3 py-2.5 max-w-[190px]">
                        <EditableCell row={row} field="aeoQuestion" value={row.aeoQuestion} className="text-gray-400 truncate block" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5" title={row.errorMsg}>
                          <StatusIcon status={row.status} />
                          {row.status === 'error'      && row.errorMsg && <span className="text-red-400 truncate max-w-[100px]">{row.errorMsg}</span>}
                          {row.status === 'generating' && <span className="text-blue-400">Generating…</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {row.docUrl && (() => {
                            const m = row.docUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
                            const editUrl = m ? `https://docs.google.com/document/d/${m[1]}/edit?usp=sharing` : row.docUrl
                            return (
                              <>
                                <a href={editUrl} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors font-medium">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>View
                                </a>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(editUrl)
                                    const btn = document.getElementById(`copy-${row.id}`)
                                    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy' }, 1500) }
                                  }}
                                  id={`copy-${row.id}`}
                                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors font-medium">Copy
                                </button>
                              </>
                            )
                          })()}
                          {!group.isRunning && (
                            <button onClick={() => {
                              updateRows(rows => rows.filter(r => r.id !== row.id))
                              supabase.from('page_queue').delete().eq('id', row.id).then(() => {})
                            }} className="text-gray-300 hover:text-red-400 transition-colors">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center"><p className="text-xs text-gray-400">No rows yet — add rows or upload a CSV</p></div>
          )}

          {/* Add row form */}
          {showAdd && (
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Service <span className="text-red-400">*</span></p>
                  <input className="h-8 border border-gray-200 rounded-md px-2 text-xs text-gray-900 outline-none focus:ring-1 focus:ring-gray-400 bg-white w-44"
                    placeholder="Electrical Panel Upgrade" value={newRow.service}
                    onChange={e => setNewRow(r => ({ ...r, service: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') addRowManually() }} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">
                    City {isLocMode ? <span className="text-red-400">*</span> : <span className="text-gray-300">(optional)</span>}
                  </p>
                  <input className="h-8 border border-gray-200 rounded-md px-2 text-xs outline-none focus:ring-1 focus:ring-gray-400 bg-white w-28 text-gray-900"
                    placeholder="Fort Mill" value={newRow.city} onChange={e => setNewRow(r => ({ ...r, city: e.target.value }))} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">
                    State {isLocMode ? <span className="text-red-400">*</span> : <span className="text-gray-300">(optional)</span>}
                  </p>
                  <input className="h-8 border border-gray-200 rounded-md px-2 text-xs outline-none focus:ring-1 focus:ring-gray-400 bg-white w-24 text-gray-900"
                    placeholder="SC" value={newRow.state} onChange={e => setNewRow(r => ({ ...r, state: e.target.value }))} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Keyword <span className="text-gray-300">(optional)</span></p>
                  <input className="h-8 border border-gray-200 rounded-md px-2 text-xs outline-none focus:ring-1 focus:ring-gray-400 bg-white w-44 text-gray-900"
                    placeholder={isLocMode ? 'panel upgrade fort mill sc' : 'electrical panel upgrade'}
                    value={newRow.keyword} onChange={e => setNewRow(r => ({ ...r, keyword: e.target.value }))} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">AEO Question <span className="text-gray-300">(optional)</span></p>
                  <input className="h-8 border border-gray-200 rounded-md px-2 text-xs outline-none focus:ring-1 focus:ring-gray-400 bg-white w-64 text-gray-900"
                    placeholder="Who should I call for a panel upgrade?" value={newRow.aeoQuestion}
                    onChange={e => setNewRow(r => ({ ...r, aeoQuestion: e.target.value }))} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Sub-services <span className="text-gray-300">(optional)</span></p>
                  <input className="h-8 border border-gray-200 rounded-md px-2 text-xs outline-none focus:ring-1 focus:ring-gray-400 bg-white w-32 text-gray-900"
                    placeholder="optional" value={newRow.subServices} onChange={e => setNewRow(r => ({ ...r, subServices: e.target.value }))} />
                </div>
                <button onClick={addRowManually} disabled={addDisabled}
                  className="h-8 px-3 rounded-lg bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-700 disabled:opacity-40 transition-colors self-end">
                  {addBusy ? 'Adding…' : 'Add'}
                </button>
                <button onClick={() => setShowAdd(false)}
                  className="h-8 px-3 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 transition-colors self-end">Cancel</button>
              </div>
            </div>
          )}

          {/* CSV error */}
          {csvError && (
            <div className="mx-4 my-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-center justify-between gap-2">
              <span>{csvError}</span>
              <button onClick={() => setCsvError(null)} className="text-red-400 hover:text-red-600">✕</button>
            </div>
          )}

          {/* Group footer */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100">
            <span className="text-xs text-gray-400">{group.rows.length} row{group.rows.length !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button onClick={downloadCsvTemplate}
                className="text-xs px-2.5 h-7 rounded-md border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                CSV Template
              </button>
              <label className="text-xs px-2.5 h-7 rounded-md border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors flex items-center gap-1 cursor-pointer">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                Upload CSV
                <input type="file" accept=".csv" className="hidden" onChange={handleClientCsv} />
              </label>
              <button onClick={() => setShowAdd(v => !v)}
                className="text-xs px-2.5 h-7 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
                Add row
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main BulkGenerator ────────────────────────────────────────────────────────

export default function BulkGenerator({ openDrivePicker, mode }: {
  openDrivePicker: (onSelect: (id: string, name: string) => void) => void
  mode: Mode
}) {
  const [groups,        setGroups]        = useState<ClientGroup[]>([])
  const [templates,     setTemplates]     = useState<PageTemplate[]>([])
  const [loading,       setLoading]       = useState(true)
  const [masterError,   setMasterError]   = useState<string | null>(null)
  const [searchClient,  setSearchClient]  = useState('')

  // ── Load from Supabase on mount (filtered by page_type) ──────────────────

  const loadGroups = useCallback(async () => {
    const [{ data: rows }, { data: clients }] = await Promise.all([
      supabase.from('page_queue').select('*').eq('page_type', mode).order('created_at', { ascending: false }),
      supabase.from('master_clients').select('client_name, website_url, location_page_folder_url'),
    ])

    const folderMap = new Map<string, { websiteUrl: string; folderId: string; folderName: string }>()
    for (const c of (clients ?? [])) {
      const m = (c.location_page_folder_url ?? '').match(/\/folders\/([a-zA-Z0-9_-]+)/)
      folderMap.set(c.client_name, {
        websiteUrl:  c.website_url || '',
        folderId:    m ? m[1] : '',
        folderName:  m ? `${c.client_name} — Location Pages` : '',
      })
    }

    const groupMap = new Map<string, ClientGroup>()
    for (const row of (rows ?? [])) {
      if (!groupMap.has(row.client_name)) {
        const folder = folderMap.get(row.client_name)
        groupMap.set(row.client_name, {
          uid:           localUid(),
          companyName:   row.client_name,
          websiteUrl:    folder?.websiteUrl  || '',
          folderId:      folder?.folderId    || '',
          folderName:    folder?.folderName  || '',
          templateId:    '',
          collapsed:     false,
          rows:          [],
          isRunning:     false,
          pausedAtIndex: null,
          generateLimit: 0,
          contextStatus: null,
        })
      }
      groupMap.get(row.client_name)!.rows.push(dbRowToLocal(row))
    }

    const allTemplates = await loadTemplates()
    const defaultTemplateId = allTemplates.find(t => t.name === 'Default Template for All')?.id ?? ''
    setGroups(Array.from(groupMap.values()).map(g => ({ ...g, templateId: defaultTemplateId })))
    setTemplates(allTemplates)
    setLoading(false)
  }, [mode])

  useEffect(() => { loadGroups() }, [loadGroups])

  const totalRows = groups.reduce((a, g) => a + g.rows.length, 0)

  function addGroup() {
    const defaultTemplateId = templates.find(t => t.name === 'Default Template for All')?.id ?? ''
    setGroups(g => [...g, {
      uid: localUid(), companyName: '', websiteUrl: '',
      folderId: '', folderName: '', templateId: defaultTemplateId,
      collapsed: false, rows: [], isRunning: false, pausedAtIndex: null,
      generateLimit: 0, contextStatus: null,
    }])
  }

  function updateGroup(uid: string, update: Partial<ClientGroup> | ((g: ClientGroup) => ClientGroup)) {
    setGroups(gs => gs.map(g => g.uid !== uid ? g : typeof update === 'function' ? update(g) : { ...g, ...update }))
  }

  // ── Master CSV import ──────────────────────────────────────────────────────

  function handleMasterCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setMasterError(null)
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      transformHeader: (h: string) => h.trim().replace(/^﻿/, '').toLowerCase().replace(/\s+/g, '_'),
      transform: (v: string) => (v ?? '').trim(),
      complete: async (result) => {
        const data = result.data as any[]
        if (!data.length) { setMasterError('CSV appears empty.'); return }

        const toInsert: any[] = []
        data.forEach((row: any) => {
          const name = row['company_name'] || row['client_name'] || ''
          if (!name || !row['service']) return
          toInsert.push({
            client_name:  name,
            service:      row['service']      || '',
            city:         row['city']         || null,
            state:        row['state']        || null,
            sub_services: row['sub_services'] || null,
            page_type:    mode,
            keyword:      row['keyword']      || null,
            aeo_question: row['aeo_question'] || null,
            status:       'pending',
          })
        })

        if (!toInsert.length) { setMasterError('No valid rows found — make sure the CSV has "company_name" and "service" columns.'); return }
        const { data: inserted, error } = await supabase.from('page_queue').insert(toInsert).select('*')
        if (error) { setMasterError(`Upload failed: ${error.message}`); return }
        if (!inserted) return

        const names = [...new Set(inserted.map((r: any) => r.client_name))]
        const { data: clientData } = await supabase.from('master_clients').select('client_name, website_url, location_page_folder_url').in('client_name', names)
        const folderMap = new Map<string, { websiteUrl: string; folderId: string; folderName: string }>()
        for (const c of (clientData ?? [])) {
          const m = (c.location_page_folder_url ?? '').match(/\/folders\/([a-zA-Z0-9_-]+)/)
          folderMap.set(c.client_name, { websiteUrl: c.website_url || '', folderId: m ? m[1] : '', folderName: m ? `${c.client_name} — Location Pages` : '' })
        }

        setGroups(prev => {
          const next = [...prev]
          for (const row of inserted) {
            const existing = next.find(g => g.companyName === row.client_name)
            if (existing) {
              existing.rows = [...existing.rows, dbRowToLocal(row)]
            } else {
              const folder = folderMap.get(row.client_name)
              next.push({
                uid: localUid(), companyName: row.client_name,
                websiteUrl: folder?.websiteUrl || '', folderId: folder?.folderId || '', folderName: folder?.folderName || '',
                templateId: templates.find(t => t.name === 'Default Template for All')?.id ?? '', collapsed: false, rows: [dbRowToLocal(row)],
                isRunning: false, pausedAtIndex: null, generateLimit: 0, contextStatus: null,
              })
            }
          }
          return next
        })
      },
    })
    e.target.value = ''
  }

  // ── Master CSV template ────────────────────────────────────────────────────

  function downloadMasterTemplate() {
    const h  = mode === 'service-location'
      ? 'company_name,website_url,service,city,state,sub_services,keyword,aeo_question'
      : 'company_name,website_url,service,sub_services,keyword,aeo_question'
    const ex = mode === 'service-location'
      ? 'Northland Companies,https://example.com,Electrical Panel Upgrade,Fort Mill,SC,,electrical panel upgrade fort mill sc,"Who should I call for a panel upgrade in Fort Mill SC?"'
      : 'Northland Companies,https://example.com,Electrical Panel Upgrade,,electrical panel upgrade,"Who should I call for a panel upgrade?"'
    const a  = document.createElement('a')
    a.href   = URL.createObjectURL(new Blob([h + '\n' + ex], { type: 'text/csv' }))
    a.download = `master-${mode}-template.csv`; a.click()
  }

  if (loading) return <div className="py-16 text-center text-xs text-gray-400">Loading queue…</div>

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-400">
            {groups.length} client{groups.length !== 1 ? 's' : ''} · {totalRows} total row{totalRows !== 1 ? 's' : ''}
          </p>
          <div className="relative">
            <svg className="w-3.5 h-3.5 text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z"/>
            </svg>
            <input
              className="h-8 pl-8 pr-3 border border-gray-200 rounded-md text-xs text-gray-700 outline-none focus:ring-1 focus:ring-gray-400 bg-white w-48 placeholder-gray-300"
              placeholder="Search client…"
              value={searchClient}
              onChange={e => setSearchClient(e.target.value)}
            />
            {searchClient && (
              <button onClick={() => setSearchClient('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            )}
          </div>
        </div>
        <button onClick={addGroup} className="flex items-center gap-2 px-4 h-8 rounded-lg bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-700 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
          Add Client
        </button>
      </div>

      {masterError && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-center justify-between gap-2">
          <span>{masterError}</span>
          <button onClick={() => setMasterError(null)} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {groups.filter(g => !searchClient || g.companyName.toLowerCase().includes(searchClient.toLowerCase())).map(group => (
        <ClientGroupCard key={group.uid} group={group} mode={mode} templates={templates} openDrivePicker={openDrivePicker}
          onUpdate={update => updateGroup(group.uid, update)}
          onDelete={async () => {
            const ids = group.rows.map(r => r.id).filter(Boolean)
            if (ids.length > 0) await supabase.from('page_queue').delete().in('id', ids)
            setGroups(gs => gs.filter(g => g.uid !== group.uid))
          }} />
      ))}

      {groups.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 py-16 flex flex-col items-center gap-3 text-center">
          <svg className="w-8 h-8 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          <div>
            <p className="text-sm font-medium text-gray-400">No clients yet</p>
            <p className="text-xs text-gray-300 mt-0.5">Add a client group or upload a master CSV</p>
          </div>
          <div className="flex gap-2 mt-1">
            <label className="text-xs px-3 h-7 rounded-md border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors cursor-pointer flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
              Upload Master CSV
              <input type="file" accept=".csv" className="hidden" onChange={handleMasterCsv} />
            </label>
            <button onClick={addGroup} className="text-xs px-3 h-7 rounded-md bg-zinc-900 text-white hover:bg-zinc-700 transition-colors">+ Add Client</button>
          </div>
        </div>
      )}
    </div>
  )
}
