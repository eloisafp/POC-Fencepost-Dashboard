'use client'

import { useState, useEffect, useCallback } from 'react'
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

type MasterClient = { client_name: string; intake_form_link: string | null; content_guidelines_url: string | null }
type ContentPlanItem = { id: number; title: string; content_track: string; status: string; page_status: string | null; volume: number | null; kd: number | null }

const TABS = ['Intake', 'Keywords', 'Clusters', 'Content Plan', 'Export'] as const
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
type Phase1Steps = { intake: StepStatus; guidelines: StepStatus; seeds: StepStatus; competitors: StepStatus }

export default function RunWorkspace({ runId, onBack }: { runId: number; onBack: () => void }) {
  const [run, setRun]       = useState<Run | null>(null)
  const [client, setClient] = useState<MasterClient | null>(null)
  const [tab, setTab]       = useState<Tab>('Intake')
  const [busy, setBusy]     = useState<string | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [seeds, setSeeds]   = useState<any>(null)
  const [phase1Steps, setPhase1Steps] = useState<Phase1Steps>({ intake: 'pending', guidelines: 'pending', seeds: 'pending', competitors: 'pending' })

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
  }, [tab, runId, loadKeywords, loadClusters])

  async function run_(action: string, fn: () => Promise<void>) {
    setBusy(action); setError(null)
    try { await fn() } catch (e: any) { setError(e.message) }
    setBusy(null)
  }

  async function runPhase1() {
    if (!client?.intake_form_link) return
    setBusy('phase1'); setError(null)
    setPhase1Steps({ intake: 'pending', guidelines: 'pending', seeds: 'pending', competitors: 'pending' })

    let currentRun = run!
    let currentSeeds: any = null

    // Step 1 — intake
    setPhase1Steps(s => ({ ...s, intake: 'running' }))
    try {
      const r = await postJson('/api/keyword-pipeline/intake', { run_id: runId })
      currentRun = { ...currentRun, intake: r.intake }
      setRun(currentRun)
      setPhase1Steps(s => ({ ...s, intake: 'done' }))
    } catch (e: any) {
      setPhase1Steps(s => ({ ...s, intake: 'error' }))
      setError(`Intake: ${e.message}`)
      setBusy(null); return
    }

    // Step 2 — guidelines (optional, never blocks)
    setPhase1Steps(s => ({ ...s, guidelines: 'running' }))
    try {
      const r = await postJson('/api/keyword-pipeline/guidelines', { run_id: runId })
      currentRun = { ...currentRun, content_guidelines: r.content_guidelines }
      setRun(currentRun)
      setPhase1Steps(s => ({ ...s, guidelines: 'done' }))
    } catch {
      setPhase1Steps(s => ({ ...s, guidelines: 'error' }))
    }

    // Step 3 — seeds
    setPhase1Steps(s => ({ ...s, seeds: 'running' }))
    try {
      const r = await postJson('/api/keyword-pipeline/seeds', { run_id: runId })
      currentSeeds = r.seeds
      setSeeds(currentSeeds)
      setPhase1Steps(s => ({ ...s, seeds: 'done' }))
    } catch (e: any) {
      setPhase1Steps(s => ({ ...s, seeds: 'error' }))
      setError(`Seeds: ${e.message}`)
      setBusy(null); return
    }

    // Step 4 — competitors
    setPhase1Steps(s => ({ ...s, competitors: 'running' }))
    try {
      const r = await postJson('/api/keyword-pipeline/competitors', { run_id: runId, seeds: currentSeeds })
      currentRun = { ...currentRun, competitors: r.competitors }
      setRun(currentRun)
      setPhase1Steps(s => ({ ...s, competitors: 'done' }))
    } catch (e: any) {
      setPhase1Steps(s => ({ ...s, competitors: 'error' }))
      setError(`Competitors: ${e.message}`)
    }

    setBusy(null)
  }

  async function runPhase3() {
    setBusy('phase3'); setError(null)
    try {
      await postJson('/api/keyword-pipeline/cluster', { run_id: runId })
      setRun(prev => prev ? { ...prev, phase: 'clusters' } : prev)
      await loadClusters()
    } catch (e: any) {
      setError(e.message)
    }
    setBusy(null)
  }

  async function runPhase2() {
    setBusy('phase2'); setError(null); setKwSummary(null)
    try {
      const r = await postJson('/api/keyword-pipeline/keywords', { run_id: runId })
      setKwSummary(r)
      setRun(prev => prev ? { ...prev, phase: 'keywords' } : prev)
      await loadKeywords()
    } catch (e: any) {
      setError(e.message)
    }
    setBusy(null)
  }

  if (!run) return <div style={{ padding: 24, fontSize: 12, color: '#94a3b8' }}>Loading…</div>

  return (
    <div style={{ padding: 24, maxWidth: 860 }}>
      <button onClick={onBack} style={{ fontSize: 11, color: '#71717a', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12 }}>← Back</button>
      <h1 style={{ fontSize: 16, fontWeight: 600, color: '#18181b', marginBottom: 16 }}>{run.client_slug}</h1>

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

      {error && tab !== 'Intake' && <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>{error}</div>}

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

          {/* Run Phase 1 button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              disabled={!client?.intake_form_link || busy === 'phase1'}
              onClick={runPhase1}
              className="text-xs px-4 py-2 rounded-md bg-zinc-900 text-white disabled:opacity-40 font-medium"
            >
              {busy === 'phase1' ? 'Running…' : run.intake ? '↺ Re-run Phase 1' : '▶ Run Phase 1'}
            </button>
            {!client?.intake_form_link && <span style={{ fontSize: 11, color: '#f87171' }}>Intake form link required</span>}
          </div>

          {/* Step progress (visible once started) */}
          {(busy === 'phase1' || phase1Steps.intake !== 'pending') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {([
                { key: 'intake',      label: 'Parse Intake' },
                { key: 'guidelines',  label: 'Parse Guidelines' },
                { key: 'seeds',       label: 'Generate Seeds' },
                { key: 'competitors', label: 'Resolve Competitors' },
              ] as { key: keyof Phase1Steps; label: string }[]).map(({ key, label }) => {
                const s = phase1Steps[key]
                const color = s === 'done' ? '#16a34a' : s === 'error' ? '#dc2626' : s === 'running' ? '#2563eb' : '#94a3b8'
                const icon  = s === 'done' ? '✓' : s === 'error' ? '✕' : s === 'running' ? '…' : '○'
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ color, fontWeight: 600, width: 14, textAlign: 'center' }}>{icon}</span>
                    <span style={{ color: s === 'pending' ? '#94a3b8' : '#18181b' }}>{label}</span>
                  </div>
                )
              })}
            </div>
          )}

          {error && <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 6 }}>{error}</div>}

          {/* Results */}
          {run.intake && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', marginBottom: 6 }}>Parsed intake</div>
              <pre style={{ fontSize: 11, background: '#f8fafc', border: '1px solid #e2e8f0', padding: 10, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(run.intake, null, 2)}</pre>
            </div>
          )}
          {run.content_guidelines && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', marginBottom: 6 }}>Parsed guidelines</div>
              <pre style={{ fontSize: 11, background: '#f8fafc', border: '1px solid #e2e8f0', padding: 10, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(run.content_guidelines, null, 2)}</pre>
            </div>
          )}
          {seeds && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', marginBottom: 6 }}>Seeds</div>
              <pre style={{ fontSize: 11, background: '#f8fafc', border: '1px solid #e2e8f0', padding: 10, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(seeds, null, 2)}</pre>
            </div>
          )}
          {run.competitors && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', marginBottom: 6 }}>Competitors</div>
              {run.competitors?.has_auto_derived && (
                <div style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', padding: '8px 12px', borderRadius: 6, marginBottom: 8 }}>
                  Fewer than 2 clean competitors found — manual entry may be needed.
                </div>
              )}
              <pre style={{ fontSize: 11, background: '#f8fafc', border: '1px solid #e2e8f0', padding: 10, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(run.competitors, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {tab === 'Keywords' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              disabled={!seeds || busy === 'phase2'}
              onClick={runPhase2}
              className="text-xs px-4 py-2 rounded-md bg-zinc-900 text-white disabled:opacity-40 font-medium"
            >
              {busy === 'phase2' ? 'Fetching from Ahrefs… (takes a minute)' : kwCount > 0 ? '↺ Re-run Phase 2' : '▶ Run Phase 2 — Fetch Keywords'}
            </button>
            {!seeds && <span style={{ fontSize: 11, color: '#f87171' }}>Run Phase 1 first — seeds are required</span>}
            {kwCount > 0 && busy !== 'phase2' && <span style={{ fontSize: 11, color: '#71717a' }}>{kwCount} keywords stored</span>}
          </div>

          {busy === 'phase2' && (
            <div style={{ fontSize: 12, color: '#2563eb', background: '#eff6ff', padding: '8px 12px', borderRadius: 6 }}>
              Running 3 jobs: seed expansion → competitor gap → site audit. Re-running replaces previous keywords for this run.
            </div>
          )}

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
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
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
                      <td style={{ padding: '6px 8px', color: '#71717a' }}>{k.search_intent ?? '—'}</td>
                      <td style={{ padding: '6px 8px', color: '#71717a' }}>{k.source ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {keywords.length === 0 && busy !== 'phase2' && (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>No keywords yet — run Phase 2 to fetch from Ahrefs.</div>
          )}
        </div>
      )}

      {tab === 'Clusters' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              disabled={kwCount === 0 || busy === 'phase3'}
              onClick={runPhase3}
              className="text-xs px-4 py-2 rounded-md bg-zinc-900 text-white disabled:opacity-40 font-medium"
            >
              {busy === 'phase3' ? 'Clustering with AI…' : clusters.length > 0 ? '↺ Re-run Phase 3' : '▶ Run Phase 3 — Cluster Keywords'}
            </button>
            {kwCount === 0 && <span style={{ fontSize: 11, color: '#f87171' }}>Run Phase 2 first — keywords are required</span>}
            {clusters.length > 0 && busy !== 'phase3' && (
              <span style={{ fontSize: 11, color: '#71717a' }}>
                {clusters.length} clusters · {kwCount - unclustered} of {kwCount} keywords assigned
              </span>
            )}
          </div>

          {busy === 'phase3' && (
            <div style={{ fontSize: 12, color: '#2563eb', background: '#eff6ff', padding: '8px 12px', borderRadius: 6 }}>
              Claude is filtering and clustering {kwCount} keywords — this takes a minute. Re-running replaces existing clusters.
            </div>
          )}

          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
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
                      <td style={{ padding: '6px 8px', color: '#71717a' }}>{c.service_category ?? '—'}</td>
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
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
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
      )}

      {tab === 'Export' && (
        <div>
          <div style={{ fontSize: 12, color: '#71717a', marginBottom: 12 }}>
            Downloads a multi-tab Excel workbook (Content Calendar, KW Summary, All Keywords, Keyword Map, one tab per cluster). Empty tabs are expected until Phases 2–4 have populated data.
          </div>
          <a
            href={`/api/keyword-pipeline/export?run_id=${runId}`}
            className="text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white inline-block"
          >
            Download Excel Workbook
          </a>
        </div>
      )}
    </div>
  )
}
