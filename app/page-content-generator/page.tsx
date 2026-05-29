'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

declare const google: any
import { generateClientHTML } from './clientHtml'
import TemplateManager from './TemplateEditor'
import BulkGenerator from './BulkGenerator'
import { loadTemplates, type PageTemplate } from './templateStore'
import { parseBlocks, postProcessBlocks, parseOutput, type Block, type SEOMeta } from './pageParser'

// ── Client selector ────────────────────────────────────────────────────────────

type MasterClient = { id: number; client_name: string; website_url: string }

function ClientSelector({ value, onChange, onSelect }: {
  value: string
  onChange: (val: string) => void
  onSelect: (client: MasterClient) => void
}) {
  const [clients, setClients]   = useState<MasterClient[]>([])
  const [open, setOpen]         = useState(false)
  const [query, setQuery]       = useState(value)
  const wrapRef                 = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.from('master_clients').select('id, client_name, website_url').order('client_name')
      .then(({ data }: { data: MasterClient[] | null }) => { if (data) setClients(data) })
  }, [])

  useEffect(() => { setQuery(value) }, [value])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = query.trim()
    ? clients.filter(c => c.client_name.toLowerCase().includes(query.toLowerCase()))
    : clients

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className="w-full h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white placeholder-gray-300"
        placeholder="Northland Companies"
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)', marginTop: 4,
          maxHeight: 220, overflowY: 'auto',
        }}>
          {filtered.map(c => (
            <button
              key={c.id}
              onMouseDown={e => {
                e.preventDefault()
                setQuery(c.client_name)
                onChange(c.client_name)
                onSelect(c)
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

type PageType = 'service-location' | 'service-only'
type Form = {
  companyName: string; service: string; city: string; state: string
  subServices: string; websiteUrl: string; pageType: PageType
}

const emptyForm: Form = { companyName: '', service: '', city: '', state: '', subServices: '', websiteUrl: '', pageType: 'service-location' }

// ── Export helpers ─────────────────────────────────────────────────────────────

function blocksToHtml(blocks: Block[]): string {
  return blocks.map(b => {
    switch (b.type) {
      case 'h1':        return `<h1>${b.text}</h1>`
      case 'h2':        return `<h2>${b.text}</h2>`
      case 'h3':        return `<h3>${b.text}</h3>`
      case 'paragraph': return `<p>${b.text}</p>`
      case 'list':      return `<ul>${b.items.map(item => `<li>${item}</li>`).join('')}</ul>`
      case 'cta':       return `<p><strong>[${b.text}]</strong></p>`
      case 'image':     return b.caption.trim().startsWith('<') ? `<div style="margin:8px 0;border-radius:12px;overflow:hidden">${b.caption}</div>` : `<div class="img-placeholder"><span>📷 ${b.caption}</span></div>`
      case 'step':      return `<div class="step"><div class="step-num">${b.number}</div><div><strong>${b.title}</strong><p>${b.body}</p></div></div>`
      case 'faq':       return `<div class="faq"><p class="faq-q">${b.question}</p><p class="faq-a">${b.answer}</p></div>`
      case 'twocol': {
        const lw = b.leftWidth ?? 45
        return `<table style="width:100%;border-collapse:collapse;margin:20px 0"><tbody><tr>` +
          `<td style="width:${lw}%;vertical-align:top;padding-right:20px;border:1px solid white">${blocksToHtml(b.left)}</td>` +
          `<td style="width:${100 - lw}%;vertical-align:top;border:1px solid white">${blocksToHtml(b.right)}</td>` +
          `</tr></tbody></table>`
      }
      default:          return ''
    }
  }).join('\n')
}

function generatePrintHTML(seo: SEOMeta, blocks: Block[], form: Form): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Page Review — ${seo.titleTag || form.service + ' in ' + form.city}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Segoe UI',Inter,sans-serif;color:#1e293b;background:#fff}
.review-bar{background:#f8fafc;border-bottom:2px solid #e2e8f0;padding:18px 48px;margin-bottom:0}
.review-bar h2{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:10px}
.meta-grid{display:grid;grid-template-columns:1fr 2fr 1fr;gap:20px}
.meta-item{padding:10px 14px;background:#fff;border:1px solid #e2e8f0;border-radius:6px}
.meta-item label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;display:block;margin-bottom:3px}
.meta-item p{font-size:12px;color:#334155;line-height:1.5}
.content{max-width:720px;margin:0 auto;padding:48px 48px 80px}
h1{font-size:26px;font-weight:700;line-height:1.25;margin-bottom:20px}
h2{font-size:18px;font-weight:600;margin-top:36px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #e2e8f0}
h3{font-size:13px;font-weight:600;margin-top:16px;margin-bottom:5px}
p{font-size:13.5px;line-height:1.8;margin-bottom:12px;color:#475569}
ul{margin:6px 0 16px;padding-left:0}
li{display:flex;align-items:flex-start;gap:8px;margin-bottom:7px;font-size:13.5px;line-height:1.7;color:#475569}
li::before{content:"•";color:#3b82f6;font-weight:700;flex-shrink:0;margin-top:2px}
.cta p{margin:14px 0}
.cta p strong{display:inline-block;background:#18181b;color:#fff;font-size:12.5px;font-weight:500;padding:9px 20px;border-radius:6px;letter-spacing:-.01em}
.img-placeholder{background:#f1f5f9;border:2px dashed #cbd5e1;border-radius:10px;padding:36px 20px;text-align:center;margin:20px 0;color:#94a3b8;font-size:13px}
.step{display:flex;gap:14px;background:#f8fafc;border:1px solid #f1f5f9;border-radius:10px;padding:14px 16px;margin-bottom:10px}
.step-num{width:30px;height:30px;border-radius:50%;background:#18181b;color:#fff;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1}
.step strong{font-size:13.5px;color:#1e293b;display:block;margin-bottom:4px}
.step p{font-size:13px;color:#64748b;line-height:1.7;margin:0}
.faq{border-top:1px solid #f1f5f9;padding:16px 0}
.faq-q{font-size:13.5px;font-weight:600;color:#1e293b;margin-bottom:6px}
.faq-a{font-size:13px;color:#64748b;line-height:1.75;margin:0}
@media print{
  .review-bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body>
<div class="review-bar">
  <h2>Page for Client Review — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</h2>
  <div class="meta-grid">
    <div class="meta-item"><label>Title Tag</label><p>${seo.titleTag || '—'}</p></div>
    <div class="meta-item"><label>Meta Description</label><p>${seo.metaDescription || '—'}</p></div>
    <div class="meta-item"><label>URL Slug</label><p>${seo.urlSlug || '—'}</p></div>
  </div>
</div>
<div class="content">${blocksToHtml(blocks)}</div>
</body>
</html>`
}

function generateDocsHTML(blocks: Block[]): string {
  return `<html><body style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto">${blocks.map(b => {
    switch (b.type) {
      case 'h1': return `<h1 style="font-size:26px;font-weight:700;color:#0f172a">${b.text}</h1>`
      case 'h2': return `<h2 style="font-size:18px;font-weight:600;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-top:32px">${b.text}</h2>`
      case 'h3': return `<h3 style="font-size:14px;font-weight:600;color:#334155;margin-top:14px">${b.text}</h3>`
      case 'paragraph': return `<p style="font-size:14px;line-height:1.8;color:#475569">${b.text}</p>`
      case 'list': return `<ul>${b.items.map(item => `<li style="font-size:14px;line-height:1.7;color:#475569;margin-bottom:6px">${item}</li>`).join('')}</ul>`
      case 'cta': return `<p><strong>[${b.text}]</strong></p>`
      case 'image': return b.caption.trim().startsWith('<') ? `<div style="margin:8px 0;border-radius:8px;overflow:hidden">${b.caption}</div>` : `<p style="color:#94a3b8;font-style:italic;border:2px dashed #cbd5e1;padding:14px 20px;border-radius:8px;font-size:13px">📷 ${b.caption}</p>`
      case 'step': return `<div style="margin-bottom:10px;padding:12px 16px;background:#f8fafc;border-radius:8px"><strong style="font-size:14px">Step ${b.number}: ${b.title}</strong><p style="font-size:13px;color:#64748b;margin:4px 0 0;line-height:1.7">${b.body}</p></div>`
      case 'faq': return `<div style="border-top:1px solid #f1f5f9;padding:14px 0"><p style="font-size:14px;font-weight:600;color:#1e293b;margin-bottom:6px">${b.question}</p><p style="font-size:14px;color:#64748b;line-height:1.75;margin:0">${b.answer}</p></div>`
      case 'twocol': {
        const lw = b.leftWidth ?? 45
        const docsHtml = (bls: Block[]) => bls.map(inner => {
          if (inner.type === 'h2') return `<h2 style="font-size:18px;font-weight:600;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-top:0">${inner.text}</h2>`
          if (inner.type === 'paragraph') return `<p style="font-size:14px;line-height:1.8;color:#475569">${inner.text}</p>`
          if (inner.type === 'image') return `<p style="color:#94a3b8;font-style:italic;border:2px dashed #cbd5e1;padding:14px;border-radius:8px;font-size:13px">📷 ${inner.caption}</p>`
          return ''
        }).join('')
        return `<table style="width:100%;border-collapse:collapse;margin:20px 0"><tbody><tr>` +
          `<td style="width:${lw}%;vertical-align:top;padding-right:20px;border:1px solid white">${docsHtml(b.left)}</td>` +
          `<td style="width:${100 - lw}%;vertical-align:top;border:1px solid white">${docsHtml(b.right)}</td>` +
          `</tr></tbody></table>`
      }
      default: return ''
    }
  }).join('\n')}</body></html>`
}

// ── Image edit helpers ────────────────────────────────────────────────────────

function applyImageEdits(bls: Block[], edits: Record<string, string>): Block[] {
  return bls.map(b => {
    if (b.type === 'image' && edits[b.caption] !== undefined) return { ...b, caption: edits[b.caption] }
    if (b.type === 'twocol') return { ...b, left: applyImageEdits(b.left, edits), right: applyImageEdits(b.right, edits) }
    return b
  })
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return (
    <button onClick={copy} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors px-2.5 py-1.5 rounded-md border border-gray-200 hover:border-gray-300 bg-white">
      {copied
        ? <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        : <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      }
      {label ?? (copied ? 'Copied!' : 'Copy')}
    </button>
  )
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse px-12 py-10">
      <div className="h-7 bg-gray-100 rounded-md w-2/3 mb-5" />
      <div className="h-36 bg-gray-100 rounded-lg mb-6" />
      <div className="h-4 bg-gray-100 rounded w-1/2 mb-3" />
      <div className="space-y-2 mb-5">
        {[100, 95, 88, 92, 78].map((w, i) => <div key={i} className="h-3 bg-gray-100 rounded" style={{ width: `${w}%` }} />)}
      </div>
      <div className="h-4 bg-gray-100 rounded w-2/5 mb-3" />
      <div className="space-y-2">
        {[100, 82, 91, 70].map((w, i) => <div key={i} className="h-3 bg-gray-100 rounded" style={{ width: `${w}%` }} />)}
      </div>
    </div>
  )
}

function PagePreview({ blocks, isGenerating, city, state, imageEdits, onImageEdit }: {
  blocks: Block[]; isGenerating: boolean; city: string; state: string
  imageEdits: Record<string, string>; onImageEdit: (original: string, edited: string) => void
}) {
  const mapUrl = city && state
    ? `https://maps.google.com/maps?q=${encodeURIComponent(city + ' ' + state)}&output=embed`
    : ''
  const [editingKey, setEditingKey]   = useState<string | null>(null)
  const [editDraft,  setEditDraft]    = useState('')

  function startEdit(original: string) {
    setEditingKey(original)
    setEditDraft(imageEdits[original] ?? original)
  }
  function commitEdit() {
    if (editingKey !== null) { onImageEdit(editingKey, editDraft); setEditingKey(null) }
  }

  function renderBlock(block: Block, key: number): React.ReactNode {
    switch (block.type) {
      case 'h1':
        return <h1 key={key} style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', lineHeight: 1.25, margin: '0 0 18px' }}>{block.text}</h1>
      case 'h2':
        return <h2 key={key} style={{ fontSize: 19, fontWeight: 650, color: '#1e293b', lineHeight: 1.35, margin: '40px 0 14px', paddingBottom: 10, borderBottom: '2px solid #e2e8f0' }}>{block.text}</h2>
      case 'h3':
        return <h3 key={key} style={{ fontSize: 14, fontWeight: 600, color: '#334155', margin: '18px 0 6px' }}>{block.text}</h3>
      case 'paragraph':
        return <p key={key} style={{ fontSize: 14, color: '#475569', lineHeight: 1.8, margin: '0 0 12px' }}>{block.text}</p>
      case 'list':
        return (
          <ul key={key} style={{ margin: '8px 0 16px', padding: 0 }}>
            {block.items.map((item, j) => (
              <li key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8, fontSize: 14, color: '#475569', lineHeight: 1.7 }}>
                <span style={{ color: '#3b82f6', fontWeight: 700, flexShrink: 0, marginTop: 2 }}>•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )
      case 'cta':
        return (
          <div key={key} style={{ margin: '18px 0' }}>
            <span style={{ display: 'inline-block', background: '#18181b', color: '#fff', fontSize: 13, fontWeight: 500, padding: '10px 22px', borderRadius: 7, letterSpacing: '-0.01em', cursor: 'default' }}>
              {block.text}
            </span>
          </div>
        )
      case 'image': {
        const caption = imageEdits[block.caption] ?? block.caption
        // If the caption is raw HTML (embed code), render it live
        if (caption.trim().startsWith('<')) {
          return (
            <div key={key} style={{ margin: '8px 0', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
              <div dangerouslySetInnerHTML={{ __html: caption }} />
              <button
                onClick={() => startEdit(block.caption)}
                title="Edit embed code"
                style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(255,255,255,0.9)', border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', color: '#6366f1', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit
              </button>
            </div>
          )
        }
        const isMap = /map|google|location|embed/i.test(block.caption)
        if (isMap && mapUrl) {
          return (
            <div key={key} style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0', margin: '8px 0' }}>
              <iframe src={mapUrl} width="100%" height="340" style={{ border: 0, display: 'block' }} loading="lazy" allowFullScreen title="Location map" />
            </div>
          )
        }
        const isEditing = editingKey === block.caption
        return (
          <div key={key} style={{ background: '#f8fafc', border: `2px dashed ${isEditing ? '#6366f1' : '#cbd5e1'}`, borderRadius: 12, padding: '24px', margin: '8px 0', textAlign: 'center', position: 'relative' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ display: 'inline-block', marginBottom: 8 }}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            {isEditing ? (
              <div style={{ marginTop: 4 }}>
                <textarea
                  autoFocus
                  rows={4}
                  value={editDraft}
                  onChange={e => setEditDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key === 'Escape') setEditingKey(null) }}
                  placeholder="Type a caption, or paste an <iframe> embed code…"
                  style={{ width: '100%', fontSize: 12, color: '#334155', border: '1px solid #6366f1', borderRadius: 6, padding: '8px 10px', outline: 'none', background: '#fff', textAlign: 'left', resize: 'vertical', fontFamily: 'monospace' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: '#a5b4fc' }}>Click outside or press Esc to cancel</span>
                  <button onMouseDown={e => { e.preventDefault(); commitEdit() }} style={{ fontSize: 11, background: '#6366f1', color: '#fff', border: 'none', borderRadius: 5, padding: '2px 10px', cursor: 'pointer' }}>Save</button>
                </div>
              </div>
            ) : (
              <div>
                {caption.trim().startsWith('<')
                  ? <span style={{ fontSize: 11, color: '#6366f1', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                      HTML embed saved
                    </span>
                  : <p style={{ fontSize: 12, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>{caption}</p>
                }
                {imageEdits[block.caption] !== undefined && (
                  <span style={{ fontSize: 10, color: '#6366f1', marginTop: 4, display: 'inline-block' }}>✏ edited</span>
                )}
              </div>
            )}
            {!isEditing && (
              <button
                onClick={() => startEdit(block.caption)}
                title="Edit image caption"
                style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', color: '#94a3b8', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit
              </button>
            )}
          </div>
        )
      }
      case 'step':
        return (
          <div key={key} style={{ display: 'flex', gap: 14, background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: '14px 16px', marginBottom: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#18181b', color: '#fff', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {block.number}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 5 }}>{block.title}</div>
              <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.75, margin: 0 }}>{block.body}</p>
            </div>
          </div>
        )
      case 'faq':
        return (
          <div key={key} style={{ borderTop: '1px solid #f1f5f9', padding: '16px 0' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: '0 0 8px' }}>{block.question}</p>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.75, margin: 0 }}>{block.answer}</p>
          </div>
        )
      case 'twocol': {
        const lw = block.leftWidth ?? 45
        return (
          <table key={key} style={{ width: '100%', borderCollapse: 'collapse', margin: '20px 0' }}>
            <tbody>
              <tr>
                <td style={{ width: `${lw}%`, verticalAlign: 'top', paddingRight: 24, border: '1px solid white' }}>
                  {block.left.map((b, j) => renderBlock(b, j))}
                </td>
                <td style={{ width: `${100 - lw}%`, verticalAlign: 'top', border: '1px solid white' }}>
                  {block.right.map((b, j) => renderBlock(b, j))}
                </td>
              </tr>
            </tbody>
          </table>
        )
      }
      default: return null
    }
  }

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {blocks.map((block, i) => renderBlock(block, i))}
      {isGenerating && (
        <span style={{ display: 'inline-block', width: 6, height: 14, background: '#94a3b8', borderRadius: 2, verticalAlign: 'middle', animation: 'blink 1s step-end infinite' }} />
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PageGenerator() {
  const [view, setView]       = useState<'generator' | 'templates' | 'bulk'>('generator')
  const [templates, setTemplates] = useState<PageTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')

  const [form, setForm]       = useState<Form>(emptyForm)
  const [status, setStatus]   = useState<'idle' | 'generating' | 'done' | 'error'>('idle')
  const [seo, setSeo]         = useState<SEOMeta>({ titleTag: '', metaDescription: '', urlSlug: '' })
  const [content, setContent] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [tab, setTab]         = useState<'preview' | 'seo' | 'raw'>('preview')
  const [docsCopied, setDocsCopied]     = useState(false)
  const [imageEdits, setImageEdits]     = useState<Record<string, string>>({})
  const [driveStatus, setDriveStatus]     = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [driveModal, setDriveModal]       = useState(false)
  const [driveFolderId, setDriveFolderId] = useState('')
  const [driveFolderName, setDriveFolderName] = useState('')
  const [driveFilename, setDriveFilename] = useState('')
  const tokenClientRef    = useRef<any>(null)
  const accessTokenRef    = useRef<string>('')
  const pickerCallbackRef = useRef<((id: string, name: string) => void) | null>(null)

  useEffect(() => { setTemplates(loadTemplates()) }, [view])

  // ── Google Picker ────────────────────────────────────────────────────────────
  useEffect(() => {
    const gapiScript = document.createElement('script')
    gapiScript.src = 'https://apis.google.com/js/api.js'
    gapiScript.onload = () => {
      (window as any).gapi.load('picker', () => {})
    }
    document.body.appendChild(gapiScript)

    const gisScript = document.createElement('script')
    gisScript.src = 'https://accounts.google.com/gsi/client'
    gisScript.onload = () => {
      tokenClientRef.current = google.accounts.oauth2.initTokenClient({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (resp: any) => {
          if (resp.access_token) {
            accessTokenRef.current = resp.access_token
            showPicker(resp.access_token)
          }
        },
      })
    }
    document.body.appendChild(gisScript)
  }, [])

  function showPicker(token: string) {
    const picker = new google.picker.PickerBuilder()
      .addView(
        new google.picker.DocsView()
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true)
          .setMimeTypes('application/vnd.google-apps.folder')
      )
      .setOAuthToken(token)
      .setDeveloperKey(process.env.NEXT_PUBLIC_GOOGLE_API_KEY!)
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const folder = data.docs[0]
          if (pickerCallbackRef.current) pickerCallbackRef.current(folder.id, folder.name)
        }
      })
      .build()
    picker.setVisible(true)
  }

  function openDrivePicker(onSelect: (id: string, name: string) => void) {
    pickerCallbackRef.current = onSelect
    if (!tokenClientRef.current) return
    if (accessTokenRef.current) {
      showPicker(accessTokenRef.current)
    } else {
      tokenClientRef.current.requestAccessToken({ prompt: 'consent' })
    }
  }

  const inp = 'w-full h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white placeholder-gray-300'
  const lbl = 'block text-xs font-medium text-gray-500 mb-1'

  const isGenerating = status === 'generating'
  const hasOutput    = status === 'generating' || status === 'done'
  const blocks       = postProcessBlocks(parseBlocks(content))

  function setField(key: keyof Form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value }))
  }

  async function generate() {
    const needsLocation = form.pageType === 'service-location'
    if (!form.companyName || !form.service) return
    if (needsLocation && (!form.city || !form.state)) return
    setStatus('generating')
    setContent('')
    setSeo({ titleTag: '', metaDescription: '', urlSlug: '' })
    setErrorMsg('')
    setTab('preview')
    setImageEdits({})

    try {
      const selectedTemplate = templates.find(t => t.id === selectedTemplateId)
      const res = await fetch('/api/generate-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          templateSections: selectedTemplate?.sections,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }))
        throw new Error(err.error || 'Generation failed')
      }
      if (!res.body) throw new Error('No response body')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        const parsed = parseOutput(accumulated)
        setSeo(parsed.seo)
        setContent(parsed.content)
      }
      setStatus('done')
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err.message || 'Something went wrong')
    }
  }

  function sendToClient() {
    const editedBlocks = applyImageEdits(blocks, imageEdits)
    const html = generateClientHTML(seo, editedBlocks, form)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    const slug = (seo.urlSlug || `${form.service}-${form.city}`).replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase()
    a.href     = url
    a.download = `${slug}-review.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportPDF() {
    const editedBlocks = applyImageEdits(blocks, imageEdits)
    const html = generatePrintHTML(seo, editedBlocks, form)
    const win  = window.open('', '_blank', 'width=960,height=760')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.onload = () => { win.focus(); win.print() }
  }

  function openDriveModal() {
    const slug = (seo.urlSlug || `${form.service}-${form.city || 'page'}`).replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase()
    setDriveFolderId('')
    setDriveFolderName('')
    setDriveFilename(slug)
    setDriveModal(true)
  }

  async function confirmSendToDrive() {
    setDriveModal(false)
    setDriveStatus('sending')
    try {
      const editedBlocks = applyImageEdits(blocks, imageEdits)
      const res = await fetch('/api/generate-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seo, blocks: editedBlocks, form }),
      })
      if (!res.ok) throw new Error('Failed to generate docx')
      const arrayBuffer = await res.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      const base64 = btoa(binary)
      const filename = driveFilename.endsWith('.docx') ? driveFilename : `${driveFilename}.docx`
      const payload = {
        filename,
        folderId:    driveFolderId,
        fileBase64:  base64,
        companyName: form.companyName,
        service:     form.service,
        city:        form.city || '',
        state:       form.state || '',
        pageType:    form.pageType,
        titleTag:    seo.titleTag,
        urlSlug:     seo.urlSlug,
      }
      const driveRes = await fetch('/api/send-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!driveRes.ok) throw new Error(`Drive error: ${driveRes.status}`)
      setDriveStatus('sent')
      setTimeout(() => setDriveStatus('idle'), 3000)
    } catch (err: any) {
      console.error('Send to Drive error:', err)
      setDriveStatus('error')
      setTimeout(() => setDriveStatus('idle'), 3000)
    }
  }

  async function downloadDocx() {
    const editedBlocks = applyImageEdits(blocks, imageEdits)
    const res = await fetch('/api/generate-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seo, blocks: editedBlocks, form }),
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    const slug = (seo.urlSlug || `${form.service}-${form.city || 'page'}`).replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase()
    a.href     = url
    a.download = `${slug}.docx`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function copyForDocs() {
    const editedBlocks = applyImageEdits(blocks, imageEdits)
    const html = generateDocsHTML(editedBlocks)
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) }),
      ])
    } catch {
      await navigator.clipboard.writeText(content)
    }
    setDocsCopied(true)
    setTimeout(() => setDocsCopied(false), 2500)
  }

  const tabs = [
    { key: 'preview', label: 'Page Preview' },
    { key: 'seo',     label: 'SEO Meta'     },
    { key: 'raw',     label: 'Raw Copy'     },
  ] as const

  return (
    <div className="p-5">

      {/* Page header + view tabs */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-base font-semibold text-gray-800 tracking-tight">Page Generator</h1>
          <p className="text-xs text-gray-400 mt-0.5">Generate SEO service and location pages for client review</p>
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          {([
            { key: 'generator', label: 'Generate' },
            { key: 'bulk',      label: 'Bulk'     },
            { key: 'templates', label: 'Templates' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`text-xs px-3.5 py-1.5 rounded-md transition-all ${view === key ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Templates view */}
      {view === 'templates' && <TemplateManager />}

      {/* Bulk view */}
      {view === 'bulk' && <BulkGenerator openDrivePicker={openDrivePicker} />}

      {/* Generator view */}
      {view === 'generator' && <div className={`flex gap-5 items-start ${!hasOutput ? 'max-w-2xl mx-auto' : ''}`}>

        {/* ── Form ── */}
        <div className={hasOutput ? 'w-[268px] shrink-0 sticky top-5' : 'flex-1'}>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            {/* Page type toggle */}
            <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5 mb-3">
              {([
                { value: 'service-location', label: 'Service + Location' },
                { value: 'service-only',     label: 'Service Only'       },
              ] as const).map(pt => (
                <button
                  key={pt.value}
                  onClick={() => setForm(f => ({ ...f, pageType: pt.value }))}
                  className={`flex-1 text-xs px-2.5 py-1.5 rounded-md transition-all ${form.pageType === pt.value ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {pt.label}
                </button>
              ))}
            </div>

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Page details</p>

            <div className="space-y-2.5">
              <div className={hasOutput ? 'space-y-2.5' : 'grid grid-cols-2 gap-2.5'}>
                <div>
                  <label className={lbl}>Company name <span className="text-red-400">*</span></label>
                  <ClientSelector
                    value={form.companyName}
                    onChange={val => setForm(f => ({ ...f, companyName: val }))}
                    onSelect={c => setForm(f => ({ ...f, companyName: c.client_name, websiteUrl: c.website_url || f.websiteUrl }))}
                  />
                </div>
                <div>
                  <label className={lbl}>Service type <span className="text-red-400">*</span></label>
                  <input className={inp} placeholder="Insulation Contractor" value={form.service} onChange={setField('service')} />
                </div>
              </div>

              {form.pageType === 'service-location' && (
                <div className={hasOutput ? 'space-y-2.5' : 'grid grid-cols-2 gap-2.5'}>
                  <div>
                    <label className={lbl}>City <span className="text-red-400">*</span></label>
                    <input className={inp} placeholder="Longville" value={form.city} onChange={setField('city')} />
                  </div>
                  <div>
                    <label className={lbl}>State <span className="text-red-400">*</span></label>
                    <input className={inp} placeholder="Minnesota" value={form.state} onChange={setField('state')} />
                  </div>
                </div>
              )}

              <div>
                <label className={lbl}>Sub-services <span className="text-gray-300 font-normal">(optional)</span></label>
                <input className={inp} placeholder="Spray Foam, Blown-In, Fiberglass" value={form.subServices} onChange={setField('subServices')} />
              </div>
              <div>
                <label className={lbl}>Website URL <span className="text-gray-300 font-normal">(optional)</span></label>
                <input className={inp} placeholder="https://www.example.com" value={form.websiteUrl} onChange={setField('websiteUrl')} />
              </div>
            </div>

            {/* Template selector */}
            <div className="mt-2 pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between mb-1">
                <label className={lbl + ' !mb-0'}>Template</label>
                <button
                  onClick={() => setView('templates')}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {templates.length === 0 ? '+ Create template' : 'Manage'}
                </button>
              </div>
              <select
                className={inp}
                value={selectedTemplateId}
                onChange={e => setSelectedTemplateId(e.target.value)}
              >
                <option value="">Default (built-in)</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {status === 'error' && (
              <p className="mt-3 text-xs text-red-500 bg-red-50 rounded-md px-3 py-2">{errorMsg || 'Generation failed. Check OPENROUTER_API_KEY.'}</p>
            )}

            <button
              onClick={generate}
              disabled={isGenerating || !form.companyName || !form.service || (form.pageType === 'service-location' && (!form.city || !form.state))}
              className="mt-4 w-full bg-zinc-900 text-white text-xs rounded-lg h-9 flex items-center justify-center gap-1.5 hover:bg-zinc-700 disabled:opacity-40 transition-colors font-medium"
            >
              {isGenerating ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {status === 'done' ? 'Regenerate' : 'Generate page'}
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Output ── */}
        {hasOutput && (
          <div className="flex-1 min-w-0">

            {/* Tab strip + export actions */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
                {tabs.map(({ key, label }) => (
                  <button key={key} onClick={() => setTab(key)}
                    className={`text-xs px-3.5 py-1.5 rounded-md transition-all ${tab === key ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Export buttons — visible once done */}
              {status === 'done' && (
                <div className="flex items-center gap-2">
                  <button onClick={openDriveModal} disabled={driveStatus === 'sending'}
                    className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border transition-colors bg-white disabled:opacity-50"
                    style={{ borderColor: driveStatus === 'sent' ? '#86efac' : driveStatus === 'error' ? '#fca5a5' : '#e2e8f0', color: driveStatus === 'sent' ? '#16a34a' : driveStatus === 'error' ? '#dc2626' : '#4b5563' }}>
                    {driveStatus === 'sending' ? (
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    ) : driveStatus === 'sent' ? (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                    ) : driveStatus === 'error' ? (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-green-600" viewBox="0 0 87.3 78" fill="currentColor"><path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L38 48H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="M43.65 25L29.35 0c-1.35.8-2.5 1.9-3.3 3.3L1.2 43.5A9.06 9.06 0 000 48h38z" fill="#00ac47"/><path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 52.5c.8-1.4 1.2-2.95 1.2-4.5H49.3l8.1 15.45z" fill="#ea4335"/><path d="M43.65 25L57.95 0H29.35z" fill="#00832d"/><path d="M80.3 5L57.95 0 43.65 25 49.3 48h37.8c0-1.55-.4-3.1-1.2-4.5z" fill="#2684fc"/><path d="M73.55 76.8L49.3 48l-5.65 22.8 5.65 5.2 24.25-5.65z" fill="#ffba00"/></svg>
                    )}
                    {driveStatus === 'sending' ? 'Sending…' : driveStatus === 'sent' ? 'Sent to Drive!' : driveStatus === 'error' ? 'Failed' : 'Send to Drive'}
                  </button>

                  <button onClick={downloadDocx}
                    className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors bg-white">
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-8.959 17h-2.085l-3.5-9h2.199l2.133 6.144 2.133-6.144h2.199l-3.079 9zm6.959 0h-2v-9h2v9z"/></svg>
                    Download .docx
                  </button>

                  <button onClick={copyForDocs}
                    className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors bg-white">
                    {docsCopied ? (
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    )}
                    {docsCopied ? 'Copied!' : 'Copy (HTML)'}
                  </button>

                  <button onClick={exportPDF}
                    className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors bg-white">
                    <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Export PDF
                  </button>

                  <button onClick={sendToClient}
                    className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors bg-white">
                    <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Send to Client
                  </button>
                </div>
              )}

              {/* Raw tab extra action */}
              {tab === 'raw' && content && status !== 'done' && <CopyBtn text={content} label="Copy all" />}
            </div>

            {/* ── Preview ── */}
            {tab === 'preview' && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-300" />
                    <div className="w-3 h-3 rounded-full bg-amber-300" />
                    <div className="w-3 h-3 rounded-full bg-green-400" />
                  </div>
                  <div className="flex-1 bg-white border border-gray-200 rounded-md px-3 py-1 text-xs text-gray-400 truncate">
                    {form.websiteUrl
                      ? form.websiteUrl.replace(/\/$/, '') + (seo.urlSlug || '')
                      : seo.urlSlug || 'yoursite.com/page-slug'}
                  </div>
                  {status === 'done' && (
                    <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0">
                      <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Ready for review
                    </span>
                  )}
                </div>
                <div className="px-12 py-10 max-w-[780px]">
                  {blocks.length > 0
                    ? <PagePreview blocks={blocks} isGenerating={isGenerating} city={form.city} state={form.state} imageEdits={imageEdits} onImageEdit={(orig, edited) => setImageEdits(e => ({ ...e, [orig]: edited }))} />
                    : <LoadingSkeleton />}
                </div>
              </div>
            )}

            {/* ── SEO Meta ── */}
            {tab === 'seo' && (
              <div className="space-y-3">
                {[
                  { label: 'Title Tag',        sublabel: 'Max 60 characters',    value: seo.titleTag,        warn: seo.titleTag.length > 60 },
                  { label: 'Meta Description', sublabel: '140–160 characters',   value: seo.metaDescription, warn: seo.metaDescription.length > 160 },
                  { label: 'URL Slug',         sublabel: 'Add to CMS URL field', value: seo.urlSlug,         warn: false },
                ].map(f => (
                  <div key={f.label} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <span className="text-xs font-semibold text-gray-700">{f.label}</span>
                        <span className="text-xs text-gray-400 ml-2">{f.sublabel}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {f.value && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${f.warn ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-400'}`}>
                            {f.value.length} chars
                          </span>
                        )}
                        {f.value && <CopyBtn text={f.value} />}
                      </div>
                    </div>
                    <p className="text-sm text-gray-800 leading-relaxed bg-gray-50 rounded-lg px-3 py-2.5 min-h-[36px]">
                      {f.value || <span className="text-gray-300 text-xs">{isGenerating ? 'Generating...' : '—'}</span>}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* ── Raw ── */}
            {tab === 'raw' && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                  <span className="text-xs text-gray-500">Plain text — paste directly into your CMS</span>
                  {content && <CopyBtn text={content} label="Copy all" />}
                </div>
                <textarea
                  readOnly value={content}
                  className="w-full text-xs text-gray-700 font-mono p-4 outline-none resize-none bg-white"
                  style={{ minHeight: '70vh' }}
                />
              </div>
            )}

          </div>
        )}
      </div>}

      {/* ── Send to Drive modal ── */}
      {driveModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDriveModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 87.3 78" fill="currentColor" className="text-green-600">
                  <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L38 48H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                  <path d="M43.65 25L29.35 0c-1.35.8-2.5 1.9-3.3 3.3L1.2 43.5A9.06 9.06 0 000 48h38z" fill="#00ac47"/>
                  <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 52.5c.8-1.4 1.2-2.95 1.2-4.5H49.3l8.1 15.45z" fill="#ea4335"/>
                  <path d="M43.65 25L57.95 0H29.35z" fill="#00832d"/>
                  <path d="M80.3 5L57.95 0 43.65 25 49.3 48h37.8c0-1.55-.4-3.1-1.2-4.5z" fill="#2684fc"/>
                  <path d="M73.55 76.8L49.3 48l-5.65 22.8 5.65 5.2 24.25-5.65z" fill="#ffba00"/>
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Save to Google Drive</h3>
                <p className="text-xs text-gray-400 mt-0.5">File will be converted to Google Docs format</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Save to folder <span className="text-red-400">*</span></label>
                {driveFolderName ? (
                  <div className="flex items-center gap-2 h-8 border border-green-200 bg-green-50 rounded-md px-3">
                    <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                    <span className="text-xs text-green-700 flex-1 truncate">{driveFolderName}</span>
                    <button onClick={() => openDrivePicker((id, name) => { setDriveFolderId(id); setDriveFolderName(name) })} className="text-xs text-green-600 hover:text-green-800 shrink-0">Change</button>
                  </div>
                ) : (
                  <button
                    onClick={() => openDrivePicker((id, name) => { setDriveFolderId(id); setDriveFolderName(name) })}
                    className="w-full h-8 border border-dashed border-gray-300 rounded-md px-3 text-xs text-gray-500 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                    Browse Google Drive
                  </button>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">File name</label>
                <div className="flex items-center gap-1">
                  <input
                    className="flex-1 h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white"
                    placeholder="e.g. insulation-contractor-longville"
                    value={driveFilename}
                    onChange={e => setDriveFilename(e.target.value)}
                  />
                  <span className="text-xs text-gray-400 shrink-0">.docx</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setDriveModal(false)}
                className="flex-1 h-9 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={confirmSendToDrive}
                disabled={!driveFolderId.trim() || !driveFilename.trim()}
                className="flex-1 h-9 rounded-lg bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                </svg>
                Save to Drive
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
    </div>
  )
}
