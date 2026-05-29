'use client'

import { useState, useRef, useEffect } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { parseOutput, parseBlocks, postProcessBlocks, type Block } from './pageParser'
import { loadTemplates, type PageTemplate } from './templateStore'

declare const google: any

// ── Types ─────────────────────────────────────────────────────────────────────

type PageType = 'service-location' | 'service-only'
type RowStatus = 'pending' | 'generating' | 'done' | 'error'

type BulkRow = {
  id: string
  companyName: string
  service: string
  city: string
  state: string
  subServices: string
  websiteUrl: string
  pageType: PageType
  status: RowStatus
  errorMsg?: string
  docUrl?: string
}

type MasterClient = { id: number; client_name: string; website_url: string }

const emptyNewRow = {
  companyName: '', service: '', city: '', state: '',
  subServices: '', websiteUrl: '', pageType: 'service-location' as PageType,
}

// ── CSV template ──────────────────────────────────────────────────────────────

const CSV_HEADERS = 'company_name,service,city,state,sub_services,website_url,page_type'
const CSV_EXAMPLE = 'Northland Companies,Insulation Contractor,Minneapolis,Minnesota,Spray Foam;Blown-In,https://example.com,service-location'

function downloadCsvTemplate() {
  const blob = new Blob([CSV_HEADERS + '\n' + CSV_EXAMPLE], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'bulk-pages-template.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── Inline client selector ────────────────────────────────────────────────────

function InlineClientSelector({ value, onChange, onSelect, placeholder }: {
  value: string; onChange: (v: string) => void
  onSelect: (c: MasterClient) => void; placeholder?: string
}) {
  const [clients, setClients] = useState<MasterClient[]>([])
  const [open, setOpen]       = useState(false)
  const wrapRef               = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.from('master_clients').select('id, client_name, website_url').order('client_name')
      .then(({ data }: { data: MasterClient[] | null }) => { if (data) setClients(data) })
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = value.trim()
    ? clients.filter(c => c.client_name.toLowerCase().includes(value.toLowerCase()))
    : clients

  const inp = 'w-full h-7 border border-gray-200 rounded px-2 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white'

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input className={inp} placeholder={placeholder ?? 'Company'} value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)} />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginTop: 2, maxHeight: 180, overflowY: 'auto' }}>
          {filtered.map(c => (
            <button key={c.id} onMouseDown={e => { e.preventDefault(); onChange(c.client_name); onSelect(c); setOpen(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px',
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

// ── Generate one row ──────────────────────────────────────────────────────────

async function generateRow(row: BulkRow, folderId: string, templateSections?: PageTemplate['sections']): Promise<{ docUrl?: string; rawResponse: string }> {
  // 1. Generate page content (streaming, collect full output)
  const genRes = await fetch('/api/generate-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: row.companyName, service: row.service,
      city: row.city, state: row.state,
      subServices: row.subServices, websiteUrl: row.websiteUrl,
      pageType: row.pageType,
      templateSections,
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

  const blocks: Block[] = postProcessBlocks(parseBlocks(content))

  // 2. Generate .docx
  const docxRes = await fetch('/api/generate-docx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seo, blocks, form: { ...row, pageType: row.pageType } }),
  })
  if (!docxRes.ok) throw new Error('DOCX generation failed')

  const arrayBuffer = await docxRes.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)

  const serviceSlug = row.service.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').toLowerCase()
  const citySlug   = row.city   ? `-${row.city.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').toLowerCase()}`  : ''
  const filename   = `${serviceSlug}${citySlug}.docx`

  // 3. Send to Drive
  const driveRes = await fetch('/api/send-to-drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename, folderId, fileBase64: base64,
      companyName: row.companyName, service: row.service,
      city: row.city || '', state: row.state || '',
      pageType: row.pageType, titleTag: seo.titleTag, urlSlug: seo.urlSlug,
    }),
  })
  if (!driveRes.ok) throw new Error(`Drive upload failed (${driveRes.status})`)

  // 4. Parse share link from Make response
  const rawResponse = await driveRes.text()

  // If Make returned a plain URL (not JSON), use it directly
  const trimmed = rawResponse.trim()
  if (trimmed.startsWith('http')) {
    return { docUrl: trimmed, rawResponse }
  }

  try {
    const json = JSON.parse(trimmed)
    // Try multiple possible property names
    const docUrl = json.docUrl ?? json.webViewLink ?? json.webContentLink ?? json.link ?? json.url ?? undefined
    return { docUrl: docUrl || undefined, rawResponse }
  } catch {
    // Make returned plain text that isn't a URL or JSON (e.g. "Accepted")
    return { docUrl: undefined, rawResponse }
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function BulkGenerator({ openDrivePicker }: {
  openDrivePicker: (onSelect: (id: string, name: string) => void) => void
}) {
  const [rows, setRows]                       = useState<BulkRow[]>([])
  const [folderId, setFolderId]               = useState('')
  const [folderName, setFolderName]           = useState('')
  const [isRunning, setIsRunning]             = useState(false)
  const [showAdd, setShowAdd]                 = useState(false)
  const [newRow, setNewRow]                   = useState({ ...emptyNewRow })
  const [templates, setTemplates]             = useState<PageTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const abortRef                              = useRef(false)

  useEffect(() => { setTemplates(loadTemplates()) }, [])

  const doneCount    = rows.filter(r => r.status === 'done').length
  const errorCount   = rows.filter(r => r.status === 'error').length
  const pendingCount = rows.filter(r => r.status === 'pending').length
  const progress     = rows.length ? Math.round((doneCount + errorCount) / rows.length * 100) : 0

  // ── CSV upload ──────────────────────────────────────────────────────────────

  function handleCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (result) => {
        const parsed: BulkRow[] = (result.data as any[]).map((row, i) => ({
          id: `csv-${Date.now()}-${i}`,
          companyName: row.company_name ?? '',
          service:     row.service ?? '',
          city:        row.city ?? '',
          state:       row.state ?? '',
          subServices: row.sub_services ?? '',
          websiteUrl:  row.website_url ?? '',
          pageType:    (row.page_type === 'service-only' ? 'service-only' : 'service-location') as PageType,
          status: 'pending',
        }))
        setRows(r => [...r, ...parsed])
      },
    })
    e.target.value = ''
  }

  // ── Add row manually ────────────────────────────────────────────────────────

  function addRow() {
    if (!newRow.companyName || !newRow.service) return
    setRows(r => [...r, { ...newRow, id: `manual-${Date.now()}`, status: 'pending' }])
    setNewRow({ ...emptyNewRow })
    setShowAdd(false)
  }

  function deleteRow(id: string) {
    setRows(r => r.filter(row => row.id !== id))
  }

  function updateRowStatus(id: string, status: RowStatus, errorMsg?: string, docUrl?: string) {
    setRows(r => r.map(row => row.id === id
      ? { ...row, status, errorMsg, ...(docUrl ? { docUrl } : {}) }
      : row))
  }

  // ── Generate all ────────────────────────────────────────────────────────────

  async function runAll() {
    if (!folderId) { alert('Please select a Drive folder first'); return }
    if (rows.length === 0) return
    abortRef.current = false
    setIsRunning(true)

    const selectedTemplate = templates.find(t => t.id === selectedTemplateId)

    // Reset all to pending
    setRows(r => r.map(row => ({ ...row, status: 'pending', errorMsg: undefined })))

    for (let i = 0; i < rows.length; i++) {
      if (abortRef.current) break
      const row = rows[i]
      updateRowStatus(row.id, 'generating')
      try {
        const { docUrl } = await generateRow(row, folderId, selectedTemplate?.sections)
        updateRowStatus(row.id, 'done', undefined, docUrl)
      } catch (err: any) {
        updateRowStatus(row.id, 'error', err.message || 'Unknown error')
      }
      // Small delay between rows to avoid rate limiting
      if (i < rows.length - 1 && !abortRef.current) {
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    setIsRunning(false)
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  const inp = 'w-full h-7 border border-gray-200 rounded px-2 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white placeholder-gray-300'
  const lbl = 'block text-xs font-medium text-gray-500 mb-1'

  const statusIcon = (s: RowStatus) => {
    if (s === 'pending')    return <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-gray-300" /></span>
    if (s === 'generating') return <span className="w-5 h-5 rounded-full bg-blue-50 flex items-center justify-center"><svg className="w-3 h-3 text-blue-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg></span>
    if (s === 'done')       return <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center"><svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg></span>
    return <span className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center"><svg className="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></span>
  }

  return (
    <div className="space-y-4">

      {/* ── Top bar: folder + actions ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <p className="text-xs font-medium text-gray-500 mb-1.5">Google Drive folder <span className="text-red-400">*</span></p>
          {folderName ? (
            <div className="flex items-center gap-2 h-8 border border-green-200 bg-green-50 rounded-md px-3">
              <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
              <span className="text-xs text-green-700 flex-1 truncate">{folderName}</span>
              <button onClick={() => openDrivePicker((id, name) => { setFolderId(id); setFolderName(name) })} className="text-xs text-green-600 hover:text-green-800">Change</button>
            </div>
          ) : (
            <button onClick={() => openDrivePicker((id, name) => { setFolderId(id); setFolderName(name) })}
              className="w-full h-8 border border-dashed border-gray-300 rounded-md px-3 text-xs text-gray-500 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
              Browse Google Drive
            </button>
          )}
        </div>

        {/* Template selector */}
        <div className="min-w-[180px]">
          <p className="text-xs font-medium text-gray-500 mb-1.5">Template</p>
          <select
            className="w-full h-8 border border-gray-200 rounded-md px-2 text-xs text-gray-700 outline-none focus:ring-1 focus:ring-gray-400 bg-white"
            value={selectedTemplateId}
            onChange={e => setSelectedTemplateId(e.target.value)}
          >
            <option value="">Default (built-in)</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={downloadCsvTemplate}
            className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors bg-white">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            CSV Template
          </button>

          <label className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors bg-white cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
            Upload CSV
            <input type="file" accept=".csv" className="hidden" onChange={handleCsv} />
          </label>

          <button onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors bg-white">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
            Add row
          </button>
        </div>
      </div>

      {/* ── Add row form ── */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-indigo-100 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">New row</p>

          {/* Page type toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5 mb-3 w-fit">
            {([{ value: 'service-location', label: 'Service + Location' }, { value: 'service-only', label: 'Service Only' }] as const).map(pt => (
              <button key={pt.value} onClick={() => setNewRow(r => ({ ...r, pageType: pt.value }))}
                className={`text-xs px-3 py-1.5 rounded-md transition-all ${newRow.pageType === pt.value ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                {pt.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <div>
              <label className={lbl}>Company <span className="text-red-400">*</span></label>
              <InlineClientSelector
                value={newRow.companyName}
                onChange={v => setNewRow(r => ({ ...r, companyName: v }))}
                onSelect={c => setNewRow(r => ({ ...r, companyName: c.client_name, websiteUrl: c.website_url || r.websiteUrl }))}
              />
            </div>
            <div>
              <label className={lbl}>Service <span className="text-red-400">*</span></label>
              <input className={inp} placeholder="Insulation Contractor" value={newRow.service} onChange={e => setNewRow(r => ({ ...r, service: e.target.value }))} />
            </div>
            {newRow.pageType === 'service-location' && (
              <>
                <div>
                  <label className={lbl}>City <span className="text-red-400">*</span></label>
                  <input className={inp} placeholder="Minneapolis" value={newRow.city} onChange={e => setNewRow(r => ({ ...r, city: e.target.value }))} />
                </div>
                <div>
                  <label className={lbl}>State <span className="text-red-400">*</span></label>
                  <input className={inp} placeholder="Minnesota" value={newRow.state} onChange={e => setNewRow(r => ({ ...r, state: e.target.value }))} />
                </div>
              </>
            )}
            <div>
              <label className={lbl}>Sub-services</label>
              <input className={inp} placeholder="Spray Foam, Blown-In" value={newRow.subServices} onChange={e => setNewRow(r => ({ ...r, subServices: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>Website URL</label>
              <input className={inp} placeholder="https://example.com" value={newRow.websiteUrl} onChange={e => setNewRow(r => ({ ...r, websiteUrl: e.target.value }))} />
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            <button onClick={() => setShowAdd(false)}
              className="text-xs px-3 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button onClick={addRow}
              disabled={!newRow.companyName || !newRow.service || (newRow.pageType === 'service-location' && (!newRow.city || !newRow.state))}
              className="text-xs px-4 h-8 rounded-lg bg-zinc-900 text-white font-medium hover:bg-zinc-700 disabled:opacity-40 transition-colors">
              Add row
            </button>
          </div>
        </div>
      )}

      {/* ── Rows table ── */}
      {rows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

          {/* Progress bar */}
          {isRunning && (
            <div className="px-4 pt-4 pb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-600">{doneCount + errorCount} / {rows.length} complete</span>
                <span className="text-xs text-gray-400">{progress}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-zinc-900 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Summary after done */}
          {!isRunning && rows.length > 0 && (doneCount > 0 || errorCount > 0) && pendingCount === 0 && (
            <div className="px-4 pt-3 pb-2 flex items-center gap-3">
              {doneCount > 0 && <span className="text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-full">✓ {doneCount} sent to Drive</span>}
              {errorCount > 0 && <span className="text-xs text-red-500 bg-red-50 px-2.5 py-1 rounded-full">✗ {errorCount} failed</span>}
            </div>
          )}

          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2.5 font-medium text-gray-400 w-6">#</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-400">Company</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-400">Service</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-400">City</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-400">State</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-400">Type</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-400 w-20">Status</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 text-gray-300">{i + 1}</td>
                  <td className="px-3 py-2.5 text-gray-700 font-medium">{row.companyName}</td>
                  <td className="px-3 py-2.5 text-gray-600">{row.service}</td>
                  <td className="px-3 py-2.5 text-gray-500">{row.city || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-500">{row.state || '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-gray-500 ${row.pageType === 'service-only' ? 'bg-purple-50' : 'bg-blue-50'}`}>
                      {row.pageType === 'service-only' ? 'Svc only' : 'Svc+Loc'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5" title={row.errorMsg}>
                      {statusIcon(row.status)}
                      {row.status === 'error' && row.errorMsg && (
                        <span className="text-red-400 truncate max-w-[140px]">{row.errorMsg}</span>
                      )}
                      {row.status === 'generating' && (
                        <span className="text-blue-400 text-xs">Generating…</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {row.docUrl && (
                        <a href={row.docUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors font-medium">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                          View
                        </a>
                      )}
{!isRunning && (
                        <button onClick={() => deleteRow(row.id)} className="text-gray-300 hover:text-red-400 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Footer actions */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-400">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
            <div className="flex gap-2">
              {!isRunning && (
                <button onClick={() => setRows([])}
                  className="text-xs px-3 h-8 rounded-lg border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors">
                  Clear all
                </button>
              )}
              {isRunning ? (
                <button onClick={() => { abortRef.current = true; setIsRunning(false) }}
                  className="text-xs px-4 h-8 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition-colors flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                  Stop
                </button>
              ) : (
                <button onClick={runAll}
                  disabled={rows.length === 0 || !folderId}
                  className="text-xs px-4 h-8 rounded-lg bg-zinc-900 text-white font-medium hover:bg-zinc-700 disabled:opacity-40 transition-colors flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                  Generate All ({rows.length})
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {rows.length === 0 && !showAdd && (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 py-16 flex flex-col items-center gap-3 text-center">
          <svg className="w-8 h-8 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          <div>
            <p className="text-sm font-medium text-gray-400">No rows yet</p>
            <p className="text-xs text-gray-300 mt-0.5">Upload a CSV or add rows manually</p>
          </div>
          <div className="flex gap-2 mt-1">
            <button onClick={downloadCsvTemplate}
              className="text-xs px-3 h-7 rounded-md border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors">
              Download template
            </button>
            <button onClick={() => setShowAdd(true)}
              className="text-xs px-3 h-7 rounded-md bg-zinc-900 text-white hover:bg-zinc-700 transition-colors">
              + Add row
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
    </div>
  )
}
