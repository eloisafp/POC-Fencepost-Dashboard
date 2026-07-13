'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

type Run = {
  id: number
  master_client_id: number
  client_slug: string
  phase: string
  intake: any
  seeds: any
  competitors: any
  content_guidelines: any
  existing_pages: any
}

type KeywordRow = {
  id: number
  keyword: string
  monthly_volume: number | null
  kd: number | null
  cpc: number | null
  source: string | null
  search_intent: string | null
}

type ExportRecord = {
  id: number
  filename: string
  public_url: string | null
  size_bytes: number | null
  created_at: string
}

function formatExportDate(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type MasterClient = { client_name: string; intake_form_link: string | null; content_guidelines_url: string | null }
type ContentPlanItem = { id: number; title: string; content_track: string; status: string; page_status: string | null; volume: number | null; kd: number | null }

const TABS = ['Intake', 'Keywords', 'Clusters', 'Content Plan', 'View Exports'] as const
type Tab = typeof TABS[number]

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  'Topic for Client Approval': { bg: 'bg-amber-50', text: 'text-amber-600' },
  new:      { bg: 'bg-gray-100', text: 'text-gray-500' },
  optimize: { bg: 'bg-blue-50',  text: 'text-blue-600' },
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
  return json
}

type StepStatus = 'pending' | 'running' | 'done' | 'error'

const PIPELINE_STEPS = [
  { key: 'intake',      label: 'Parsing intake form' },
  { key: 'guidelines',  label: 'Parsing content guidelines' },
  { key: 'seeds',       label: 'Generating seed keywords' },
  { key: 'competitors', label: 'Resolving competitors' },
  { key: 'keywords',    label: 'Fetching keywords from Ahrefs' },
  { key: 'cluster',     label: 'Clustering keywords with AI' },
  { key: 'plan',        label: 'Generating content plan' },
  { key: 'export',      label: 'Saving Excel export' },
] as const
type PipelineKey = typeof PIPELINE_STEPS[number]['key']

