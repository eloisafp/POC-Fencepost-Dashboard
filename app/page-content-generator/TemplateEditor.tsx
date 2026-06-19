'use client'

import { useState, useEffect, useRef } from 'react'
import {
  PageTemplate, TemplateSection, CellDef, ContentType,
  uid, newBlankTemplate, newSection, newTableSection,
  loadTemplates, saveTemplate, deleteTemplate,
} from './templateStore'

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTENT_TYPES: { value: ContentType; label: string; color: string }[] = [
  { value: 'image',       label: 'Image',           color: '#94a3b8' },
  { value: 'paragraphs',  label: 'Paragraphs',      color: '#3b82f6' },
  { value: 'bullets',     label: 'Bullet List',     color: '#10b981' },
  { value: 'subsections', label: 'Sub-sections',    color: '#8b5cf6' },
  { value: 'steps',       label: 'Steps',           color: '#f59e0b' },
  { value: 'faq',         label: 'FAQ',             color: '#ef4444' },
  { value: 'cta',         label: 'CTA Button',      color: '#06b6d4' },
  { value: 'button',      label: 'Button Only',     color: '#0ea5e9' },
  { value: 'table',       label: 'Two-Col Table',   color: '#d946ef' },
  { value: 'html',        label: 'HTML / Embed',    color: '#f97316' },
]

const CELL_TYPES = CONTENT_TYPES.filter(t => t.value !== 'table' && t.value !== 'button')

function typeColor(ct: ContentType) { return CONTENT_TYPES.find(t => t.value === ct)?.color ?? '#94a3b8' }
function typeLabel(ct: ContentType) { return CONTENT_TYPES.find(t => t.value === ct)?.label ?? ct }

// ── Variable chips ────────────────────────────────────────────────────────────

const VARS = ['{service}', '{city}', '{state}', '{company}']

function VarChips({ inputRef, value, onChange }: {
  inputRef: React.RefObject<HTMLInputElement | null>
  value: string
  onChange: (val: string) => void
}) {
  function insert(v: string) {
    const el = inputRef.current
    const start = el?.selectionStart ?? value.length
    const end   = el?.selectionEnd   ?? value.length
    const next  = value.slice(0, start) + v + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + v.length, start + v.length)
    })
  }
  return (
    <div className="flex gap-1 mt-1 flex-wrap">
      {VARS.map(v => (
        <button key={v} type="button" onClick={() => insert(v)}
          className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 font-mono transition-colors">
          {v}
        </button>
      ))}
    </div>
  )
}

// ── CellEditor (used inside table section rows) ───────────────────────────────

