'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
import { supabase } from '../lib/supabase'

type MasterClient = { id: number; client_name: string; website_url: string | null; niche: string | null; status: string | null }
type Seed = { keyword: string; relevance: 'core' | 'adjacent' | 'off-topic'; reason: string }
type Competitor = { name: string; domain: string; auto?: boolean }
type Item = {
  month_index: number; month_label: string; keyword: string; blog_title: string; why_useful: string
  intent: string; volume: number | null; kd: number | null; cpc: number | null; source: string; competitor: string | null
}
type RunResult = {
  round_id: number; items: Item[]; competitors: Competitor[]; warnings: string[]
  excluded: { topic: string; reason: string }[]; units_used: number
  summary: { total: number; mofu: number; bofu: number; pool: number }
}
type PastRound = { id: number; client_name: string | null; blogs_per_month: number; created_at: string }

const RELEVANCE_STYLE: Record<string, { bg: string; text: string }> = {
  'core':      { bg: '#f0fdf4', text: '#15803d' },
  'adjacent':  { bg: '#eff6ff', text: '#1d4ed8' },
  'off-topic': { bg: '#fef2f2', text: '#dc2626' },
}

const inp = 'w-full h-9 border border-gray-200 rounded-md px-3 text-sm text-gray-800 outline-none focus:ring-1 focus:ring-gray-400 bg-white placeholder-gray-300'
const btnDark = 'text-sm px-4 h-9 rounded-md bg-zinc-900 text-white font-medium disabled:opacity-40'
const btnLight = 'text-sm px-3 h-9 rounded-md border border-gray-300 bg-white text-gray-700 font-medium disabled:opacity-40'
const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 } as const
const label = { fontSize: 11, color: '#71717a', display: 'block', marginBottom: 4 } as const
const eyebrow = { fontSize: 10, color: '#71717a', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 } as const

async function postJson(url: string, body: any) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) { const e: any = new Error(json.error || `Request failed (${res.status})`); e.data = json; throw e }
  return json
}

