'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import Papa from 'papaparse'

// ── Types ──────────────────────────────────────────────────────────────────────

type Client = {
  master_client_id: number          // from master_clients (always present)
  legacy_client_id: number | null   // from clients table (null if name never matched)
  client_name:      string
  client_slug:      string | null
  link_count:       number
}

type InternalLink = {
  id:               number
  client_id:        number
  url:              string
  meta_title:       string | null
  meta_description: string | null
  status:           'active' | 'inactive'
  created_at:       string
}

const PAGE_SIZE = 50

const inp = 'w-full h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white placeholder-gray-300'

// ── Page ───────────────────────────────────────────────────────────────────────

export default function InternalLinksPage() {
  const [clients,        setClients]        = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [links,          setLinks]          = useState<InternalLink[]>([])
  const [totalCount,     setTotalCount]     = useState(0)
  const [page,           setPage]           = useState(0)
  const [search,         setSearch]         = useState('')
  const [loadingLinks,   setLoadingLinks]   = useState(false)
  const [selected,       setSelected]       = useState<Set<number>>(new Set())

  // Add form
  const [showAdd,    setShowAdd]    = useState(false)
  const [addUrl,     setAddUrl]     = useState('')
  const [addTitle,   setAddTitle]   = useState('')
  const [addDesc,    setAddDesc]    = useState('')
  const [addBusy,    setAddBusy]    = useState(false)
  const [addError,   setAddError]   = useState('')

  // Client search
  const [clientSearch, setClientSearch] = useState('')

  // Scrape modal
  const [showScrape,      setShowScrape]      = useState(false)
  const [scrapeUrl,       setScrapeUrl]       = useState('')
  const [scraping,        setScraping]        = useState(false)
  const [scrapeResults,   setScrapeResults]   = useState<Array<{ url: string; meta_title: string; meta_description: string }>>([])
  const [scrapeSelected,  setScrapeSelected]  = useState<Set<number>>(new Set())
  const [scrapeError,     setScrapeError]     = useState('')
  const [scrapeSource,    setScrapeSource]    = useState('')
  const [importingScraped, setImportingScraped] = useState(false)
  const [importScrapeMsg,  setImportScrapeMsg]  = useState('')

  // Delete all
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [deletingAll,      setDeletingAll]      = useState(false)

  // CSV
  const csvRef      = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')

  // ── Load clients ─────────────────────────────────────────────────────────────
  // Uses v_internal_links_clients — one query, correct counts, all master clients

  const loadClients = useCallback(async () => {
    const { data } = await supabase
      .from('v_internal_links_clients')
      .select('master_client_id, client_name, legacy_client_id, client_slug, link_count')
    if (data) setClients(data as Client[])
  }, [])

  useEffect(() => { loadClients() }, [loadClients])

  // ── Load links ──────────────────────────────────────────────────────────────

  const loadLinks = useCallback(async (legacyId: number, pg: number, q: string) => {
    setLoadingLinks(true)
    setSelected(new Set())
    let query = supabase
      .from('internal_links')
      .select('*', { count: 'exact' })
      .eq('client_id', legacyId)
      .order('created_at', { ascending: false })
      .range(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE - 1)

    if (q.trim()) {
      query = query.ilike('url', `%${q.trim()}%`)
    }

    const { data, count } = await query
    if (data) setLinks(data as InternalLink[])
    if (count !== null) setTotalCount(count)
    setLoadingLinks(false)
  }, [])

  useEffect(() => {
    if (!selectedClient?.legacy_client_id) return
    loadLinks(selectedClient.legacy_client_id, page, search)
  }, [selectedClient, page, search, loadLinks])

  // ── Select client ───────────────────────────────────────────────────────────

  function selectClient(c: Client) {
    setSelectedClient(c)
    setPage(0)
    setSearch('')
    setLinks([])
    setTotalCount(0)
    setShowAdd(false)
    if (c.legacy_client_id) loadLinks(c.legacy_client_id, 0, '')
  }

  // ── Ensure legacy clients entry exists (auto-create if needed) ───────────────

  async function ensureLegacyClient(c: Client): Promise<number | null> {
    if (c.legacy_client_id) return c.legacy_client_id

    // Maybe the clients row exists but didn't join (slight name mismatch) — check first
    const { data: existing } = await supabase
      .from('clients')
      .select('id, client_slug')
      .ilike('client_name', c.client_name)
      .maybeSingle()

    if (existing) {
      const newLegacyId = existing.id
      setSelectedClient(prev => prev ? { ...prev, legacy_client_id: newLegacyId, client_slug: existing.client_slug } : prev)
      setClients(cs => cs.map(x =>
        x.master_client_id === c.master_client_id
          ? { ...x, legacy_client_id: newLegacyId, client_slug: existing.client_slug }
          : x
      ))
      return newLegacyId
    }

    // Truly not found — create it
    const slug = c.client_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const { data, error } = await supabase
      .from('clients')
      .insert({ client_name: c.client_name, client_slug: slug, status: 'active' })
      .select('id')
      .single()
    if (error || !data) return null
    const newLegacyId = data.id
    setSelectedClient(prev => prev ? { ...prev, legacy_client_id: newLegacyId, client_slug: slug } : prev)
    setClients(cs => cs.map(x =>
      x.master_client_id === c.master_client_id
        ? { ...x, legacy_client_id: newLegacyId, client_slug: slug }
        : x
    ))
    return newLegacyId
  }

  // ── Add single link ─────────────────────────────────────────────────────────

  async function addLink() {
    if (!selectedClient || !addUrl.trim()) return
    setAddBusy(true)
    setAddError('')

    const legacyId = await ensureLegacyClient(selectedClient)
    if (!legacyId) { setAddError('Could not create client entry. Try again.'); setAddBusy(false); return }

    const { error } = await supabase.from('internal_links').insert({
      client_id:        legacyId,
      url:              addUrl.trim(),
      meta_title:       addTitle.trim() || null,
      meta_description: addDesc.trim()  || null,
      status:           'active',
    })
    if (error) {
      setAddError(error.message)
    } else {
      setAddUrl(''); setAddTitle(''); setAddDesc('')
      setShowAdd(false)
      loadLinks(legacyId, page, search)
      setClients(cs => cs.map(c =>
        c.master_client_id === selectedClient.master_client_id ? { ...c, link_count: c.link_count + 1 } : c
      ))
      setSelectedClient(c => c ? { ...c, link_count: c.link_count + 1 } : c)
    }
    setAddBusy(false)
  }

  // ── CSV import ──────────────────────────────────────────────────────────────

  function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file || !selectedClient) return
    setImporting(true)
    setImportMsg('')
    const client = selectedClient
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const legacyId = await ensureLegacyClient(client)
        if (!legacyId) {
          setImportMsg('Could not create client entry. Try again.')
          setImporting(false)
          return
        }

        const rows = (result.data as any[]).map(row => {
          const r: Record<string, string> = {}
          for (const k of Object.keys(row)) {
            r[k.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, '_')] =
              (row[k] ?? '').toString().trim()
          }
          return {
            client_id:        legacyId,
            url:              r['url']              || '',
            meta_title:       r['meta_title']       || r['title'] || null,
            meta_description: r['meta_description'] || r['description'] || null,
            status:           'active' as const,
          }
        }).filter(r => r.url)

        if (rows.length === 0) {
          setImportMsg('No valid rows found. Make sure the CSV has a "url" column.')
          setImporting(false)
          return
        }

        // Insert in batches of 500
        let inserted = 0
        for (let i = 0; i < rows.length; i += 500) {
          const batch = rows.slice(i, i + 500)
          const { error } = await supabase.from('internal_links').insert(batch)
          if (!error) inserted += batch.length
        }

        setImportMsg(`✓ Imported ${inserted} of ${rows.length} links`)
        loadLinks(legacyId, 0, search)
        setPage(0)
        setClients(cs => cs.map(c =>
          c.master_client_id === client.master_client_id ? { ...c, link_count: c.link_count + inserted } : c
        ))
        setSelectedClient(c => c ? { ...c, link_count: c.link_count + inserted } : c)
        setImporting(false)
      },
    })
    e.target.value = ''
  }

  // ── CSV export ──────────────────────────────────────────────────────────────

  function exportCsv() {
    if (!selectedClient) return
    const csv = Papa.unparse(links.map(l => ({
      url:              l.url,
      meta_title:       l.meta_title       || '',
      meta_description: l.meta_description || '',
      status:           l.status,
    })))
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${selectedClient.client_slug ?? selectedClient.client_name.toLowerCase().replace(/\s+/g, '-')}-links.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Download CSV template ───────────────────────────────────────────────────

  function downloadTemplate() {
    const csv = [
      'url,meta_title,meta_description',
      'https://example.com/page,Example Page Title,A short description of the page (optional)',
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = 'internal-links-template.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── Scrape website ──────────────────────────────────────────────────────────

  async function openScrapeModal() {
    setScrapeResults([])
    setScrapeSelected(new Set())
    setScrapeError('')
    setScrapeSource('')
    setImportScrapeMsg('')
    setScraping(false)
    setShowScrape(true)
    // Pre-fill website URL from master_clients
    if (selectedClient?.master_client_id) {
      const { data } = await supabase
        .from('master_clients')
        .select('website_url')
        .eq('id', selectedClient.master_client_id)
        .single()
      if (data?.website_url) setScrapeUrl(data.website_url)
      else setScrapeUrl('')
    }
  }

  async function runScrape() {
    if (!scrapeUrl.trim()) return
    setScraping(true)
    setScrapeError('')
    setScrapeResults([])
    setScrapeSource('')
    setImportScrapeMsg('')
    try {
      const res  = await fetch('/api/scrape-pages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: scrapeUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Scrape failed')
      setScrapeResults(data.results)
      setScrapeSource(data.source)
      // Select all by default
      setScrapeSelected(new Set(data.results.map((_: any, i: number) => i)))
    } catch (err: any) {
      setScrapeError(err.message)
    }
    setScraping(false)
  }

  async function importScrapedResults() {
    if (!selectedClient || scrapeSelected.size === 0) return
    setImportingScraped(true)
    setImportScrapeMsg('')
    const legacyId = await ensureLegacyClient(selectedClient)
    if (!legacyId) { setImportScrapeMsg('Error: could not get client ID.'); setImportingScraped(false); return }

    const rows = scrapeResults
      .filter((_, i) => scrapeSelected.has(i))
      .map(r => ({
        client_id:        legacyId,
        url:              r.url,
        meta_title:       r.meta_title       || null,
        meta_description: r.meta_description || null,
        status:           'active' as const,
      }))

    let inserted = 0
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('internal_links').insert(rows.slice(i, i + 500))
      if (!error) inserted += Math.min(500, rows.length - i)
    }

    setImportScrapeMsg(`✓ Imported ${inserted} links`)
    loadLinks(legacyId, 0, search)
    setPage(0)
    setClients(cs => cs.map(c =>
      c.master_client_id === selectedClient.master_client_id ? { ...c, link_count: c.link_count + inserted } : c
    ))
    setSelectedClient(c => c ? { ...c, link_count: c.link_count + inserted } : c)
    setImportingScraped(false)
  }

  // ── Delete single ───────────────────────────────────────────────────────────

  async function deleteLink(id: number) {
    await supabase.from('internal_links').delete().eq('id', id)
    setLinks(ls => ls.filter(l => l.id !== id))
    setTotalCount(n => n - 1)
    setClients(cs => cs.map(c =>
      c.master_client_id === selectedClient?.master_client_id ? { ...c, link_count: c.link_count - 1 } : c
    ))
    setSelectedClient(c => c ? { ...c, link_count: c.link_count - 1 } : c)
  }

  // ── Bulk delete ─────────────────────────────────────────────────────────────

  async function deleteSelected() {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    await supabase.from('internal_links').delete().in('id', ids)
    setLinks(ls => ls.filter(l => !selected.has(l.id)))
    setTotalCount(n => n - selected.size)
    setClients(cs => cs.map(c =>
      c.master_client_id === selectedClient?.master_client_id ? { ...c, link_count: c.link_count - selected.size } : c
    ))
    setSelectedClient(c => c ? { ...c, link_count: c.link_count - selected.size } : c)
    setSelected(new Set())
  }

  // ── Delete all links for selected client ────────────────────────────────────

  async function deleteAll() {
    if (!selectedClient) return
    setDeletingAll(true)
    await supabase
      .from('internal_links')
      .delete()
      .eq('client_id', selectedClient.legacy_client_id)
    setLinks([])
    setTotalCount(0)
    setSelected(new Set())
    setClients(cs => cs.map(c =>
      c.master_client_id === selectedClient.master_client_id ? { ...c, link_count: 0 } : c
    ))
    setSelectedClient(c => c ? { ...c, link_count: 0 } : c)
    setConfirmDeleteAll(false)
    setDeletingAll(false)
  }

  // ── Toggle select row ───────────────────────────────────────────────────────

  function toggleSelect(id: number) {
    setSelected(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleAll() {
    if (selected.size === links.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(links.map(l => l.id)))
    }
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Sidebar: client list ── */}
      <div className="w-56 shrink-0 border-r border-gray-100 bg-white flex flex-col overflow-hidden">
        <div className="px-3 pt-4 pb-2 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Clients</span>
          <div className="relative mt-2">
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-300 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search clients…"
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              className="w-full h-7 pl-6 pr-2 text-xs border border-gray-200 rounded-md bg-white outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
            />
            {clientSearch && (
              <button
                onClick={() => setClientSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Client list */}
        <div className="flex-1 overflow-y-auto py-1">
          {clients.filter(c =>
            c.client_name.toLowerCase().includes(clientSearch.toLowerCase())
          ).map(c => (
            <button
              key={c.master_client_id}
              onClick={() => selectClient(c)}
              className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-1 ${
                selectedClient?.master_client_id === c.master_client_id
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="truncate">{c.client_name}</span>
              <span className={`shrink-0 text-xs ${selectedClient?.master_client_id === c.master_client_id ? 'text-indigo-400' : 'text-gray-300'}`}>
                {c.link_count.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {!selectedClient ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <p className="text-xs text-gray-400">← Select a client to view their internal links</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-5 pt-5 pb-3 border-b border-gray-100 bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-base font-semibold text-gray-800 tracking-tight">{selectedClient.client_name}</h1>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {totalCount.toLocaleString()} link{totalCount !== 1 ? 's' : ''} total
                  </p>
                </div>
                <div className="flex items-center gap-2">

                  {/* Bulk delete */}
                  {selected.size > 0 && (
                    <button
                      onClick={deleteSelected}
                      className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors font-medium"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete {selected.size} selected
                    </button>
                  )}

                  {/* Delete all */}
                  <button
                    onClick={() => setConfirmDeleteAll(true)}
                    className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-red-200 text-red-500 hover:bg-red-50 transition-colors bg-white"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete all
                  </button>

                  {/* Export */}
                  <button onClick={exportCsv}
                    className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors bg-white">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Export CSV
                  </button>

                  {/* Download template */}
                  <button
                    onClick={downloadTemplate}
                    title="Download CSV template"
                    className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors bg-white"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Template
                  </button>

                  {/* Import */}
                  <label className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors bg-white cursor-pointer">
                    {importing ? (
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    )}
                    {importing ? 'Importing…' : 'Import CSV'}
                    <input type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
                  </label>

                  {/* Scrape website */}
                  <button
                    onClick={openScrapeModal}
                    className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors bg-white font-medium"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    Scrape website
                  </button>

                  {/* Add link */}
                  <button
                    onClick={() => { setShowAdd(v => !v); setAddError('') }}
                    className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md bg-zinc-900 text-white hover:bg-zinc-700 transition-colors font-medium"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add link
                  </button>
                </div>
              </div>

              {/* Import result message */}
              {importMsg && (
                <p className={`mt-2 text-xs px-3 py-1.5 rounded-md ${importMsg.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {importMsg}
                </p>
              )}

              {/* Add link form */}
              {showAdd && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="col-span-3 sm:col-span-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">URL <span className="text-red-400">*</span></label>
                      <input className={inp} placeholder="https://example.com/page" value={addUrl} onChange={e => setAddUrl(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Meta title <span className="text-gray-300 font-normal">(optional)</span></label>
                      <input className={inp} placeholder="Page title" value={addTitle} onChange={e => setAddTitle(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Meta description <span className="text-gray-300 font-normal">(optional)</span></label>
                      <input className={inp} placeholder="Page description" value={addDesc} onChange={e => setAddDesc(e.target.value)} />
                    </div>
                  </div>
                  {addError && <p className="mt-1.5 text-xs text-red-500">{addError}</p>}
                  <div className="flex justify-end gap-2 mt-2.5">
                    <button onClick={() => { setShowAdd(false); setAddError('') }}
                      className="text-xs px-3 h-7 rounded border border-gray-200 text-gray-500 hover:bg-gray-100">
                      Cancel
                    </button>
                    <button
                      onClick={addLink}
                      disabled={!addUrl.trim() || addBusy}
                      className="text-xs px-3 h-7 rounded bg-zinc-900 text-white disabled:opacity-40 hover:bg-zinc-700 font-medium"
                    >
                      {addBusy ? 'Adding…' : 'Add link'}
                    </button>
                  </div>
                </div>
              )}

              {/* Search */}
              <div className="mt-3 flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    className="w-full h-8 border border-gray-200 rounded-md pl-8 pr-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white"
                    placeholder="Search URLs…"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(0) }}
                  />
                </div>
                <span className="text-xs text-gray-400">
                  {totalCount.toLocaleString()} result{totalCount !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {loadingLinks ? (
                <div className="py-16 text-center text-xs text-gray-400">Loading…</div>
              ) : links.length === 0 ? (
                <div className="py-16 text-center text-xs text-gray-400">
                  {search ? 'No links match your search.' : 'No links yet. Add one or import a CSV.'}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-gray-100 bg-gray-50/90">
                      <th className="px-4 py-2.5 w-8">
                        <input
                          type="checkbox"
                          checked={selected.size === links.length && links.length > 0}
                          onChange={toggleAll}
                          className="rounded"
                        />
                      </th>
                      <th className="text-left px-4 py-2.5 text-gray-400 font-medium">URL</th>
                      <th className="text-left px-4 py-2.5 text-gray-400 font-medium w-52">Meta Title</th>
                      <th className="text-left px-4 py-2.5 text-gray-400 font-medium w-64">Meta Description</th>
                      <th className="text-left px-4 py-2.5 text-gray-400 font-medium w-16">Status</th>
                      <th className="px-4 py-2.5 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.map((link, i) => (
                      <tr
                        key={link.id}
                        className={`border-b border-gray-50 transition-colors ${
                          selected.has(link.id) ? 'bg-indigo-50/60' : i % 2 === 1 ? 'bg-gray-50/40 hover:bg-gray-50' : 'hover:bg-gray-50/60'
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={selected.has(link.id)}
                            onChange={() => toggleSelect(link.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:underline truncate block max-w-xs"
                          >
                            {link.url}
                          </a>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 truncate max-w-[200px]">
                          {link.meta_title || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-400 truncate max-w-[250px]">
                          {link.meta_description || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex px-1.5 py-0.5 rounded-full text-xs font-medium ${
                            link.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'
                          }`}>
                            {link.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => deleteLink(link.id)}
                            className="text-gray-200 hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-5 py-3 border-t border-gray-100 bg-white flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  Page {page + 1} of {totalPages} · {totalCount.toLocaleString()} links
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(0)}
                    disabled={page === 0}
                    className="text-xs px-2 h-7 rounded border border-gray-200 text-gray-500 disabled:opacity-30 hover:bg-gray-50"
                  >«</button>
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="text-xs px-2 h-7 rounded border border-gray-200 text-gray-500 disabled:opacity-30 hover:bg-gray-50"
                  >‹</button>
                  <span className="text-xs px-3 h-7 rounded bg-gray-900 text-white flex items-center">{page + 1}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="text-xs px-2 h-7 rounded border border-gray-200 text-gray-500 disabled:opacity-30 hover:bg-gray-50"
                  >›</button>
                  <button
                    onClick={() => setPage(totalPages - 1)}
                    disabled={page >= totalPages - 1}
                    className="text-xs px-2 h-7 rounded border border-gray-200 text-gray-500 disabled:opacity-30 hover:bg-gray-50"
                  >»</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Scrape website modal ── */}
      {showScrape && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl flex flex-col w-full max-w-3xl mx-4" style={{ maxHeight: '85vh' }}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Scrape Website Pages</h2>
                <p className="text-xs text-gray-400 mt-0.5">Fetches up to 500 pages from the sitemap. May take 1–2 minutes.</p>
              </div>
              <button onClick={() => setShowScrape(false)} className="text-gray-300 hover:text-gray-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* URL input */}
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <input
                className="flex-1 h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-indigo-400 placeholder-gray-300"
                placeholder="https://example.com"
                value={scrapeUrl}
                onChange={e => setScrapeUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runScrape()}
                disabled={scraping}
              />
              <button
                onClick={runScrape}
                disabled={scraping || !scrapeUrl.trim()}
                className="flex items-center gap-1.5 text-xs px-4 h-8 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 font-medium shrink-0"
              >
                {scraping ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Scraping…
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    Scrape
                  </>
                )}
              </button>
            </div>

            {/* Loading state */}
            {scraping && (
              <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3">
                <svg className="w-8 h-8 text-indigo-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <p className="text-xs text-gray-400">Fetching pages… this may take 1–2 minutes</p>
              </div>
            )}

            {/* Error */}
            {scrapeError && !scraping && (
              <div className="px-5 py-4">
                <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-md">{scrapeError}</p>
              </div>
            )}

            {/* Results */}
            {!scraping && scrapeResults.length > 0 && (
              <>
                {/* Results toolbar */}
                <div className="px-5 py-2.5 border-b border-gray-100 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                      Found <span className="font-medium text-gray-700">{scrapeResults.length}</span> pages via{' '}
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${scrapeSource === 'sitemap' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                        {scrapeSource}
                      </span>
                    </span>
                    <button
                      onClick={() =>
                        scrapeSelected.size === scrapeResults.length
                          ? setScrapeSelected(new Set())
                          : setScrapeSelected(new Set(scrapeResults.map((_, i) => i)))
                      }
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      {scrapeSelected.size === scrapeResults.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {importScrapeMsg && (
                      <span className={`text-xs px-2 py-1 rounded ${importScrapeMsg.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {importScrapeMsg}
                      </span>
                    )}
                    <button
                      onClick={importScrapedResults}
                      disabled={scrapeSelected.size === 0 || importingScraped}
                      className="flex items-center gap-1.5 text-xs px-3 h-7 rounded-md bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 font-medium"
                    >
                      {importingScraped ? 'Importing…' : `Import ${scrapeSelected.size} selected`}
                    </button>
                  </div>
                </div>

                {/* Results table */}
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="border-b border-gray-100 bg-gray-50/90">
                        <th className="px-4 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={scrapeSelected.size === scrapeResults.length}
                            onChange={() =>
                              scrapeSelected.size === scrapeResults.length
                                ? setScrapeSelected(new Set())
                                : setScrapeSelected(new Set(scrapeResults.map((_, i) => i)))
                            }
                            className="rounded"
                          />
                        </th>
                        <th className="text-left px-4 py-2 text-gray-400 font-medium">URL</th>
                        <th className="text-left px-4 py-2 text-gray-400 font-medium w-48">Meta Title</th>
                        <th className="text-left px-4 py-2 text-gray-400 font-medium w-56">Meta Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scrapeResults.map((r, i) => (
                        <tr
                          key={i}
                          onClick={() => setScrapeSelected(s => {
                            const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n
                          })}
                          className={`border-b border-gray-50 cursor-pointer transition-colors ${scrapeSelected.has(i) ? 'bg-indigo-50/60' : 'hover:bg-gray-50/60'}`}
                        >
                          <td className="px-4 py-2">
                            <input type="checkbox" checked={scrapeSelected.has(i)} onChange={() => {}} className="rounded pointer-events-none" />
                          </td>
                          <td className="px-4 py-2 text-indigo-600 max-w-[200px] truncate">{r.url}</td>
                          <td className="px-4 py-2 text-gray-600 max-w-[180px] truncate">{r.meta_title || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2 text-gray-400 max-w-[220px] truncate">{r.meta_description || <span className="text-gray-300">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Empty state after scrape */}
            {!scraping && !scrapeError && scrapeResults.length === 0 && scrapeSource && (
              <div className="flex-1 flex items-center justify-center py-16">
                <p className="text-xs text-gray-400">No pages found. Check the URL and try again.</p>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── Delete-all confirmation modal ── */}
      {confirmDeleteAll && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-sm font-semibold text-gray-800 mb-1">Delete all links?</h2>
            <p className="text-xs text-gray-500 mb-5">
              This will permanently delete all{' '}
              <span className="font-medium text-gray-700">{selectedClient.link_count.toLocaleString()} URLs</span>{' '}
              for <span className="font-medium text-gray-700">{selectedClient.client_name}</span>. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteAll(false)}
                disabled={deletingAll}
                className="text-xs px-4 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={deleteAll}
                disabled={deletingAll}
                className="text-xs px-4 h-8 rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 font-medium flex items-center gap-1.5"
              >
                {deletingAll && (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {deletingAll ? 'Deleting…' : 'Yes, delete all'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