function CellEditor({ label, cell, onUpdate }: {
  label: string
  cell: CellDef
  onUpdate: (c: CellDef) => void
}) {
  const inp = 'w-full h-7 border border-gray-200 rounded-md px-2.5 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white'
  const isHtmlCell = cell.contentType === 'html'
  const headingRef = useRef<HTMLInputElement>(null)
  const showCount = !isHtmlCell && !['image', 'cta'].includes(cell.contentType)
  const showWords = !isHtmlCell && !['image', 'cta', 'bullets'].includes(cell.contentType)
  const countLabel: Record<string, string> = {
    paragraphs: 'Paragraphs', bullets: 'Bullets', subsections: 'Sub-sections',
    steps: 'Steps', faq: 'Q&As', cta: '', image: '',
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
      <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 space-y-2">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Type</label>
          <select className={inp} value={cell.contentType}
            onChange={e => onUpdate({ ...cell, contentType: e.target.value as Exclude<ContentType,'table'> })}>
            {CELL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        {isHtmlCell ? (
          <div>
            <label className="block text-xs text-gray-400 mb-1">HTML / Embed code</label>
            <textarea
              className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-xs text-gray-700 font-mono outline-none focus:ring-1 focus:ring-gray-400 bg-gray-50 resize-y"
              rows={5}
              value={cell.htmlCode ?? ''}
              placeholder={'<iframe src="..." width="100%" height="400"></iframe>'}
              onChange={e => onUpdate({ ...cell, htmlCode: e.target.value })}
            />
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="block text-xs text-gray-400">
                {cell.contentType === 'image' ? 'Caption' : 'Heading'}
              </label>
              {cell.contentType !== 'image' && (
                <label className="flex items-center gap-1.5 ml-auto cursor-pointer">
                  <span className="text-xs text-gray-400">AI varies heading</span>
                  <div className={`relative w-7 h-4 rounded-full transition-colors ${cell.varyHeading ? 'bg-indigo-500' : 'bg-gray-200'}`}
                    onClick={() => onUpdate({ ...cell, varyHeading: !cell.varyHeading })}>
                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${cell.varyHeading ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                  </div>
                </label>
              )}
            </div>
            <input ref={headingRef} className={inp} value={cell.heading}
              placeholder={cell.contentType === 'image' ? 'Image description' : cell.varyHeading ? 'Topic hint for AI' : 'Heading — use {service} {city} etc.'}
              onChange={e => onUpdate({ ...cell, heading: e.target.value })} />
            {cell.contentType !== 'image' && !cell.varyHeading && (
              <VarChips inputRef={headingRef} value={cell.heading}
                onChange={v => onUpdate({ ...cell, heading: v })} />
            )}
          </div>
        )}
        {showCount && (
          <div className={`grid gap-2 ${showWords ? 'grid-cols-2' : ''}`}>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{countLabel[cell.contentType]}</label>
              <input type="number" min={1} max={20} className={inp} value={cell.count}
                onChange={e => onUpdate({ ...cell, count: Math.max(1, parseInt(e.target.value) || 1) })} />
            </div>
            {showWords && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Words each</label>
                <input type="number" min={0} max={500} step={10} className={inp} value={cell.wordsEach}
                  onChange={e => onUpdate({ ...cell, wordsEach: Math.max(0, parseInt(e.target.value) || 0) })} />
              </div>
            )}
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Notes</label>
          <textarea
            className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white resize-none"
            rows={2} value={cell.notes}
            placeholder="Extra guidance for the AI"
            onChange={e => onUpdate({ ...cell, notes: e.target.value })} />
        </div>
      </div>
    </div>
  )
}

// ── SectionRow ────────────────────────────────────────────────────────────────

function SectionRow({
  sec, expanded, dragOver, dragging,
  onToggle, onUpdate, onDuplicate, onDelete,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  sec: TemplateSection
  expanded: boolean
  dragOver: boolean
  dragging: boolean
  onToggle: () => void
  onUpdate: (s: TemplateSection) => void
  onDuplicate: () => void
  onDelete: () => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  const inp = 'w-full h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white'
  const isTable    = sec.contentType === 'table'
  const isHtml     = sec.contentType === 'html'
  const isButton   = sec.contentType === 'button'
  const secHeadingRef = useRef<HTMLInputElement>(null)
  const showCount = !isTable && !isHtml && !isButton && !['image', 'cta'].includes(sec.contentType)
  const showWords = !isTable && !isHtml && !isButton && !['image', 'cta', 'bullets'].includes(sec.contentType)

  const countLabel: Record<string, string> = {
    paragraphs: 'Paragraphs', bullets: 'Bullet points', subsections: 'Sub-sections',
    steps: 'Steps', faq: 'Q&A pairs', cta: '', image: '', button: '',
  }

  const defaultCell = (ct: Exclude<ContentType,'table'>): CellDef =>
    ({ contentType: ct, heading: '', count: 2, wordsEach: 60, notes: '' })

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        opacity: dragging ? 0.4 : 1,
        borderTop: dragOver ? '2px solid #3b82f6' : '2px solid transparent',
      }}
      className="bg-white rounded-lg border border-gray-200 overflow-hidden"
    >
      {/* Header row */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="cursor-grab text-gray-300 hover:text-gray-400 select-none shrink-0 text-base leading-none"
          style={{ letterSpacing: '-0.5px' }}>⠿</span>

        <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ background: typeColor(sec.contentType) + '1a', color: typeColor(sec.contentType) }}>
          {typeLabel(sec.contentType)}
        </span>

        {/* Preview text */}
        {isTable ? (
          <span className="flex-1 text-xs text-gray-500 truncate min-w-0">
            <span style={{ color: typeColor(sec.leftCol?.contentType ?? 'image') }}>
              {typeLabel(sec.leftCol?.contentType ?? 'image')}
            </span>
            <span className="text-gray-300 mx-1">↔</span>
            <span style={{ color: typeColor(sec.rightCol?.contentType ?? 'paragraphs') }}>
              {typeLabel(sec.rightCol?.contentType ?? 'paragraphs')}
            </span>
          </span>
        ) : isHtml ? (
          <span className="flex-1 text-xs text-gray-400 truncate min-w-0 font-mono">
            {sec.htmlCode?.trim()
              ? sec.htmlCode.trim().slice(0, 60) + (sec.htmlCode.trim().length > 60 ? '…' : '')
              : <span className="italic">No code yet</span>}
          </span>
        ) : isButton ? (
          <span className="flex-1 text-xs text-gray-500 truncate min-w-0">
            {sec.ctaButtonText
              ? <span className="font-medium">{sec.ctaButtonText}</span>
              : <span className="text-gray-300 italic">No button text</span>}
          </span>
        ) : (
          <span className="flex-1 text-xs truncate min-w-0 flex items-center gap-1.5">
            {sec.varyHeading && (
              <span className="shrink-0 text-indigo-400 font-medium" title="AI varies heading">✦</span>
            )}
            <span className={sec.varyHeading ? 'text-gray-400 italic' : 'text-gray-700'}>
              {sec.heading || <span className="text-gray-300 italic">No heading</span>}
            </span>
          </span>
        )}

        {showCount && (
          <span className="text-xs text-gray-400 shrink-0 tabular-nums">{sec.count}×</span>
        )}

        <button onClick={onToggle} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0">
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <button onClick={onDuplicate} className="text-gray-300 hover:text-indigo-400 transition-colors shrink-0" title="Duplicate section">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>

        <button onClick={onDelete} className="text-gray-300 hover:text-red-400 transition-colors shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Expanded form — TABLE */}
      {expanded && isTable && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <CellEditor
              label="Left column"
              cell={sec.leftCol ?? defaultCell('image')}
              onUpdate={c => onUpdate({ ...sec, leftCol: c })}
            />
            <CellEditor
              label="Right column"
              cell={sec.rightCol ?? defaultCell('paragraphs')}
              onUpdate={c => onUpdate({ ...sec, rightCol: c })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Left column width <span className="font-normal text-gray-300">(%)</span>
            </label>
            <input
              type="number" min={20} max={80} className="w-24 h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white"
              value={sec.leftWidth ?? 45}
              onChange={e => onUpdate({ ...sec, leftWidth: Math.min(80, Math.max(20, parseInt(e.target.value) || 45)) })}
            />
          </div>
        </div>
      )}

      {/* Expanded form — HTML embed */}
      {expanded && isHtml && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            HTML / Embed code <span className="font-normal text-gray-300">(paste iframe, script, or any raw HTML)</span>
          </label>
          <textarea
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-700 font-mono outline-none focus:ring-1 focus:ring-gray-400 bg-gray-50 resize-y"
            rows={6}
            value={sec.htmlCode ?? ''}
            placeholder={'<iframe src="..." width="100%" height="400"></iframe>'}
            onChange={e => onUpdate({ ...sec, htmlCode: e.target.value })}
          />
        </div>
      )}

      {/* Expanded form — button only */}
      {expanded && isButton && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Content type</label>
            <select className={inp} value={sec.contentType}
              onChange={e => onUpdate({ ...sec, contentType: e.target.value as ContentType })}>
              {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Button text</label>
            <input className={inp} value={sec.ctaButtonText ?? ''}
              placeholder="e.g. Get a Free Quote"
              onChange={e => onUpdate({ ...sec, ctaButtonText: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Button URL <span className="font-normal text-gray-300">(optional)</span>
            </label>
            <input className={inp} value={sec.ctaButtonUrl ?? ''}
              placeholder="e.g. /contact or https://..."
              onChange={e => onUpdate({ ...sec, ctaButtonUrl: e.target.value })} />
          </div>
        </div>
      )}

      {/* Expanded form — non-table, non-html, non-button */}
      {expanded && !isTable && !isHtml && !isButton && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="block text-xs font-medium text-gray-500">
                {sec.contentType === 'image' ? 'Image caption' : sec.contentType === 'cta' ? 'Heading above button' : 'Section heading'}
              </label>
              {sec.contentType !== 'image' && (
                <label className="flex items-center gap-1.5 ml-auto cursor-pointer">
                  <span className="text-xs text-gray-400">AI varies heading</span>
                  <div className={`relative w-7 h-4 rounded-full transition-colors ${sec.varyHeading ? 'bg-indigo-500' : 'bg-gray-200'}`}
                    onClick={() => onUpdate({ ...sec, varyHeading: !sec.varyHeading })}>
                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${sec.varyHeading ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                  </div>
                </label>
              )}
            </div>
            <input ref={secHeadingRef} className={inp}
              value={sec.heading}
              placeholder={sec.contentType === 'image'
                ? 'Description of the image placeholder'
                : sec.varyHeading
                  ? 'Topic hint for AI (e.g. service reliability introduction for city)'
                  : 'H2 heading — use {service} {city} {state} {company}'}
              onChange={e => onUpdate({ ...sec, heading: e.target.value })} />
            {sec.contentType !== 'image' && !sec.varyHeading && (
              <VarChips inputRef={secHeadingRef} value={sec.heading}
                onChange={v => onUpdate({ ...sec, heading: v })} />
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Content type</label>
            <select className={inp} value={sec.contentType}
              onChange={e => onUpdate({ ...sec, contentType: e.target.value as ContentType })}>
              {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {showCount && (
            <div className={`grid gap-3 ${showWords ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{countLabel[sec.contentType]}</label>
                <input type="number" min={1} max={20} className={inp} value={sec.count}
                  onChange={e => onUpdate({ ...sec, count: Math.max(1, parseInt(e.target.value) || 1) })} />
              </div>
              {showWords && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Words each</label>
                  <input type="number" min={0} max={500} step={10} className={inp} value={sec.wordsEach}
                    onChange={e => onUpdate({ ...sec, wordsEach: Math.max(0, parseInt(e.target.value) || 0) })} />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Notes <span className="font-normal text-gray-300">(extra writing guidance for AI)</span>
            </label>
            <textarea
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white resize-none"
              rows={2} value={sec.notes}
              placeholder="Optional: specific topics, tone guidance, local details, etc."
              onChange={e => onUpdate({ ...sec, notes: e.target.value })} />
          </div>

          {sec.contentType === 'cta' && (
            <div className="space-y-2 pt-1 border-t border-gray-100">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Button text</label>
                <input className={inp} value={sec.ctaButtonText ?? ''}
                  placeholder="e.g. Get a Free Quote"
                  onChange={e => onUpdate({ ...sec, ctaButtonText: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Button URL <span className="font-normal text-gray-300">(optional)</span></label>
                <input className={inp} value={sec.ctaButtonUrl ?? ''}
                  placeholder="e.g. /contact or https://..."
                  onChange={e => onUpdate({ ...sec, ctaButtonUrl: e.target.value })} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Template editor ───────────────────────────────────────────────────────────

function Editor({ template, onSave, onBack }: {
  template: PageTemplate
  onSave: (t: PageTemplate) => void
  onBack: () => void
}) {
  const [name,        setName]        = useState(template.name)
  const [sections,    setSections]    = useState<TemplateSection[]>(template.sections)
  const [expandedId,  setExpandedId]  = useState<string | null>(null)
  const [dragIdx,     setDragIdx]     = useState<number | null>(null)
  const [overIdx,     setOverIdx]     = useState<number | null>(null)
  const [saved,       setSaved]       = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  function updateSection(id: string, updated: TemplateSection) {
    setSections(ss => ss.map(s => s.id === id ? updated : s))
  }
  function removeSection(id: string) {
    setSections(ss => ss.filter(s => s.id !== id))
    if (expandedId === id) setExpandedId(null)
  }
  function addSectionOfType(ct: ContentType) {
    const s = ct === 'table'
      ? newTableSection()
      : ct === 'html'
        ? { ...newSection(), contentType: ct, htmlCode: '' }
        : { ...newSection(), contentType: ct }
    setSections(ss => [...ss, s])
    setExpandedId(s.id)
    setShowAddMenu(false)
  }

  useEffect(() => {
    if (!showAddMenu) return
    function onClickOutside(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [showAddMenu])
  function handleDrop(toIdx: number) {
    if (dragIdx === null || dragIdx === toIdx) return
    const arr = [...sections]
    const [moved] = arr.splice(dragIdx, 1)
    arr.splice(toIdx, 0, moved)
    setSections(arr)
    setDragIdx(null); setOverIdx(null)
  }
  function handleSave() {
    const updated: PageTemplate = { ...template, name: name.trim() || 'Untitled', sections }
    onSave(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All templates
        </button>
        <span className="text-gray-200">|</span>
        <input
          className="flex-1 text-sm font-semibold text-gray-800 bg-transparent outline-none border-b border-transparent focus:border-gray-300 transition-colors pb-0.5 placeholder-gray-300"
          value={name} placeholder="Template name" onChange={e => setName(e.target.value)} />
        <button onClick={handleSave}
          className="flex items-center gap-1.5 text-xs px-3.5 h-8 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors font-medium shrink-0">
          {saved
            ? <><svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Saved</>
            : 'Save template'}
        </button>
      </div>

      {/* Variable hint */}
      <p className="text-xs text-gray-400 bg-gray-50 rounded-md px-3 py-2 mb-4">
        Variables in headings and notes:{' '}
        {['{service}', '{city}', '{state}', '{company}'].map(v => (
          <code key={v} className="text-gray-600 mx-1">{v}</code>
        ))}
      </p>

      {/* Section list */}
      <div className="space-y-2">
        {sections.map((sec, i) => (
          <SectionRow
            key={sec.id} sec={sec}
            expanded={expandedId === sec.id}
            dragging={dragIdx === i}
            dragOver={overIdx === i && dragIdx !== i}
            onToggle={() => setExpandedId(expandedId === sec.id ? null : sec.id)}
            onUpdate={updated => updateSection(sec.id, updated)}
            onDuplicate={() => {
              const copy = { ...sec, id: uid() }
              setSections(ss => {
                const idx = ss.findIndex(s => s.id === sec.id)
                const arr = [...ss]
                arr.splice(idx + 1, 0, copy)
                return arr
              })
              setExpandedId(copy.id)
            }}
            onDelete={() => removeSection(sec.id)}
            onDragStart={() => setDragIdx(i)}
            onDragOver={e => { e.preventDefault(); setOverIdx(i) }}
            onDrop={() => handleDrop(i)}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
          />
        ))}
      </div>

      {/* Add section popup */}
      <div className="mt-3 relative" ref={addMenuRef}>
        <button onClick={() => setShowAddMenu(v => !v)}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 border border-dashed border-gray-200 hover:border-gray-300 rounded-lg h-9 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add section
        </button>

        {showAddMenu && (
          <div className="absolute bottom-full left-0 mb-1.5 w-52 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 z-20">
            {CONTENT_TYPES.map(ct => (
              <button key={ct.value}
                onClick={() => addSectionOfType(ct.value)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors text-left">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ct.color }} />
                {ct.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Template list ─────────────────────────────────────────────────────────────

function TemplateCard({ template, onEdit, onDuplicate, onDelete }: {
  template: PageTemplate; onEdit: () => void; onDuplicate: () => void; onDelete: () => void
}) {
  const typeCount = template.sections.reduce<Record<string, number>>((acc, s) => {
    acc[s.contentType] = (acc[s.contentType] || 0) + 1
    return acc
  }, {})

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-800">{template.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{template.sections.length} sections</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button onClick={onEdit}
            className="text-xs px-2.5 h-7 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            Edit
          </button>
          <button onClick={onDuplicate}
            className="text-xs px-2.5 h-7 rounded-md border border-gray-200 text-gray-400 hover:text-indigo-500 hover:border-indigo-200 transition-colors">
            Duplicate
          </button>
          <button onClick={onDelete}
            className="text-xs px-2.5 h-7 rounded-md border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors">
            Delete
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(typeCount).map(([ct, n]) => (
          <span key={ct} className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: typeColor(ct as ContentType) + '1a', color: typeColor(ct as ContentType) }}>
            {n > 1 ? `${n}× ` : ''}{typeLabel(ct as ContentType)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function TemplateManager() {
  const [templates,    setTemplates]    = useState<PageTemplate[]>([])
  const [editing,      setEditing]      = useState<PageTemplate | null>(null)
  const [pdfImporting, setPdfImporting] = useState(false)
  const [pdfError,     setPdfError]     = useState('')
  const pdfInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function init() {
      // One-time migration: move any localStorage templates into Supabase
      const LS_KEY = 'fencepost_templates_v1'
      const raw = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
      if (raw) {
        try {
          const local: PageTemplate[] = JSON.parse(raw)
          for (const t of local) await saveTemplate(t)
          localStorage.removeItem(LS_KEY)
        } catch { /* ignore parse errors */ }
      }
      setTemplates(await loadTemplates())
    }
    init()
  }, [])

  async function handleSave(t: PageTemplate) {
    await saveTemplate(t); setTemplates(await loadTemplates())
  }
  async function handleDelete(id: string) {
    if (!confirm('Delete this template?')) return
    await deleteTemplate(id); setTemplates(await loadTemplates())
  }
  async function handleDuplicate(t: PageTemplate) {
    const copy: PageTemplate = {
      ...t,
      id:        uid(),
      name:      `Copy of ${t.name}`,
      sections:  t.sections.map(s => ({ ...s, id: uid() })),
      createdAt: new Date().toISOString(),
    }
    await saveTemplate(copy); setTemplates(await loadTemplates())
  }
  function handleSaveAndBack(t: PageTemplate) {
    handleSave(t); setEditing(null)
  }

  async function handlePdfImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so the same file can be re-uploaded if needed
    e.target.value = ''

    setPdfImporting(true)
    setPdfError('')
    try {
      const formData = new FormData()
      formData.append('pdf', file)
      const res = await fetch('/api/parse-pdf-template', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to parse PDF')

      // Build a new template from the AI-returned sections
      const sections: TemplateSection[] = (json.sections || []).map((s: any) => ({
        id: uid(),
        heading:     s.heading     ?? '',
        contentType: s.contentType ?? 'paragraphs',
        count:       s.count       ?? 2,
        wordsEach:   s.wordsEach   ?? 60,
        notes:       s.notes       ?? '',
      }))

      const newTemplate: PageTemplate = {
        id:        uid(),
        name:      json.suggestedName || file.name.replace(/\.pdf$/i, ''),
        sections,
        createdAt: new Date().toISOString(),
      }
      setEditing(newTemplate)
    } catch (err: any) {
      setPdfError(err.message || 'Could not parse PDF')
    } finally {
      setPdfImporting(false)
    }
  }

  if (editing) {
    return <Editor template={editing} onSave={handleSaveAndBack} onBack={() => setEditing(null)} />
  }

  return (
    <div>
      {/* Hidden PDF file input */}
      <input
        ref={pdfInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={handlePdfImport}
      />

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Page Templates</h2>
          <p className="text-xs text-gray-400 mt-0.5">Build reusable section structures — pick one when generating a page</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Import from PDF */}
          <button
            onClick={() => { setPdfError(''); pdfInputRef.current?.click() }}
            disabled={pdfImporting}
            className="flex items-center gap-1.5 text-xs px-3.5 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-50 bg-white"
          >
            {pdfImporting ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Analysing PDF…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Import from PDF
              </>
            )}
          </button>

          {/* New blank template */}
          <button onClick={() => setEditing(newBlankTemplate())}
            className="flex items-center gap-1.5 text-xs px-3.5 h-8 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors font-medium">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New template
          </button>
        </div>
      </div>

      {/* PDF error */}
      {pdfError && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2.5">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          {pdfError}
        </div>
      )}

      {templates.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium text-gray-500 mb-1">No saved templates</p>
          <p className="text-xs">Create a blank template or import the structure from a PDF page</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => { setPdfError(''); pdfInputRef.current?.click() }}
              disabled={pdfImporting}
              className="text-xs px-4 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Import from PDF
            </button>
            <button onClick={() => setEditing(newBlankTemplate())}
              className="text-xs px-4 h-8 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors font-medium">
              Create blank template
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map(t => (
            <TemplateCard key={t.id} template={t}
              onEdit={() => setEditing(t)}
              onDuplicate={() => handleDuplicate(t)}
              onDelete={() => handleDelete(t.id)} />
          ))}
        </div>
      )}
    </div>
  )
}
