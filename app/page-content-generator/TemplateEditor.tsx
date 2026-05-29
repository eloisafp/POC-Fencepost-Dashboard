'use client'

import { useState, useEffect } from 'react'
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
  { value: 'cta',         label: 'Call to Action',  color: '#06b6d4' },
  { value: 'table',       label: 'Two-Col Table',   color: '#d946ef' },
]

const CELL_TYPES = CONTENT_TYPES.filter(t => t.value !== 'table')

function typeColor(ct: ContentType) { return CONTENT_TYPES.find(t => t.value === ct)?.color ?? '#94a3b8' }
function typeLabel(ct: ContentType) { return CONTENT_TYPES.find(t => t.value === ct)?.label ?? ct }

// ── CellEditor (used inside table section rows) ───────────────────────────────

function CellEditor({ label, cell, onUpdate }: {
  label: string
  cell: CellDef
  onUpdate: (c: CellDef) => void
}) {
  const inp = 'w-full h-7 border border-gray-200 rounded-md px-2.5 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white'
  const showCount = !['image', 'cta'].includes(cell.contentType)
  const showWords = !['image', 'cta', 'bullets'].includes(cell.contentType)
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
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            {cell.contentType === 'image' ? 'Caption' : 'Heading'}
          </label>
          <input className={inp} value={cell.heading}
            placeholder={cell.contentType === 'image' ? 'Image description' : 'H2 heading — use {service} {city} etc.'}
            onChange={e => onUpdate({ ...cell, heading: e.target.value })} />
        </div>
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
  onToggle, onUpdate, onDelete,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  sec: TemplateSection
  expanded: boolean
  dragOver: boolean
  dragging: boolean
  onToggle: () => void
  onUpdate: (s: TemplateSection) => void
  onDelete: () => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  const inp = 'w-full h-8 border border-gray-200 rounded-md px-3 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white'
  const isTable   = sec.contentType === 'table'
  const showCount = !isTable && !['image', 'cta'].includes(sec.contentType)
  const showWords = !isTable && !['image', 'cta', 'bullets'].includes(sec.contentType)

  const countLabel: Record<string, string> = {
    paragraphs: 'Paragraphs', bullets: 'Bullet points', subsections: 'Sub-sections',
    steps: 'Steps', faq: 'Q&A pairs', cta: '', image: '',
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
        ) : (
          <span className="flex-1 text-xs text-gray-700 truncate min-w-0">
            {sec.heading || <span className="text-gray-300 italic">No heading</span>}
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

      {/* Expanded form — non-table */}
      {expanded && !isTable && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {sec.contentType === 'image' ? 'Image caption' : 'Section heading'}
            </label>
            <input className={inp} value={sec.heading}
              placeholder={sec.contentType === 'image'
                ? 'Description of the image placeholder'
                : 'H2 heading — use {service} {city} {state} {company}'}
              onChange={e => onUpdate({ ...sec, heading: e.target.value })} />
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
  const [name,       setName]       = useState(template.name)
  const [sections,   setSections]   = useState<TemplateSection[]>(template.sections)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dragIdx,    setDragIdx]    = useState<number | null>(null)
  const [overIdx,    setOverIdx]    = useState<number | null>(null)
  const [saved,      setSaved]      = useState(false)

  function updateSection(id: string, updated: TemplateSection) {
    setSections(ss => ss.map(s => s.id === id ? updated : s))
  }
  function removeSection(id: string) {
    setSections(ss => ss.filter(s => s.id !== id))
    if (expandedId === id) setExpandedId(null)
  }
  function addSection() {
    const s = newSection(); setSections(ss => [...ss, s]); setExpandedId(s.id)
  }
  function addTable() {
    const s = newTableSection(); setSections(ss => [...ss, s]); setExpandedId(s.id)
  }
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
            onDelete={() => removeSection(sec.id)}
            onDragStart={() => setDragIdx(i)}
            onDragOver={e => { e.preventDefault(); setOverIdx(i) }}
            onDrop={() => handleDrop(i)}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
          />
        ))}
      </div>

      {/* Add buttons */}
      <div className="mt-3 flex gap-2">
        <button onClick={addSection}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 border border-dashed border-gray-200 hover:border-gray-300 rounded-lg h-9 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add section
        </button>
        <button onClick={addTable}
          className="flex items-center justify-center gap-1.5 text-xs px-4 text-fuchsia-500 hover:text-fuchsia-700 border border-dashed border-fuchsia-200 hover:border-fuchsia-300 rounded-lg h-9 transition-colors bg-fuchsia-50 hover:bg-fuchsia-100">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M3 3h18v18H3z" />
          </svg>
          Add two-column table
        </button>
      </div>
    </div>
  )
}

// ── Template list ─────────────────────────────────────────────────────────────

function TemplateCard({ template, onEdit, onDelete }: {
  template: PageTemplate; onEdit: () => void; onDelete: () => void
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
  const [templates, setTemplates] = useState<PageTemplate[]>([])
  const [editing,   setEditing]   = useState<PageTemplate | null>(null)

  useEffect(() => { setTemplates(loadTemplates()) }, [])

  function handleSave(t: PageTemplate) {
    saveTemplate(t); setTemplates(loadTemplates())
  }
  function handleDelete(id: string) {
    if (!confirm('Delete this template?')) return
    deleteTemplate(id); setTemplates(loadTemplates())
  }
  function handleSaveAndBack(t: PageTemplate) {
    handleSave(t); setEditing(null)
  }

  if (editing) {
    return <Editor template={editing} onSave={handleSaveAndBack} onBack={() => setEditing(null)} />
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Page Templates</h2>
          <p className="text-xs text-gray-400 mt-0.5">Build reusable section structures — pick one when generating a page</p>
        </div>
        <button onClick={() => setEditing(newBlankTemplate())}
          className="flex items-center gap-1.5 text-xs px-3.5 h-8 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors font-medium">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium text-gray-500 mb-1">No saved templates</p>
          <p className="text-xs">Create a template to define a reusable page structure</p>
          <button onClick={() => setEditing(newBlankTemplate())}
            className="mt-4 text-xs px-4 h-8 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors font-medium">
            Create your first template
          </button>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map(t => (
            <TemplateCard key={t.id} template={t}
              onEdit={() => setEditing(t)}
              onDelete={() => handleDelete(t.id)} />
          ))}
        </div>
      )}
    </div>
  )
}