export default function ContentCalendarPage() {
  const [clients, setClients] = useState<MasterClient[]>([])
  const [clientId, setClientId] = useState<number | ''>('')
  const [blogsPerMonth, setBlogsPerMonth] = useState(2)
  const [notes, setNotes] = useState('')
  const [notesSource, setNotesSource] = useState<'client' | 'strategist'>('strategist')

  const [seeds, setSeeds] = useState<Seed[] | null>(null)
  const [angle, setAngle] = useState('')
  const [summary, setSummary] = useState('')
  const [wantsCompetitors, setWantsCompetitors] = useState(true)
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [excludedTopics, setExcludedTopics] = useState<string[]>([])

  const [parsing, setParsing] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [popup, setPopup] = useState<{ title: string; body: string } | null>(null)
  const [past, setPast] = useState<PastRound[]>([])
  const seedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.from('master_clients').select('id, client_name, website_url, niche, status').order('client_name')
      .then(({ data }) => { if (data) setClients((data as MasterClient[]).filter(c => !/archiv|inactive/i.test(c.status || ''))) })
    loadPast()
  }, [])

  async function loadPast() {
    const { data } = await supabase.from('content_calendar_rounds')
      .select('id, client_name, blogs_per_month, created_at').order('created_at', { ascending: false }).limit(10)
    setPast((data || []) as PastRound[])
  }

  const totalPosts = blogsPerMonth * 12

  async function parseNotes() {
    if (!clientId || !notes.trim()) return
    setParsing(true); setError(null); setResult(null)
    try {
      const r = await postJson('/api/content-calendar/parse-notes', { client_id: clientId, notes: notes.trim() })
      setSeeds(r.seeds)
      setAngle(r.strategic_angle || '')
      setSummary(r.summary || '')
      setWantsCompetitors(!!r.wants_competitors)
      setExcludedTopics(r.excluded_topics || [])
      setCompetitors((r.competitors_mentioned || []).map((c: any) => ({
        name: String(typeof c === 'string' ? c : c?.name || ''), domain: String(typeof c === 'string' ? c : c?.domain || ''),
      })).filter((c: Competitor) => c.name || c.domain))
      setTimeout(() => seedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    } catch (e: any) { setError(e.message) }
    setParsing(false)
  }

  async function run() {
    const approved = (seeds || []).filter(s => s.relevance !== 'off-topic')
    if (approved.length === 0) { setError('No seeds approved — keep at least one before running.'); return }
    setRunning(true); setError(null)
    try {
      const r: RunResult = await postJson('/api/content-calendar/run', {
        client_id: clientId, blogs_per_month: blogsPerMonth, notes: notes.trim(), notes_source: notesSource,
        seeds: approved.map(s => s.keyword), competitors: competitors.filter(c => c.domain),
        check_competitors: wantsCompetitors, strategic_angle: angle, excluded_topics: excludedTopics,
      })
      setResult(r)
      loadPast()
    } catch (e: any) {
      if (e.data?.insufficient_credits) setPopup({ title: '⚠ Not enough Ahrefs units', body: e.message })
      else setError(e.message)
    }
    setRunning(false)
  }

  async function loadRound(id: number) {
    setError(null); setRunning(true)
    const { data: round } = await supabase.from('content_calendar_rounds').select('*').eq('id', id).single()
    const { data: items } = await supabase.from('content_calendar_items').select('*').eq('round_id', id).order('month_index').order('id')
    if (round) {
      const list = (items || []) as Item[]
      const mofu = list.filter(i => i.intent === 'MOFU').length
      setResult({
        round_id: id, items: list, competitors: round.competitors || [], warnings: round.warnings || [],
        excluded: round.excluded || [], units_used: round.ahrefs_units_used || 0,
        summary: { total: list.length, mofu, bofu: list.length - mofu, pool: (round.keyword_pool || []).length },
      })
      setNotes(round.notes || '')
      setBlogsPerMonth(round.blogs_per_month || 2)
    }
    setRunning(false)
  }

  const setSeed = (i: number, patch: Partial<Seed>) => setSeeds(s => (s || []).map((x, j) => j === i ? { ...x, ...patch } : x))
  const approvedCount = (seeds || []).filter(s => s.relevance !== 'off-topic').length

  // Group calendar items by month for display
  const byMonth = new Map<string, Item[]>()
  for (const it of result?.items || []) {
    if (!byMonth.has(it.month_label)) byMonth.set(it.month_label, [])
    byMonth.get(it.month_label)!.push(it)
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1180, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: '#18181b', marginBottom: 4 }}>Content Calendar Generator</h1>
      <p style={{ fontSize: 12, color: '#71717a', marginBottom: 24 }}>
        A new round of blog topics driven by your brief. Notes set the direction, relevance decides what survives, and the plan lands as a 12-month Excel calendar.
      </p>

      {error && <div style={{ fontSize: 13, color: '#dc2626', background: '#fef2f2', padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {/* Step 1 — setup */}
      <div style={{ ...card, padding: 18, marginBottom: 14 }}>
        <div style={{ ...eyebrow, marginBottom: 12 }}>Step 1 · Client &amp; brief</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={label}>Client</label>
            <select className={inp} value={clientId} onChange={e => { setClientId(Number(e.target.value) || ''); setSeeds(null); setResult(null) }}>
              <option value="">— select a client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.client_name}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Blogs per month</label>
            <input className={inp} type="number" min={1} max={10} value={blogsPerMonth}
              onChange={e => setBlogsPerMonth(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
          </div>
          <div>
            <label style={label}>Brief came from</label>
            <select className={inp} value={notesSource} onChange={e => setNotesSource(e.target.value as any)}>
              <option value="strategist">SEO strategist</option>
              <option value="client">Client request</option>
            </select>
          </div>
        </div>
        <label style={label}>Notes / brief <span style={{ color: '#cbd5e1' }}>— paste it as written; this drives the whole round</span></label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="e.g. Can you create a new batch of content topics? Check the competitors too. Include topics about cabinet shop, cabinet maker, and such to get ahead of the other shops in this area."
          style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: '#334155', outline: 'none', resize: 'vertical', lineHeight: 1.6 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button className={btnDark} onClick={parseNotes} disabled={!clientId || !notes.trim() || parsing}>
            {parsing ? 'Reading the brief…' : '→ Read the brief'}
          </button>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{blogsPerMonth} per month = <b>{totalPosts} posts</b> over 12 months</span>
        </div>
      </div>

      {/* Step 2 — seed review */}
      {seeds && (
        <div ref={seedRef} style={{ ...card, padding: 18, marginBottom: 14 }}>
          <div style={{ ...eyebrow, marginBottom: 4 }}>Step 2 · Review the seeds before spending</div>
          {summary && <div style={{ fontSize: 12, color: '#334155', marginBottom: 4 }}>{summary}</div>}
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
            Nothing has been fetched yet. Edit or drop seeds here — this is the cheap place to correct direction. Off-topic seeds are skipped and recorded with a reason.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {seeds.map((s, i) => {
              const st = RELEVANCE_STYLE[s.relevance] || RELEVANCE_STYLE.adjacent
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className={inp} value={s.keyword} onChange={e => setSeed(i, { keyword: e.target.value })} style={{ flex: 1 }} />
                  <select value={s.relevance} onChange={e => setSeed(i, { relevance: e.target.value as any })}
                    style={{ height: 36, fontSize: 11, fontWeight: 600, borderRadius: 6, padding: '0 8px', border: '1px solid #e2e8f0', cursor: 'pointer', ...st }}>
                    <option value="core">core</option>
                    <option value="adjacent">adjacent</option>
                    <option value="off-topic">off-topic</option>
                  </select>
                  {s.reason && <span title={s.reason} style={{ fontSize: 11, color: '#94a3b8', width: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.reason}</span>}
                  <button onClick={() => setSeeds(sd => (sd || []).filter((_, j) => j !== i))}
                    style={{ width: 32, height: 34, flexShrink: 0, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#dc2626', cursor: 'pointer' }}>×</button>
                </div>
              )
            })}
          </div>
          <button className={btnLight} style={{ height: 32 }} onClick={() => setSeeds(s => [...(s || []), { keyword: '', relevance: 'core', reason: '' }])}>+ Add seed</button>

          {/* Competitors */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer', marginBottom: 8 }}>
              <input type="checkbox" checked={wantsCompetitors} onChange={e => setWantsCompetitors(e.target.checked)} />
              Include competitor gap analysis
              {wantsCompetitors && competitors.length === 0 && <span style={{ fontSize: 11, color: '#94a3b8' }}>— none given, they&apos;ll be auto-derived from the seed SERPs</span>}
            </label>
            {wantsCompetitors && (
              <>
                {competitors.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input className={inp} placeholder="Competitor name" value={c.name} onChange={e => setCompetitors(cs => cs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                    <input className={inp} placeholder="competitor.com" value={c.domain} onChange={e => setCompetitors(cs => cs.map((x, j) => j === i ? { ...x, domain: e.target.value } : x))} />
                    <button onClick={() => setCompetitors(cs => cs.filter((_, j) => j !== i))}
                      style={{ width: 32, flexShrink: 0, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#dc2626', cursor: 'pointer' }}>×</button>
                  </div>
                ))}
                <button className={btnLight} style={{ height: 32 }} onClick={() => setCompetitors(cs => [...cs, { name: '', domain: '' }])}>+ Add competitor</button>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
            <button className={btnDark} onClick={run} disabled={running || approvedCount === 0}>
              {running ? 'Building the calendar…' : `▶ Build ${totalPosts}-post calendar`}
            </button>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{approvedCount} seed{approvedCount === 1 ? '' : 's'} approved</span>
            {running && <span style={{ fontSize: 12, color: '#2563eb' }}>Fetching keywords and planning four quarters — this takes a minute or two…</span>}
          </div>
        </div>
      )}

      {/* Past rounds */}
      {!result && past.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...eyebrow, marginBottom: 8 }}>Recent rounds</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {past.map(p => (
              <button key={p.id} className={btnLight} style={{ fontSize: 12 }} onClick={() => loadRound(p.id)}>
                {p.client_name} · {p.blogs_per_month}/mo · {new Date(p.created_at).toLocaleDateString()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 14 }}>
            <div style={{ ...card, padding: 14 }}><div style={eyebrow}>Posts planned</div><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{result.summary.total}</div></div>
            <div style={{ ...card, padding: 14 }}><div style={eyebrow}>MOFU / BOFU</div><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{result.summary.mofu} / {result.summary.bofu}</div></div>
            <div style={{ ...card, padding: 14 }}><div style={eyebrow}>Keyword pool</div><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{result.summary.pool}</div></div>
            <div style={{ ...card, padding: 14 }}><div style={eyebrow}>Ahrefs units</div><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{result.units_used.toLocaleString()}</div></div>
          </div>

          {result.warnings.length > 0 && (
            <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '8px 12px', borderRadius: 8, marginBottom: 14 }}>
              {result.warnings.map((w, i) => <div key={i}>• {w}</div>)}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            {result.competitors.length > 0 && (
              <span style={{ fontSize: 12, color: '#52525b' }}>
                Competitors: {result.competitors.map(c => c.domain).join(', ')}
                {result.competitors.some(c => c.auto) && <span style={{ color: '#94a3b8' }}> (auto-derived)</span>}
              </span>
            )}
            <a href={`/api/content-calendar/export?round_id=${result.round_id}`} className={btnDark}
              style={{ marginLeft: 'auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>⬇ Download Excel</a>
            <button className={btnLight} onClick={() => { setResult(null); setSeeds(null) }}>← New round</button>
          </div>

          {/* Calendar grouped by month */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: '#18181b' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#71717a', textAlign: 'left', fontSize: 10 }}>
                  <th style={{ padding: '9px 14px', width: 150 }}>Keyword</th>
                  <th style={{ padding: '9px 10px' }}>Blog Title</th>
                  <th style={{ padding: '9px 10px', width: 300 }}>Why it&apos;s useful</th>
                  <th style={{ padding: '9px 8px', width: 55 }}>Intent</th>
                  <th style={{ padding: '9px 8px', width: 62, textAlign: 'right' }}>Vol</th>
                  <th style={{ padding: '9px 8px', width: 40, textAlign: 'right' }}>KD</th>
                  <th style={{ padding: '9px 10px', width: 130 }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {[...byMonth.entries()].map(([month, rows]) => (
                  <Fragment key={month}>
                    <tr style={{ background: '#f8fafc' }}>
                      <td colSpan={7} style={{ padding: '7px 14px', fontWeight: 600, fontSize: 11, color: '#4338ca' }}>{month} · {rows.length} post{rows.length === 1 ? '' : 's'}</td>
                    </tr>
                    {rows.map((it, i) => (
                      <tr key={`${month}-${i}`} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                        <td style={{ padding: '9px 14px', color: '#52525b' }}>{it.keyword}</td>
                        <td style={{ padding: '9px 10px', fontWeight: 500 }}>{it.blog_title}</td>
                        <td style={{ padding: '9px 10px', color: '#64748b', lineHeight: 1.5 }}>{it.why_useful}</td>
                        <td style={{ padding: '9px 8px' }}>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: it.intent === 'BOFU' ? '#f0fdf4' : '#eff6ff', color: it.intent === 'BOFU' ? '#15803d' : '#1d4ed8' }}>{it.intent}</span>
                        </td>
                        <td style={{ padding: '9px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.volume ?? '—'}</td>
                        <td style={{ padding: '9px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.kd ?? '—'}</td>
                        <td style={{ padding: '9px 10px', fontSize: 10, color: '#94a3b8' }}>
                          {it.source}{it.competitor ? <div style={{ color: '#ea580c' }}>{it.competitor}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {result.excluded.length > 0 && (
            <div style={{ ...card, padding: 16, marginTop: 14 }}>
              <div style={{ ...eyebrow, marginBottom: 8 }}>Not included (and why)</div>
              {result.excluded.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: '#52525b', marginBottom: 4 }}><b>{e.topic}</b> — {e.reason}</div>
              ))}
            </div>
          )}
        </>
      )}

      {popup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(24,24,27,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '22px 24px', width: 440, maxWidth: 'calc(100vw - 48px)', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#b45309', marginBottom: 10 }}>{popup.title}</div>
            <div style={{ fontSize: 13, color: '#52525b', lineHeight: 1.6, marginBottom: 18 }}>{popup.body}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button onClick={() => setPopup(null)} className={btnDark}>Got it</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