export default function RunWorkspace({ runId, onBack, initialTab, autoRun }: { runId: number; onBack: () => void; initialTab?: Tab; autoRun?: boolean }) {
  const [run, setRun]       = useState<Run | null>(null)
  const [client, setClient] = useState<MasterClient | null>(null)
  const [tab, setTab]       = useState<Tab>(initialTab ?? 'Intake')
  const [busy, setBusy]     = useState<string | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [seeds, setSeeds]   = useState<any>(null)
  const [pipeline, setPipeline] = useState<Record<PipelineKey, StepStatus> | null>(null)
  const pipelineStarted = useRef(false)
  const [creditsError, setCreditsError] = useState<string | null>(null)
  const stopRequested = useRef(false)
  const [stopping, setStopping] = useState(false)

  // Manual competitor entry: when intake yields no usable competitors, the run
  // pauses on a dialog until the user submits 1-10 competitors (or skips)
  const [compDialogOpen, setCompDialogOpen] = useState(false)
  const [compRows, setCompRows] = useState<{ name: string; website: string }[]>([{ name: '', website: '' }])
  const compResolver = useRef<((comps: { name: string; domain: string; source: string }[]) => void) | null>(null)

  function askForCompetitors(): Promise<{ name: string; domain: string; source: string }[]> {
    setCompRows([{ name: '', website: '' }])
    setCompDialogOpen(true)
    return new Promise(resolve => { compResolver.current = resolve })
  }

  function submitCompetitors(skip: boolean) {
    const toDomain = (u: string) => u.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
    const entries = skip ? [] : compRows
      .filter(r => r.name.trim() && r.website.trim())
      .slice(0, 10)
      .map(r => ({ name: r.name.trim(), domain: toDomain(r.website), source: 'manual' }))
    if (!skip && entries.length === 0) return // Save requires at least 1 complete row
    setCompDialogOpen(false)
    compResolver.current?.(entries)
    compResolver.current = null
  }

  // Merge manual competitors into the run when the resolver found fewer than 2 clean ones
  async function ensureCompetitors(comps: any): Promise<any> {
    if (comps?.competitors?.length >= 2 && !comps.has_auto_derived) return comps
    const manual = await askForCompetitors()
    if (manual.length === 0) return comps
    const merged = {
      ...comps,
      competitors: [...(comps?.competitors || []), ...manual],
      total: (comps?.competitors?.length || 0) + manual.length,
      has_auto_derived: false,
    }
    await supabase
      .from('keyword_pipeline_runs')
      .update({ competitors: merged, updated_at: new Date().toISOString() })
      .eq('id', runId)
    return merged
  }

  const [items, setItems]       = useState<ContentPlanItem[]>([])
  const [clusters, setClusters] = useState<any[]>([])
  const [unclustered, setUnclustered] = useState(0)

  const loadClusters = useCallback(async () => {
    const [{ data: cls }, { data: kws }] = await Promise.all([
      supabase.from('keyword_pipeline_clusters').select('id, slug, label, service_category').eq('run_id', runId),
      supabase.from('keyword_pipeline_keywords').select('cluster_id, monthly_volume, kd').eq('run_id', runId).limit(5000),
    ])
    const rows = kws || []
    const enriched = (cls || []).map(c => {
      const mine = rows.filter(k => k.cluster_id === c.id)
      const totalVolume = mine.reduce((s, k) => s + (k.monthly_volume || 0), 0)
      const kdVals = mine.filter(k => k.kd != null)
      const avgKd = kdVals.length ? kdVals.reduce((s, k) => s + Number(k.kd), 0) / kdVals.length : null
      return { ...c, count: mine.length, totalVolume, avgKd }
    }).sort((a, b) => b.totalVolume - a.totalVolume)
    setClusters(enriched)
    setUnclustered(rows.filter(k => k.cluster_id == null).length)
    setKwCount(rows.length)
  }, [runId])
  const [keywords, setKeywords] = useState<KeywordRow[]>([])
  const [kwCount, setKwCount]   = useState(0)
  const [kwSummary, setKwSummary] = useState<{ total_keywords: number; by_source: Record<string, number>; existing_pages_count: number; warnings: string[] } | null>(null)
  const [planSummary, setPlanSummary] = useState<{ total_items: number; blog_count: number; location_count: number; optimize_count: number; warnings: string[] } | null>(null)

  const [exports, setExports] = useState<ExportRecord[]>([])

  const loadExports = useCallback(async () => {
    const { data } = await supabase
      .from('keyword_pipeline_exports')
      .select('id, filename, public_url, size_bytes, created_at')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
    setExports((data || []) as ExportRecord[])
  }, [runId])

  const loadKeywords = useCallback(async () => {
    const { data, count } = await supabase
      .from('keyword_pipeline_keywords')
      .select('id, keyword, monthly_volume, kd, cpc, source, search_intent', { count: 'exact' })
      .eq('run_id', runId)
      .order('monthly_volume', { ascending: false, nullsFirst: false })
      .limit(200)
    setKeywords((data || []) as KeywordRow[])
    setKwCount(count || 0)
  }, [runId])

  const loadRun = useCallback(async () => {
    const { data } = await supabase.from('keyword_pipeline_runs').select('*').eq('id', runId).single()
    if (data) {
      setRun(data as Run)
      if (data.seeds) setSeeds(data.seeds)
      const { data: c } = await supabase
        .from('master_clients')
        .select('client_name, intake_form_link, content_guidelines_url')
        .eq('id', data.master_client_id)
        .single()
      if (c) setClient(c as MasterClient)
    }
  }, [runId])

  useEffect(() => { loadRun() }, [loadRun])

  useEffect(() => {
    if (tab === 'Keywords') loadKeywords()
    if (tab === 'Content Plan') {
      supabase.from('keyword_pipeline_content_plan_items').select('*').eq('run_id', runId)
        .then(({ data }) => setItems((data || []) as ContentPlanItem[]))
    }
    if (tab === 'Clusters') loadClusters()
    if (tab === 'View Exports') loadExports()
  }, [tab, runId, loadKeywords, loadClusters, loadExports])

  async function deleteExport(exportId: number) {
    if (!window.confirm('Delete this export file permanently? This cannot be undone.')) return
    setBusy('delete-export'); setError(null)
    try {
      await postJson('/api/keyword-pipeline/export/delete', { export_id: exportId })
      await loadExports()
    } catch (e: any) {
      setError(e.message)
    }
    setBusy(null)
  }

  // Resume-aware: skips steps whose output is already saved in the database,
  // so after a failure (or Stop) the same button continues from where it left
  // off. When every step is already complete, it re-runs everything fresh.
  async function runFullPipeline() {
    setBusy('pipeline'); setError(null)
    stopRequested.current = false
    setStopping(false)

    // What's already done for this run?
    const [{ data: r }, kw, cl, it, ex] = await Promise.all([
      supabase.from('keyword_pipeline_runs').select('intake, seeds, competitors, content_guidelines').eq('id', runId).single(),
      supabase.from('keyword_pipeline_keywords').select('id', { count: 'exact', head: true }).eq('run_id', runId),
      supabase.from('keyword_pipeline_clusters').select('id', { count: 'exact', head: true }).eq('run_id', runId),
      supabase.from('keyword_pipeline_content_plan_items').select('id', { count: 'exact', head: true }).eq('run_id', runId),
      supabase.from('keyword_pipeline_exports').select('id', { count: 'exact', head: true }).eq('run_id', runId),
    ])
    const done: Record<PipelineKey, boolean> = {
      intake: !!r?.intake,
      guidelines: r?.content_guidelines != null,
      seeds: !!r?.seeds,
      competitors: !!r?.competitors,
      keywords: (kw.count ?? 0) > 0,
      cluster: (cl.count ?? 0) > 0,
      plan: (it.count ?? 0) > 0,
      export: (ex.count ?? 0) > 0,
    }
    // Everything finished already -> this click means "re-run all"
    if (PIPELINE_STEPS.every(s => done[s.key])) PIPELINE_STEPS.forEach(s => { done[s.key] = false })

    setPipeline(Object.fromEntries(PIPELINE_STEPS.map(s => [s.key, done[s.key] ? 'done' : 'pending'])) as Record<PipelineKey, StepStatus>)
    const mark = (k: PipelineKey, s: StepStatus) => setPipeline(p => (p ? { ...p, [k]: s } : p))

    let currentSeeds: any = r?.seeds ?? null
    const steps: { key: PipelineKey; optional?: boolean; fn: () => Promise<void> }[] = [
      { key: 'intake', fn: async () => {
        const r = await postJson('/api/keyword-pipeline/intake', { run_id: runId })
        setRun(prev => prev ? { ...prev, intake: r.intake } : prev)
      } },
      // Guidelines are optional — a missing doc never stops the pipeline
      { key: 'guidelines', optional: true, fn: async () => {
        const r = await postJson('/api/keyword-pipeline/guidelines', { run_id: runId })
        setRun(prev => prev ? { ...prev, content_guidelines: r.content_guidelines } : prev)
      } },
      { key: 'seeds', fn: async () => {
        const r = await postJson('/api/keyword-pipeline/seeds', { run_id: runId })
        currentSeeds = r.seeds
        setSeeds(r.seeds)
      } },
      { key: 'competitors', fn: async () => {
        const r = await postJson('/api/keyword-pipeline/competitors', { run_id: runId, seeds: currentSeeds })
        const finalComps = await ensureCompetitors(r.competitors)
        setRun(prev => prev ? { ...prev, competitors: finalComps } : prev)
      } },
      { key: 'keywords', fn: async () => {
        const r = await postJson('/api/keyword-pipeline/keywords', { run_id: runId })
        setKwSummary(r)
      } },
      { key: 'cluster', fn: async () => {
        await postJson('/api/keyword-pipeline/cluster', { run_id: runId })
      } },
      { key: 'plan', fn: async () => {
        const r = await postJson('/api/keyword-pipeline/content-plan', { run_id: runId })
        setPlanSummary(r)
      } },
      { key: 'export', fn: async () => {
        await postJson('/api/keyword-pipeline/export/save', { run_id: runId })
      } },
    ]

    for (const s of steps) {
      if (done[s.key]) continue
      if (stopRequested.current) {
        setError('Pipeline stopped by user — click Run / Resume to continue from this step.')
        setBusy(null)
        setStopping(false)
        return
      }
      mark(s.key, 'running')
      try {
        await s.fn()
        mark(s.key, 'done')
      } catch (e: any) {
        mark(s.key, 'error')
        if (e.message?.includes('Not enough Ahrefs API units')) setCreditsError(e.message)
        if (!s.optional) {
          setError(`${PIPELINE_STEPS.find(p => p.key === s.key)?.label}: ${e.message}`)
          setBusy(null)
          return
        }
      }
    }

    await loadRun()
    await loadExports()
    setTab('View Exports')
    setBusy(null)
  }

  // Auto-start the full pipeline when opened from "+ New run"
  useEffect(() => {
    if (!autoRun || pipelineStarted.current || !run || !client) return
    pipelineStarted.current = true
    if (!client.intake_form_link) {
      setError('No intake form link on file for this client — add one on the Clients page first')
      return
    }
    runFullPipeline()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, run, client])

  if (!run) return <div style={{ padding: 24, fontSize: 12, color: '#94a3b8' }}>Loading…</div>

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}>
      <button onClick={onBack} style={{ fontSize: 11, color: '#71717a', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12 }}>← Back</button>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, color: '#18181b', margin: 0 }}>{run.client_slug}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {busy === 'pipeline' ? (
            <button
              onClick={() => { stopRequested.current = true; setStopping(true) }}
              disabled={stopping}
              className="text-xs px-4 h-8 rounded-md border border-red-300 bg-red-50 text-red-600 font-medium disabled:opacity-60"
            >
              {stopping ? 'Stopping after current step…' : '■ Stop'}
            </button>
          ) : (
            <button
              onClick={runFullPipeline}
              disabled={!!busy || !client?.intake_form_link}
              className="text-xs px-4 h-8 rounded-md bg-zinc-900 text-white font-medium disabled:opacity-40"
            >
              ▶ Run / Resume pipeline
            </button>
          )}
        </div>
      </div>

      {pipeline && (() => {
        const statuses = PIPELINE_STEPS.map(s => pipeline[s.key])
        const doneCount = statuses.filter(s => s === 'done' || s === 'error').length
        const runningStep = PIPELINE_STEPS.find(s => pipeline[s.key] === 'running')
        const failed = !runningStep && statuses.includes('error') && busy !== 'pipeline' && !!error
        const complete = doneCount === PIPELINE_STEPS.length && !failed && busy !== 'pipeline'
        const pct = Math.round((doneCount / PIPELINE_STEPS.length) * 100)
        return (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: failed ? '#dc2626' : complete ? '#16a34a' : '#18181b' }}>
                {failed ? '✕ Pipeline stopped' : complete ? '✓ Pipeline complete — export saved below' : `${runningStep?.label ?? 'Starting'}…`}
              </span>
              <span style={{ fontSize: 11, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
            </div>
            <div style={{ height: 6, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: failed ? '#dc2626' : complete ? '#16a34a' : '#2563eb', borderRadius: 99, transition: 'width .4s ease' }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
              {PIPELINE_STEPS.map(s => {
                const st = pipeline[s.key]
                const color = st === 'done' ? '#16a34a' : st === 'error' ? '#dc2626' : st === 'running' ? '#2563eb' : '#94a3b8'
                const icon  = st === 'done' ? '✓' : st === 'error' ? '✕' : st === 'running' ? '…' : '○'
                return (
                  <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                    <span style={{ color, fontWeight: 600 }}>{icon}</span>
                    <span style={{ color: st === 'pending' ? '#94a3b8' : '#334155' }}>{s.label}</span>
                  </span>
                )
              })}
            </div>
            {failed && error && (
              <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 6, marginTop: 10 }}>
                {error} — fix the issue, then click Run / Resume pipeline to continue from the failed step.
              </div>
            )}
          </div>
        )
      })()}

      {creditsError && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(24,24,27,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '20px 22px', width: 400, maxWidth: 'calc(100vw - 48px)', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#dc2626', marginBottom: 8 }}>
              ⚠ Not enough Ahrefs credits
            </div>
            <div style={{ fontSize: 12, color: '#52525b', lineHeight: 1.6, marginBottom: 16 }}>
              {creditsError}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setCreditsError(null)}
                className="text-xs px-4 h-8 rounded-md bg-zinc-900 text-white font-medium"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {compDialogOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(24,24,27,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '20px 22px', width: 460, maxWidth: 'calc(100vw - 48px)', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#18181b', marginBottom: 6 }}>
              Add competitors to continue
            </div>
            <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.5, marginBottom: 14 }}>
              The intake form named fewer than 2 usable competitors. Enter at least 1 (up to 10) — their websites feed the competitor gap analysis in the keyword fetch.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {compRows.map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    value={row.name}
                    onChange={e => setCompRows(rows => rows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                    placeholder="Competitor name"
                    className="h-8 border border-gray-200 rounded-md px-2.5 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white placeholder-gray-300"
                    style={{ flex: 1 }}
                  />
                  <input
                    value={row.website}
                    onChange={e => setCompRows(rows => rows.map((r, j) => j === i ? { ...r, website: e.target.value } : r))}
                    placeholder="Website URL"
                    className="h-8 border border-gray-200 rounded-md px-2.5 text-xs text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white placeholder-gray-300"
                    style={{ flex: 1 }}
                  />
                  {compRows.length > 1 && (
                    <button
                      onClick={() => setCompRows(rows => rows.filter((_, j) => j !== i))}
                      title="Remove"
                      style={{ width: 26, height: 26, border: '1px solid #e2e8f0', borderRadius: 6, background: 'none', color: '#94a3b8', cursor: 'pointer', flexShrink: 0, fontSize: 13, lineHeight: 1 }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            {compRows.length < 10 && (
              <button
                onClick={() => setCompRows(rows => [...rows, { name: '', website: '' }])}
                style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 16 }}
              >
                + Add another competitor ({compRows.length}/10)
              </button>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => submitCompetitors(true)}
                style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Skip — continue without competitors
              </button>
              <button
                onClick={() => submitCompetitors(false)}
                disabled={!compRows.some(r => r.name.trim() && r.website.trim())}
                className="text-xs px-3 h-8 rounded-md bg-zinc-900 text-white font-medium disabled:opacity-40"
              >
                Save & continue
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', marginBottom: 16 }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 12px', fontSize: 12, fontWeight: tab === t ? 600 : 400,
              color: tab === t ? '#18181b' : '#94a3b8', background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid #18181b' : '2px solid transparent', cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {error && tab !== 'Intake' && !pipeline && <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>{error}</div>}

      {tab === 'Intake' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Sources */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#71717a', minWidth: 130 }}>Intake form</span>
              {client?.intake_form_link
                ? <a href={client.intake_form_link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>Open doc ↗</a>
                : <span style={{ fontSize: 12, color: '#f87171' }}>Not set — add on Clients page first</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#71717a', minWidth: 130 }}>Content guidelines</span>
              {client?.content_guidelines_url
                ? <a href={client.content_guidelines_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>Open doc ↗</a>
                : <span style={{ fontSize: 12, color: '#94a3b8' }}>Not set — guidelines step will be skipped</span>}
            </div>
          </div>

          {!client?.intake_form_link && <div style={{ fontSize: 12, color: '#f87171' }}>Intake form link required — add it on the Clients page, then click Run / Resume pipeline above.</div>}

          {error && !pipeline && <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 6 }}>{error}</div>}

          {/* Results summary */}
          {run.intake && (
            <div style={{ fontSize: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '10px 12px', borderRadius: 6, color: '#166534' }}>
              ✓ Intake parsed — {run.intake.services?.length ?? 0} services, {run.intake.service_areas?.length ?? 0} service areas, {run.intake.competitors?.length ?? 0} competitors
              {seeds?.total_seeds ? ` · ${seeds.total_seeds} seed keywords` : ''}
            </div>
          )}
          {run.competitors?.has_auto_derived && (
            <div style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', padding: '8px 12px', borderRadius: 6 }}>
              Fewer than 2 clean competitors found — manual entry may be needed.
            </div>
          )}
        </div>
      )}

      {tab === 'Keywords' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {kwCount > 0 && <div style={{ fontSize: 11, color: '#71717a' }}>{kwCount} keywords stored</div>}

          {kwSummary && (
            <div style={{ fontSize: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '10px 12px', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: '#166534', fontWeight: 600 }}>✓ {kwSummary.total_keywords} keywords fetched · {kwSummary.existing_pages_count} existing pages found</span>
              <span style={{ color: '#166534' }}>
                {Object.entries(kwSummary.by_source).map(([s, n]) => `${s}: ${n}`).join(' · ')}
              </span>
              {kwSummary.warnings.length > 0 && (
                <span style={{ color: '#b45309' }}>⚠ {kwSummary.warnings.join(' | ')}</span>
              )}
            </div>
          )}

          {keywords.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#71717a', marginBottom: 6 }}>
                Top {keywords.length} of {kwCount} by volume
              </div>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: '#18181b' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#71717a', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>Keyword</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Volume</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>KD</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>CPC</th>
                    <th style={{ padding: '6px 8px' }}>Intent</th>
                    <th style={{ padding: '6px 8px' }}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map(k => (
                    <tr key={k.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 8px' }}>{k.keyword}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{k.monthly_volume?.toLocaleString() ?? '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{k.kd ?? '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{k.cpc != null ? `$${Number(k.cpc).toFixed(2)}` : '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{k.search_intent ?? '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{k.source ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {keywords.length === 0 && (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>No keywords yet — click Run / Resume pipeline above.</div>
          )}
        </div>
      )}

      {tab === 'Clusters' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {clusters.length > 0 && (
            <div style={{ fontSize: 11, color: '#71717a' }}>
              {clusters.length} clusters · {kwCount - unclustered} of {kwCount} keywords assigned
            </div>
          )}

          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: '#18181b' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#71717a', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Cluster</th>
                <th style={{ padding: '6px 8px' }}>Service Category</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}># Keywords</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Total Volume</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Avg KD</th>
              </tr>
            </thead>
            <tbody>
              {clusters.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '16px 8px', color: '#94a3b8' }}>Clusters will appear here once keywords are fetched and clustered.</td></tr>
              ) : (
                <>
                  {clusters.map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 8px' }}>{c.label}</td>
                      <td style={{ padding: '6px 8px' }}>{c.service_category ?? '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{c.count}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{c.totalVolume.toLocaleString()}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{c.avgKd != null ? Math.round(c.avgKd) : '—'}</td>
                    </tr>
                  ))}
                  {unclustered > 0 && (
                    <tr style={{ borderBottom: '1px solid #f1f5f9', color: '#94a3b8' }}>
                      <td style={{ padding: '6px 8px' }}>Uncategorized (filtered out by AI)</td>
                      <td style={{ padding: '6px 8px' }}>—</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{unclustered}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>—</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>—</td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Content Plan' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {items.length > 0 && <div style={{ fontSize: 11, color: '#71717a' }}>{items.length} items</div>}

          {planSummary && (
            <div style={{ fontSize: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '10px 12px', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: '#166534', fontWeight: 600 }}>
                ✓ {planSummary.total_items} items · {planSummary.blog_count} blog posts · {planSummary.location_count} location pages · {planSummary.optimize_count} marked optimize
              </span>
              {planSummary.warnings.length > 0 && (
                <span style={{ color: '#b45309' }}>⚠ {planSummary.warnings.join(' | ')}</span>
              )}
            </div>
          )}

        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: '#18181b' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#71717a', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>Title</th>
              <th style={{ padding: '6px 8px' }}>Track</th>
              <th style={{ padding: '6px 8px' }}>Status</th>
              <th style={{ padding: '6px 8px' }}>Volume</th>
              <th style={{ padding: '6px 8px' }}>KD</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '16px 8px', color: '#94a3b8' }}>Content plan items will appear here once Phase 4 has run.</td></tr>
            ) : items.map(item => {
              const style = STATUS_STYLE[item.page_status || item.status] || STATUS_STYLE.new
              return (
                <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px' }}>{item.title}</td>
                  <td style={{ padding: '6px 8px' }}>{item.content_track}</td>
                  <td style={{ padding: '6px 8px' }}><span className={`px-2 py-0.5 rounded-full text-[11px] ${style.bg} ${style.text}`}>{item.status}</span></td>
                  <td style={{ padding: '6px 8px' }}>{item.volume ?? '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{item.kd ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      {tab === 'View Exports' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', maxWidth: 700 }}>

          {/* Header: run context + generate button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#94a3b8' }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-3-3v6M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H9l-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span>Run for <strong style={{ color: '#52525b', fontWeight: 600 }}>{run.client_slug}</strong> &nbsp;·&nbsp; {exports.length} saved export{exports.length === 1 ? '' : 's'}</span>
            </div>
          </div>

          <div style={{ padding: '10px 20px 8px', fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #f1f5f9' }}>
            Saved exports
          </div>

          {exports.length === 0 && (
            <div style={{ padding: '20px', fontSize: 12, color: '#94a3b8' }}>
              No saved exports yet — click <span style={{ color: '#52525b', fontWeight: 500 }}>Generate New Export</span> to create the first one.
            </div>
          )}

          {exports.map((e, i) => (
            <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: i === exports.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#52525b', fontVariantNumeric: 'tabular-nums' }}>
                {exports.length - i}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#18181b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 3 }}>
                  {e.filename}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#94a3b8' }}>
                  <span>{formatExportDate(e.created_at)}</span>
                  <span style={{ color: '#e2e8f0' }}>·</span>
                  <span>{formatSize(e.size_bytes)}</span>
                  <span style={{ color: '#e2e8f0' }}>·</span>
                  {i === 0
                    ? <span style={{ padding: '1px 7px', borderRadius: 99, fontSize: 10, fontWeight: 500, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>Latest</span>
                    : <span style={{ padding: '1px 7px', borderRadius: 99, fontSize: 10, fontWeight: 500, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>Saved</span>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <a
                  href={e.public_url ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 5, height: 30, padding: '0 10px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#0369a1', textDecoration: 'none', whiteSpace: 'nowrap' }}
                >
                  <svg width="12" height="12" fill="none" stroke="#0284c7" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </a>
                <button
                  onClick={() => deleteExport(e.id)}
                  disabled={!!busy}
                  title="Delete this export"
                  style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', color: '#dc2626', flexShrink: 0 }}
                >
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          <div style={{ padding: '12px 20px', fontSize: 11, color: '#94a3b8', borderTop: '1px solid #f1f5f9', lineHeight: 1.5 }}>
            Each export is saved to Supabase Storage and linked to this run. A new export is saved automatically at the end of every pipeline run.
          </div>
        </div>
      )}
    </div>
  )
}
