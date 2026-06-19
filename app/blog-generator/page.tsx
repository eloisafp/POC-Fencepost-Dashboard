'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import Papa from 'papaparse'

// ── Types ──────────────────────────────────────────────────────────────────────

type BlogStatus = 'pending' | 'generating' | 'done' | 'error'

type BlogPost = {
  id:          number
  client_name: string
  keyword:     string
  blog_title:  string
  blog_month:  string | null
  status:      BlogStatus
  gdoc_url:    string | null
  error_msg:   string | null
  created_at:  string
}

type MasterClient = { client_name: string; website_url: string }

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  pending:    { bg: 'bg-gray-100', text: 'text-gray-500',  label: 'Pending'    },
  generating: { bg: 'bg-amber-50', text: 'text-amber-600', label: 'Generating' },
  done:       { bg: 'bg-green-50', text: 'text-green-700', label: 'Done'       },
  error:      { bg: 'bg-red-50',   text: 'text-red-600',   label: 'Error'      },
}

const inp = 'w-full h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white placeholder-gray-300'

// ── Helpers ────────────────────────────────────────────────────────────────────

function currentMonth(): string {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

async function fetchGdocText(url: string): Promise<string> {
  if (!url) return ''
  try {
    const res = await fetch('/api/fetch-gdoc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (!res.ok) return ''
    const { text } = await res.json()
    return text || ''
  } catch { return '' }
}

function toEditUrl(url: string): string {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (match) return `https://docs.google.com/document/d/${match[1]}/edit?usp=sharing`
  return url
}

// ── Client dropdown ────────────────────────────────────────────────────────────

function ClientDropdown({ clients, value, onChange }: {
  clients: MasterClient[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ]       = useState(value)
  const ref             = useRef<HTMLDivElement>(null)

  useEffect(() => { setQ(value) }, [value])

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
        placeholder="Client name"
        value={q}
        onChange={e => { setQ(e.target.value); onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)', marginTop: 4,
          maxHeight: 200, overflowY: 'auto',
        }}>
          {filtered.map(c => (
            <button
              key={c.client_name}
              onMouseDown={e => {
                e.preventDefault()
                setQ(c.client_name)
                onChange(c.client_name)
                setOpen(false)
              }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 12px', fontSize: 12, color: '#334155',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              {c.client_name}
              {c.website_url && (
                <span style={{ color: '#94a3b8', marginLeft: 8, fontSize: 11 }}>{c.website_url}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function BlogGeneratorPage() {
  const [posts,         setPosts]         = useState<BlogPost[]>([])
  const [clients,       setClients]       = useState<MasterClient[]>([])
  const [loading,       setLoading]       = useState(true)
  const [filterClient,  setFilterClient]  = useState('')
  const [filterStatus,  setFilterStatus]  = useState<BlogStatus | ''>('')
  const [generating,    setGenerating]    = useState<Set<number>>(new Set())
  const [generatingAll, setGeneratingAll] = useState(false)
  const [editingId,     setEditingId]     = useState<number | null>(null)
  const [editVals,      setEditVals]      = useState({ keyword: '', blog_title: '', blog_month: '' })
  const [copied,        setCopied]        = useState<number | null>(null)

  const [selectedIds,   setSelectedIds]   = useState<Set<number>>(new Set())

  const stopRef        = useRef(false)
  const csvRef         = useRef<HTMLInputElement>(null)
  const generatingRef  = useRef<Set<number>>(new Set())

  // No-links confirmation modal
  const [noLinksModal, setNoLinksModal] = useState<{
    show: boolean
    post: BlogPost | null
    isBulk: boolean
    missingClients: string[]
  }>({ show: false, post: null, isBulk: false, missingClients: [] })

  // Add row form
  const [showAdd,   setShowAdd]   = useState(false)
  const [addClient, setAddClient] = useState('')
  const [addKw,     setAddKw]     = useState('')
  const [addTitle,  setAddTitle]  = useState('')
  const [addMonth,  setAddMonth]  = useState(currentMonth)
  const [addBusy,   setAddBusy]   = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadPosts = useCallback(async () => {
    const { data } = await supabase
      .from('blog_posts')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) setPosts(data as BlogPost[])
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase
      .from('master_clients')
      .select('client_name, website_url')
      .order('client_name')
      .then(({ data }) => { if (data) setClients(data as MasterClient[]) })
    loadPosts()
  }, [loadPosts])

  // ── Add single row ────────────────────────────────────────────────────────

  async function addRow() {
    if (!addClient || !addKw || !addTitle) return
    setAddBusy(true)
    const { error } = await supabase.from('blog_posts').insert({
      client_name: addClient,
      keyword:     addKw,
      blog_title:  addTitle,
      blog_month:  addMonth || null,
      status:      'pending',
    })
    if (!error) {
      setAddClient(''); setAddKw(''); setAddTitle(''); setAddMonth(currentMonth())
      setShowAdd(false)
      loadPosts()
    }
    setAddBusy(false)
  }

  // ── CSV import ────────────────────────────────────────────────────────────

  function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const rows = (result.data as any[])
          .map(row => {
            const r: Record<string, string> = {}
            for (const k of Object.keys(row)) {
              r[k.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, '_')] = (row[k] ?? '').toString().trim()
            }
            return {
              client_name: r['company_name'] || r['client_name'] || '',
              keyword:     r['keyword']      || '',
              blog_title:  r['blog_title']   || r['title']       || '',
              blog_month:  r['blog_month']   || r['month']       || currentMonth(),
              status:      'pending' as BlogStatus,
            }
          })
          .filter(r => r.client_name && r.keyword)
        if (rows.length > 0) {
          await supabase.from('blog_posts').insert(rows)
          loadPosts()
        }
      },
    })
    e.target.value = ''
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  function exportCsv() {
    const csv = Papa.unparse(
      filteredPosts.map(p => ({
        company_name: p.client_name,
        keyword:      p.keyword,
        blog_title:   p.blog_title,
        blog_month:   p.blog_month || '',
        status:       p.status,
        gdoc_url:     p.gdoc_url  || '',
      }))
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `blog-queue-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Generate one post ─────────────────────────────────────────────────────

  async function generatePost(post: BlogPost): Promise<'done' | 'error'> {
    if (generatingRef.current.has(post.id)) return 'done'
    generatingRef.current.add(post.id)
    setGenerating(new Set(generatingRef.current))
    setPosts(ps => ps.map(p => p.id === post.id ? { ...p, status: 'generating' as BlogStatus, error_msg: null } : p))
    await supabase.from('blog_posts').update({ status: 'generating', error_msg: null }).eq('id', post.id)

    try {
      // 1. Client data + folder
      const { data: cd } = await supabase
        .from('master_clients')
        .select('website_url, niche, blog_folder_url, intake_form_link, content_guidelines_url')
        .ilike('client_name', post.client_name)
        .limit(1)
        .single()

      const folderMatch = (cd as any)?.blog_folder_url?.match(/\/folders\/([a-zA-Z0-9_-]+)/)
      if (!folderMatch) throw new Error('No blog folder URL set for this client')
      const folderId = folderMatch[1]

      // 2. Fetch GDoc context + internal links in parallel
      const [intakeFormContent, contentGuidelinesContent, internalLinks] = await Promise.all([
        fetchGdocText((cd as any)?.intake_form_link       || ''),
        fetchGdocText((cd as any)?.content_guidelines_url || ''),
        (async () => {
          const { data: vc } = await supabase
            .from('v_internal_links_clients')
            .select('legacy_client_id')
            .ilike('client_name', post.client_name)
            .limit(1)
            .maybeSingle()
          const legacyId = (vc as any)?.legacy_client_id
          if (!legacyId) return []

          const STOPWORDS = new Set(['the','a','an','and','or','of','in','for','to','with','how','what','why','best','top','your','our','my','is','are','was','were','be','on','at','by','from','that','this','it','do','does','not','can','will','get'])
          const keywords = post.keyword
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length >= 3 && !STOPWORDS.has(w))

          let query = supabase
            .from('internal_links')
            .select('url, meta_title')
            .eq('client_id', legacyId)
            .eq('status', 'active')

          if (keywords.length > 0) {
            const filter = keywords
              .flatMap(w => [`url.ilike.%${w}%`, `meta_title.ilike.%${w}%`])
              .join(',')
            query = query.or(filter)
          }

          const { data: links } = await query.limit(80)
          return (links as Array<{ url: string; meta_title: string | null }>) || []
        })(),
      ])

      // 3. Generate blog HTML
      const genRes = await fetch('/api/generate-blog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: post.client_name,
          websiteUrl:  (cd as any)?.website_url || '',
          niche:       (cd as any)?.niche       || '',
          keyword:     post.keyword,
          blogTitle:   post.blog_title,
          blogMonth:   post.blog_month || '',
          intakeFormContent,
          contentGuidelinesContent,
          internalLinks,
        }),
      })
      if (!genRes.ok) throw new Error('Blog generation failed')
      const { html, error: genErr } = await genRes.json()
      if (genErr) throw new Error(genErr)
      if (!html)  throw new Error('Empty blog content received')

      // 4. Generate DOCX
      const docxRes = await fetch('/api/generate-blog-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html,
          companyName: post.client_name,
          blogTitle:   post.blog_title,
          blogMonth:   post.blog_month || '',
        }),
      })
      if (!docxRes.ok) throw new Error('DOCX creation failed')

      const arrayBuffer = await docxRes.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      const base64 = btoa(binary)

      // 5. Upload to Drive
      const monthYear = post.blog_month || currentMonth()
      const filename  = `${post.client_name} - ${post.keyword} - ${monthYear}.docx`

      const driveRes = await fetch('/api/send-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, folderId, fileBase64: base64, companyName: post.client_name }),
      })
      if (!driveRes.ok) throw new Error(`Drive upload failed (${driveRes.status})`)

      const rawResponse = await driveRes.text()
      let docUrl: string | undefined
      const trimmed = rawResponse.trim()
      if (trimmed.startsWith('http')) {
        docUrl = toEditUrl(trimmed)
      } else {
        try {
          const json = JSON.parse(trimmed)
          const u = json.docUrl ?? json.webViewLink ?? json.webContentLink ?? json.link ?? json.url
          if (u) docUrl = toEditUrl(u)
        } catch { /* ignore */ }
      }

      // 6. Save to Supabase
      await supabase.from('blog_posts').update({ status: 'done', gdoc_url: docUrl || null, error_msg: null }).eq('id', post.id)
      setPosts(ps => ps.map(p => p.id === post.id ? { ...p, status: 'done', gdoc_url: docUrl || null, error_msg: null } : p))
      return 'done'

    } catch (err: any) {
      const msg = err.message || 'Unknown error'
      await supabase.from('blog_posts').update({ status: 'error', error_msg: msg }).eq('id', post.id)
      setPosts(ps => ps.map(p => p.id === post.id ? { ...p, status: 'error', error_msg: msg } : p))
      return 'error'
    } finally {
      generatingRef.current.delete(post.id)
      setGenerating(new Set(generatingRef.current))
    }
  }

  // ── Generate all pending ──────────────────────────────────────────────────

  async function generateAllPending() {
    stopRef.current = false
    setGeneratingAll(true)
    const runLoop = async () => {
      const pending = posts.filter(p => p.status === 'pending' || p.status === 'error')
      for (let i = 0; i < pending.length; i++) {
        if (stopRef.current) break
        await generatePost(pending[i])
        if (i < pending.length - 1 && !stopRef.current) {
          await new Promise(r => setTimeout(r, 10000 + Math.floor(Math.random() * 5001)))
        }
      }
      setGeneratingAll(false)
      stopRef.current = false
    }
    if ('locks' in navigator) {
      await (navigator as any).locks.request('blog-generate-all', async () => { await runLoop() })
    } else {
      await runLoop()
    }
  }

  // ── Internal link check ───────────────────────────────────────────────────

  async function hasInternalLinks(clientName: string): Promise<boolean> {
    const { data: vc } = await supabase
      .from('v_internal_links_clients')
      .select('link_count')
      .ilike('client_name', clientName)
      .limit(1)
      .maybeSingle()
    return ((vc as any)?.link_count ?? 0) > 0
  }

  // ── Generate single — with no-links check ────────────────────────────────

  async function handleGenerateSingle(post: BlogPost) {
    const hasLinks = await hasInternalLinks(post.client_name)
    if (!hasLinks) {
      setNoLinksModal({ show: true, post, isBulk: false, missingClients: [post.client_name] })
      return
    }
    generatePost(post)
  }

  // ── Generate all — with no-links check ───────────────────────────────────

  async function handleGenerateAll() {
    const pending = filteredPosts.filter(p => p.status === 'pending' || p.status === 'error')
    const uniqueClients = [...new Set(pending.map(p => p.client_name))]
    const checks = await Promise.all(uniqueClients.map(name => hasInternalLinks(name)))
    const missing = uniqueClients.filter((_, i) => !checks[i])
    if (missing.length > 0) {
      setNoLinksModal({ show: true, post: null, isBulk: true, missingClients: missing })
      return
    }
    generateAllPending()
  }

  // ── Inline edit ──────────────────────────────────────────────────────────

  function startEdit(post: BlogPost) {
    setEditingId(post.id)
    setEditVals({ keyword: post.keyword, blog_title: post.blog_title, blog_month: post.blog_month || '' })
  }

  async function saveEdit(id: number) {
    if (editingId !== id) return
    await supabase.from('blog_posts').update({
      keyword:    editVals.keyword,
      blog_title: editVals.blog_title,
      blog_month: editVals.blog_month || null,
    }).eq('id', id)
    setPosts(ps => ps.map(p => p.id === id ? { ...p, ...editVals, blog_month: editVals.blog_month || null } : p))
    setEditingId(null)
  }

  // ── Delete row ────────────────────────────────────────────────────────────

  async function deleteRow(id: number) {
    await supabase.from('blog_posts').delete().eq('id', id)
    setPosts(ps => ps.filter(p => p.id !== id))
    setSelectedIds(s => { const n = new Set(s); n.delete(id); return n })
  }

  async function deleteSelected() {
    const ids = [...selectedIds]
    await supabase.from('blog_posts').delete().in('id', ids)
    setPosts(ps => ps.filter(p => !selectedIds.has(p.id)))
    setSelectedIds(new Set())
  }

  // ── Copy editor link ──────────────────────────────────────────────────────

  function copyEditorLink(id: number, url: string) {
    navigator.clipboard.writeText(toEditUrl(url)).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  // ── Filtered view ─────────────────────────────────────────────────────────

  const filteredPosts = posts.filter(p => {
    if (filterClient && !p.client_name.toLowerCase().includes(filterClient.toLowerCase())) return false
    if (filterStatus && p.status !== filterStatus) return false
    return true
  })

  const pendingCount   = posts.filter(p => p.status === 'pending').length
  const activeCount    = posts.filter(p => p.status === 'generating').length
  const doneCount      = posts.filter(p => p.status === 'done').length
  const canGenerateAll = !generatingAll && filteredPosts.some(p => p.status === 'pending' || p.status === 'error')

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-5">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-base font-semibold text-gray-800 tracking-tight">Blog Generator</h1>
          <p className="text-xs text-gray-400 mt-0.5">Generate SEO blog posts and save directly to client Drive folders</p>
        </div>
        <div className="flex items-center gap-2">

          {/* Live stats */}
          <div className="flex items-center gap-3 text-xs mr-2">
            {pendingCount > 0 && <span className="text-gray-400">{pendingCount} pending</span>}
            {activeCount  > 0 && (
              <span className="text-amber-500 font-medium flex items-center gap-1">
                <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {activeCount} generating
              </span>
            )}
            {doneCount > 0 && <span className="text-green-600">✓ {doneCount} done</span>}
          </div>

          {/* Export CSV */}
          <button onClick={exportCsv}
            className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors bg-white">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>

          {/* Import CSV */}
          <label className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors bg-white cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import CSV
            <input type="file" accept=".csv" className="hidden" ref={csvRef} onChange={handleCsvImport} />
          </label>

          {/* Add row */}
          <button onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md bg-zinc-900 text-white hover:bg-zinc-700 transition-colors font-medium">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add row
          </button>
        </div>
      </div>

      {/* Add row form */}
      {showAdd && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <div className="grid grid-cols-4 gap-2.5 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Company name <span className="text-red-400">*</span></label>
              <ClientDropdown clients={clients} value={addClient} onChange={setAddClient} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Keyword <span className="text-red-400">*</span></label>
              <input className={inp} placeholder="hvac maintenance tips" value={addKw} onChange={e => setAddKw(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Blog title <span className="text-red-400">*</span></label>
              <input className={inp} placeholder="5 HVAC Tips for Homeowners" value={addTitle} onChange={e => setAddTitle(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Blog month</label>
              <input className={inp} value={addMonth} onChange={e => setAddMonth(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
            <button
              onClick={() => { setShowAdd(false); setAddClient(''); setAddKw(''); setAddTitle(''); setAddMonth(currentMonth()) }}
              className="text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={addRow}
              disabled={!addClient || !addKw || !addTitle || addBusy}
              className="text-xs px-3 h-8 rounded-md bg-zinc-900 text-white disabled:opacity-40 hover:bg-zinc-700 transition-colors font-medium">
              {addBusy ? 'Adding…' : 'Add row'}
            </button>
          </div>
        </div>
      )}

      {/* CSV hint */}
      <div className="mb-3 text-xs text-gray-400">
        CSV columns: <span className="font-mono text-gray-500">company_name, keyword, blog_title, blog_month</span>
      </div>

      {/* Filters + generate all */}
      <div className="flex items-center gap-2 mb-3">
        <input
          className="h-8 border border-gray-200 rounded-md px-2.5 text-xs text-gray-700 outline-none focus:ring-1 focus:ring-gray-400 bg-white w-44"
          placeholder="Filter by client…"
          value={filterClient}
          onChange={e => setFilterClient(e.target.value)}
        />
        <select
          className="h-8 border border-gray-200 rounded-md px-2 text-xs text-gray-700 outline-none focus:ring-1 focus:ring-gray-400 bg-white"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as BlogStatus | '')}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="generating">Generating</option>
          <option value="done">Done</option>
          <option value="error">Error</option>
        </select>

        <div className="flex-1" />

        {selectedIds.size > 0 && (
          <button
            onClick={deleteSelected}
            className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors font-medium">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete selected ({selectedIds.size})
          </button>
        )}

        {generatingAll && (
          <button
            onClick={() => { stopRef.current = true; setGeneratingAll(false) }}
            className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
            Stop
          </button>
        )}

        {canGenerateAll && (
          <button
            onClick={handleGenerateAll}
            className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate all pending
            {pendingCount > 0 && <span className="ml-0.5 opacity-75">({pendingCount})</span>}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-gray-400">Loading…</div>
        ) : filteredPosts.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="w-8 h-8 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-xs text-gray-400">No blog posts yet.</p>
            <p className="text-xs text-gray-300 mt-0.5">Add a row manually or import a CSV to get started.</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80">
                <th className="px-4 py-2.5 w-8">
                  <input type="checkbox"
                    className="rounded border-gray-300 cursor-pointer"
                    checked={filteredPosts.length > 0 && filteredPosts.every(p => selectedIds.has(p.id))}
                    onChange={e => {
                      if (e.target.checked) setSelectedIds(new Set(filteredPosts.map(p => p.id)))
                      else setSelectedIds(new Set())
                    }} />
                </th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium w-36">Client</th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium w-40">Keyword</th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Blog Title</th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium w-24">Month</th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium w-24">Status</th>
                <th className="text-left px-4 py-2.5 text-gray-400 font-medium w-52">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPosts.map((post, i) => {
                const s     = STATUS_STYLE[post.status] ?? STATUS_STYLE.pending
                const isGen = generating.has(post.id)
                return (
                  <tr key={post.id}
                    className={`border-b border-gray-50 transition-colors hover:bg-blue-50/20 ${i % 2 === 1 ? 'bg-gray-50/40' : ''} ${selectedIds.has(post.id) ? 'bg-red-50/30' : ''}`}>

                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <input type="checkbox"
                        className="rounded border-gray-300 cursor-pointer"
                        checked={selectedIds.has(post.id)}
                        onChange={e => setSelectedIds(s => {
                          const n = new Set(s)
                          e.target.checked ? n.add(post.id) : n.delete(post.id)
                          return n
                        })} />
                    </td>

                    {/* Client */}
                    <td className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">{post.client_name}</td>

                    {/* Keyword */}
                    <td className="px-4 py-3 text-gray-500">
                      {editingId === post.id ? (
                        <input className={inp} value={editVals.keyword}
                          onChange={e => setEditVals(v => ({ ...v, keyword: e.target.value }))}
                          onBlur={e => { if (!e.currentTarget.closest('tr')?.contains(e.relatedTarget as Node)) saveEdit(post.id) }}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(post.id); if (e.key === 'Escape') setEditingId(null) }}
                          autoFocus />
                      ) : (
                        <span className="cursor-text hover:bg-gray-100 rounded px-1 -mx-1 py-0.5"
                          onClick={() => startEdit(post)}>{post.keyword}</span>
                      )}
                    </td>

                    {/* Title */}
                    <td className="px-4 py-3 text-gray-700">
                      {editingId === post.id ? (
                        <input className={inp} value={editVals.blog_title}
                          onChange={e => setEditVals(v => ({ ...v, blog_title: e.target.value }))}
                          onBlur={e => { if (!e.currentTarget.closest('tr')?.contains(e.relatedTarget as Node)) saveEdit(post.id) }}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(post.id); if (e.key === 'Escape') setEditingId(null) }} />
                      ) : post.gdoc_url ? (
                        <a href={toEditUrl(post.gdoc_url!)} target="_blank" rel="noopener noreferrer"
                          className="hover:text-indigo-600 hover:underline transition-colors inline-flex items-center gap-1">
                          {post.blog_title}
                          <svg className="w-3 h-3 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      ) : (
                        <span className="cursor-text hover:bg-gray-100 rounded px-1 -mx-1 py-0.5"
                          onClick={() => startEdit(post)}>{post.blog_title}</span>
                      )}
                      {post.error_msg && (
                        <p className="text-red-400 mt-0.5 truncate max-w-xs">{post.error_msg}</p>
                      )}
                    </td>

                    {/* Month */}
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {editingId === post.id ? (
                        <input className={inp} value={editVals.blog_month} placeholder="June 2026"
                          onChange={e => setEditVals(v => ({ ...v, blog_month: e.target.value }))}
                          onBlur={e => { if (!e.currentTarget.closest('tr')?.contains(e.relatedTarget as Node)) saveEdit(post.id) }}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(post.id); if (e.key === 'Escape') setEditingId(null) }} />
                      ) : (
                        <span className="cursor-text hover:bg-gray-100 rounded px-1 -mx-1 py-0.5"
                          onClick={() => startEdit(post)}>{post.blog_month || '—'}</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
                        {post.status === 'generating' && (
                          <svg className="w-2.5 h-2.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        )}
                        {s.label}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-nowrap">

                        {/* Generate */}
                        {(post.status === 'pending' || post.status === 'error') && (
                          <button
                            onClick={() => handleGenerateSingle(post)}
                            disabled={isGen}
                            className="text-xs px-2.5 h-6 rounded-md bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 transition-colors font-medium whitespace-nowrap">
                            {isGen
                              ? <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                              : 'Generate'}
                          </button>
                        )}

                        {/* View doc */}
                        {post.gdoc_url && (
                          <a href={toEditUrl(post.gdoc_url!)} target="_blank" rel="noopener noreferrer"
                            className="text-xs px-2.5 h-6 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1 whitespace-nowrap">
                            <svg className="w-3 h-3 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 4h5v5a2 2 0 002 2h5v9H6V4z"/>
                            </svg>
                            View
                          </a>
                        )}

                        {/* Copy editor link */}
                        {post.gdoc_url && (
                          <button
                            onClick={() => copyEditorLink(post.id, post.gdoc_url!)}
                            title="Copy editor link"
                            className="text-xs px-2.5 h-6 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1 whitespace-nowrap">
                            {copied === post.id
                              ? <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                              : <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                            }
                            {copied === post.id ? 'Copied!' : 'Copy link'}
                          </button>
                        )}

                        {/* Delete */}
                        <button
                          onClick={() => deleteRow(post.id)}
                          title="Delete"
                          className="text-gray-300 hover:text-red-400 transition-colors p-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>

                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── No internal links confirmation modal ── */}
      {noLinksModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">

            <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>

            <h2 className="text-sm font-semibold text-gray-800 mb-1">No internal links found</h2>

            {noLinksModal.isBulk ? (
              <p className="text-xs text-gray-500 mb-2">
                The following client{noLinksModal.missingClients.length > 1 ? 's have' : ' has'} no internal links set up:
              </p>
            ) : (
              <p className="text-xs text-gray-500 mb-2">
                <span className="font-medium text-gray-700">{noLinksModal.missingClients[0]}</span> has no internal links set up yet.
              </p>
            )}

            {noLinksModal.isBulk && (
              <ul className="mb-3 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 space-y-0.5 max-h-32 overflow-y-auto">
                {noLinksModal.missingClients.map(name => (
                  <li key={name} className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />
                    {name}
                  </li>
                ))}
              </ul>
            )}

            <p className="text-xs text-gray-400 mb-5">
              Without internal links, the blog won&apos;t include links to the client&apos;s site pages. You can add them in <span className="font-medium text-gray-500">Internal Links</span> first, or continue generating now.
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setNoLinksModal({ show: false, post: null, isBulk: false, missingClients: [] })}
                className="text-xs px-4 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { post, isBulk } = noLinksModal
                  setNoLinksModal({ show: false, post: null, isBulk: false, missingClients: [] })
                  if (isBulk) generateAllPending()
                  else if (post) generatePost(post)
                }}
                className="text-xs px-4 h-8 rounded-md bg-zinc-900 text-white hover:bg-zinc-700 transition-colors font-medium"
              >
                Continue anyway
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}
