// Generates a self-contained client review HTML page.
// All CSS and JS are inline — the file can be emailed or opened directly in a browser.

type Block =
  | { type: 'h1';        text: string }
  | { type: 'h2';        text: string }
  | { type: 'h3';        text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list';      items: string[] }
  | { type: 'cta';       text: string }
  | { type: 'image';     caption: string }
  | { type: 'step';      number: number; title: string; body: string }
  | { type: 'faq';       question: string; answer: string }
  | { type: 'twocol';    left: Block[]; right: Block[]; leftWidth?: number }

type SEOMeta = { titleTag: string; metaDescription: string; urlSlug: string }
type Form = {
  companyName: string; service: string; city: string; state: string
  subServices: string; websiteUrl: string
}

function blockToHtml(block: Block, mapUrl: string): string {
  switch (block.type) {
    case 'h1':
      return `<h1>${block.text}</h1>`
    case 'h2':
      return `<h2>${block.text}</h2>`
    case 'h3':
      return `<h3>${block.text}</h3>`
    case 'paragraph':
      return `<p>${block.text}</p>`
    case 'list':
      return `<ul>${block.items.map(i => `<li>${i}</li>`).join('')}</ul>`
    case 'cta': {
      if (block.text.startsWith('BUTTON:')) {
        const raw      = block.text.slice('BUTTON:'.length).trim()
        const pipeIdx  = raw.indexOf('|')
        const btnText  = (pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw).trim() || 'Contact Us'
        const btnUrl   = (pipeIdx >= 0 ? raw.slice(pipeIdx + 1) : '').trim() || '#'
        return `<div class="cta-wrap"><a href="${btnUrl}" class="cta-btn" target="_blank" rel="noopener noreferrer">${btnText}</a></div>`
      }
      return `<div class="cta-wrap"><a href="#" class="cta-btn">${block.text}</a></div>`
    }
    case 'image': {
      if (block.caption.trim().startsWith('<')) {
        const escaped = block.caption
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
        return `<div class="html-embed">${block.caption}</div>
<div class="embed-code-block">
  <div class="embed-code-label">Embed code</div>
  <pre class="embed-code-pre"><code>${escaped}</code></pre>
  <button class="embed-copy-btn" onclick="navigator.clipboard.writeText(this.closest('.embed-code-block').querySelector('code').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy code'},2000)})">Copy code</button>
</div>`
      }
      const isMap = /map|google|location|embed/i.test(block.caption)
      if (isMap && mapUrl) {
        const iframeHtml = `<iframe src="${mapUrl}" width="100%" height="300" frameborder="0" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`
        const iframeEscaped = iframeHtml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        return `<div class="map-wrap">
  <iframe src="${mapUrl}" width="100%" height="300" style="border:0;display:block" loading="lazy" allowfullscreen title="Location map"></iframe>
</div>
<div class="embed-code-block">
  <div class="embed-code-label">Embed code</div>
  <pre class="embed-code-pre"><code>${iframeEscaped}</code></pre>
  <button class="embed-copy-btn" onclick="navigator.clipboard.writeText(this.closest('.embed-code-block').querySelector('code').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy code'},2000)})">Copy code</button>
</div>`
      }
      return `<div class="img-placeholder">
  <svg width="36" height="36" fill="none" stroke="#94a3b8" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
  <p>${block.caption}</p>
</div>`
    }
    case 'step':
      return `<div class="step"><div class="step-num">${block.number}</div><div class="step-body"><strong>${block.title}</strong><p>${block.body}</p></div></div>`
    case 'faq':
      return `<div class="faq"><p class="faq-q">${block.question}</p><p class="faq-a">${block.answer}</p></div>`
    case 'twocol': {
      const lw = block.leftWidth ?? 45
      const leftHtml  = block.left.map(b => blockToHtml(b, mapUrl)).join('')
      const rightHtml = block.right.map(b => blockToHtml(b, mapUrl)).join('')
      return `<table class="two-col-table"><tbody><tr>
  <td style="width:${lw}%;vertical-align:top;padding-right:24px;border:1px solid white">${leftHtml}</td>
  <td style="width:${100 - lw}%;vertical-align:top;border:1px solid white">${rightHtml}</td>
</tr></tbody></table>`
    }
    default:
      return ''
  }
}

type Section = { id: string; heading: string | null; innerHtml: string }

function groupIntoSections(blocks: Block[], mapUrl: string): Section[] {
  const sections: Section[] = []
  let current: Section = { id: 'section-hero', heading: null, innerHtml: '' }
  let idx = 0

  for (const block of blocks) {
    if (block.type === 'h2') {
      sections.push(current)
      idx++
      current = { id: `section-${idx}`, heading: block.text, innerHtml: '' }
    } else if (block.type === 'twocol') {
      // A twocol whose right side starts with an h2 acts as a section boundary
      const firstRight = block.right[0]
      if (firstRight?.type === 'h2') {
        sections.push(current)
        idx++
        const heading = firstRight.text
        const restRight = block.right.slice(1)
        const twoColBlock: Block = { type: 'twocol', left: block.left, right: restRight, leftWidth: block.leftWidth }
        current = { id: `section-${idx}`, heading, innerHtml: blockToHtml(twoColBlock, mapUrl) }
      } else {
        current.innerHtml += blockToHtml(block, mapUrl)
      }
    } else {
      current.innerHtml += blockToHtml(block, mapUrl)
    }
  }
  sections.push(current)
  return sections.filter(s => s.innerHtml || s.heading)
}

export function generateClientHTML(seo: SEOMeta, blocks: Block[], form: Form): string {
  const mapUrl = `https://maps.google.com/maps?q=${encodeURIComponent(form.city + ' ' + form.state)}&output=embed`
  const sections = groupIntoSections(blocks, mapUrl)
  const storageKey = `review_${(seo.urlSlug || form.service + form.city).replace(/[^a-z0-9]/gi, '_')}`
  const reviewDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const pageTitle = seo.titleTag || `${form.service} in ${form.city}, ${form.state}`

  const sectionsHtml = sections.map(sec => `
<section class="page-section" id="${sec.id}">
  ${sec.heading ? `<div class="section-inner"><h2>${sec.heading}</h2>` : '<div class="section-inner">'}
  ${sec.innerHtml}
  </div>
  <div class="section-note">
    <button class="note-toggle" onclick="toggleNote('${sec.id}')" data-id="${sec.id}">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      <span class="note-label">Leave a note</span>
    </button>
    <div class="note-area" id="note-area-${sec.id}" style="display:none">
      <textarea id="note-ta-${sec.id}" rows="3" placeholder="Type your feedback here…" oninput="saveNote('${sec.id}', this.value)"></textarea>
      <span class="note-saved" id="note-saved-${sec.id}"></span>
    </div>
  </div>
</section>`).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle} — Draft for Review</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Segoe UI',Inter,Helvetica,sans-serif;background:#f8fafc;color:#1e293b}

/* ── Review banner ── */
#review-bar{
  background:#18181b;color:#fff;font-size:12px;padding:10px 24px;
  display:flex;align-items:center;justify-content:space-between;gap:16px;position:sticky;top:0;z-index:100
}
#review-bar span{opacity:.6}
.review-actions{display:flex;gap:8px;align-items:center}
.review-actions button{
  background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;
  font-size:11px;padding:5px 12px;border-radius:5px;cursor:pointer;transition:.15s
}
.review-actions button:hover{background:rgba(255,255,255,.22)}
#note-count-badge{
  background:#3b82f6;color:#fff;font-size:10px;font-weight:600;
  padding:2px 7px;border-radius:20px;display:none
}

/* ── Fake header ── */
.site-header{
  background:#fff;border-bottom:1px solid #e2e8f0;padding:0 40px;height:64px;
  display:flex;align-items:center;justify-content:space-between
}
.site-logo{font-size:17px;font-weight:700;color:#0f172a;letter-spacing:-.02em}
.site-nav{display:flex;gap:24px}
.site-nav a{font-size:13px;color:#64748b;text-decoration:none}
.site-nav a:hover{color:#0f172a}
.site-cta{
  background:#18181b;color:#fff;font-size:12px;font-weight:500;
  padding:8px 18px;border-radius:6px;text-decoration:none
}

/* ── Page layout ── */
.page-main{max-width:860px;margin:0 auto;padding:0 32px 80px}

/* ── Sections ── */
.page-section{position:relative;padding:0 0 8px}
.section-inner{padding:40px 0 0}
.section-inner > h2{
  font-size:21px;font-weight:650;color:#0f172a;margin-bottom:14px;
  padding-bottom:10px;border-bottom:2px solid #e2e8f0
}
.section-inner > h1{font-size:32px;font-weight:700;color:#0f172a;line-height:1.2;margin-bottom:20px}
.section-inner > h3{font-size:14px;font-weight:600;color:#334155;margin:16px 0 6px}
.section-inner > p{font-size:14.5px;color:#475569;line-height:1.8;margin-bottom:12px}
.section-inner > ul{margin:6px 0 16px;padding:0}
.section-inner > ul li{
  display:flex;align-items:flex-start;gap:10px;
  font-size:14.5px;color:#475569;line-height:1.75;margin-bottom:8px
}
.section-inner > ul li::before{content:"•";color:#3b82f6;font-weight:700;flex-shrink:0;margin-top:2px}

/* ── HTML embed ── */
.html-embed{margin:16px 0;border-radius:12px;overflow:hidden}
.html-embed iframe{display:block;width:100%}
.embed-code-block{margin:8px 0 16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.embed-code-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.embed-code-pre{margin:0;padding:10px 12px;background:#f8fafc;overflow-x:auto}
.embed-code-pre code{font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:11px;color:#475569;white-space:pre-wrap;word-break:break-all}
.embed-copy-btn{display:block;width:100%;padding:7px;font-size:11px;color:#64748b;background:#fff;border:none;border-top:1px solid #e2e8f0;cursor:pointer;transition:.15s}
.embed-copy-btn:hover{background:#f1f5f9;color:#0f172a}

/* ── Two-column layout ── */
.two-col-table{width:100%;border-collapse:collapse;margin:20px 0}
.two-col-table td{vertical-align:top;border:1px solid white}

/* ── Map ── */
.map-wrap{border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;margin:16px 0 8px}

/* ── Image placeholder ── */
.img-placeholder{
  background:#f1f5f9;border:2px dashed #cbd5e1;border-radius:12px;
  padding:40px 24px;text-align:center;margin:16px 0;color:#94a3b8
}
.img-placeholder p{font-size:13px;margin-top:10px;line-height:1.5}

/* ── CTA buttons ── */
.cta-wrap{margin:18px 0}
.cta-btn{
  display:inline-block;background:#18181b;color:#fff;font-size:13.5px;
  font-weight:500;padding:12px 26px;border-radius:7px;text-decoration:none;
  letter-spacing:-.01em;transition:.15s
}
.cta-btn:hover{background:#374151}

/* ── Steps ── */
.step{
  display:flex;gap:14px;background:#f8fafc;border:1px solid #f1f5f9;
  border-radius:10px;padding:14px 16px;margin-bottom:10px
}
.step-num{
  width:30px;height:30px;border-radius:50%;background:#18181b;color:#fff;
  font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0
}
.step-body strong{font-size:14px;color:#1e293b;display:block;margin-bottom:5px}
.step-body p{font-size:13px;color:#64748b;line-height:1.75;margin:0}

/* ── FAQ ── */
.faq{border-top:1px solid #f1f5f9;padding:16px 0}
.faq-q{font-size:14.5px;font-weight:600;color:#1e293b;margin-bottom:7px}
.faq-a{font-size:14px;color:#64748b;line-height:1.75}

/* ── Section notes ── */
.section-note{padding:10px 0 0;border-top:1px dashed #e2e8f0;margin-top:4px}
.note-toggle{
  display:flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8;
  background:none;border:1px solid #e2e8f0;border-radius:6px;padding:5px 10px;
  cursor:pointer;transition:.15s
}
.note-toggle:hover,.note-toggle.has-note{color:#3b82f6;border-color:#bfdbfe;background:#eff6ff}
.note-toggle.has-note .note-label::after{content:" (note added)";font-size:10px;opacity:.7}
.note-area{margin-top:8px}
.note-area textarea{
  width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;
  font-size:13px;color:#374151;line-height:1.6;resize:vertical;outline:none;
  font-family:inherit;min-height:80px;background:#fff
}
.note-area textarea:focus{border-color:#93c5fd;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
.note-saved{font-size:11px;color:#16a34a;display:inline-block;margin-top:4px;height:16px}

/* ── Footer ── */
.site-footer{
  background:#f1f5f9;border-top:1px solid #e2e8f0;padding:28px 40px;
  text-align:center;font-size:12px;color:#94a3b8;line-height:1.8
}

/* ── All notes panel ── */
#all-notes-panel{
  display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:200;
  align-items:center;justify-content:center
}
#all-notes-panel.open{display:flex}
.notes-modal{
  background:#fff;border-radius:16px;max-width:600px;width:100%;max-height:80vh;
  display:flex;flex-direction:column;overflow:hidden;margin:16px
}
.notes-modal-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 20px;border-bottom:1px solid #f1f5f9
}
.notes-modal-header h3{font-size:14px;font-weight:600;color:#1e293b}
.notes-modal-header button{
  background:none;border:none;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1
}
.notes-modal-body{padding:16px 20px;overflow-y:auto;flex:1}
.notes-modal-body .note-item{margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #f1f5f9}
.notes-modal-body .note-item:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}
.notes-modal-body .note-section-title{font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px}
.notes-modal-body .note-text{font-size:13.5px;color:#374151;line-height:1.6}
.notes-modal-body .empty-state{text-align:center;color:#94a3b8;font-size:13px;padding:24px 0}
.notes-modal-footer{padding:12px 20px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px}
.notes-modal-footer button{
  font-size:12px;padding:7px 14px;border-radius:6px;cursor:pointer;border:1px solid #e2e8f0;background:#fff;color:#374151
}
.notes-modal-footer .copy-btn{background:#18181b;color:#fff;border-color:#18181b}
</style>
</head>
<body>

<!-- Review banner -->
<div id="review-bar">
  <div>
    <strong>${pageTitle}</strong>
    <span>  |  Page For Review  |  ${reviewDate}</span>
  </div>
  <div class="review-actions">
    <span id="note-count-badge">0 notes</span>
    <button onclick="openNotesPanel()">📋 View all notes</button>
    <button onclick="copyAllNotes()">Copy feedback</button>
  </div>
</div>

<!-- Fake site header -->
<header class="site-header">
  <div class="site-logo">${form.companyName}</div>
  <nav class="site-nav">
    <a href="#">Home</a>
    <a href="#">Services</a>
    <a href="#">About</a>
    <a href="#">Contact</a>
  </nav>
  <a href="#" class="site-cta">Get a Free Quote</a>
</header>

<!-- Page content -->
<div class="page-main">
  ${sectionsHtml}
</div>

<!-- Footer -->
<footer class="site-footer">
  <p><strong>${form.companyName}</strong> · ${form.city}, ${form.state}</p>
  <p style="margin-top:4px">Prepared by Fencepost · ${reviewDate}</p>
</footer>

<!-- All notes panel -->
<div id="all-notes-panel" onclick="closeNotesPanel(event)">
  <div class="notes-modal">
    <div class="notes-modal-header">
      <h3>Review Notes</h3>
      <button onclick="closeNotesPanel()">✕</button>
    </div>
    <div class="notes-modal-body" id="notes-modal-body"></div>
    <div class="notes-modal-footer">
      <button onclick="closeNotesPanel()">Close</button>
      <button class="copy-btn" onclick="copyAllNotes()">📋 Copy all notes</button>
    </div>
  </div>
</div>

<script>
const STORAGE_KEY = '${storageKey}';
const notes = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

function saveNote(id, text) {
  notes[id] = text;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  updateBadge();
  const saved = document.getElementById('note-saved-' + id);
  if (saved) { saved.textContent = 'Saved'; setTimeout(() => saved.textContent = '', 2000); }
}

function toggleNote(id) {
  const area = document.getElementById('note-area-' + id);
  const isOpen = area.style.display !== 'none';
  area.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    const ta = document.getElementById('note-ta-' + id);
    ta.value = notes[id] || '';
    ta.focus();
  }
}

function updateBadge() {
  const count = Object.values(notes).filter(v => v && v.trim()).length;
  const badge = document.getElementById('note-count-badge');
  badge.textContent = count + ' note' + (count !== 1 ? 's' : '');
  badge.style.display = count > 0 ? 'inline-block' : 'none';
  // Update toggle button styles
  Object.keys(notes).forEach(id => {
    if (notes[id] && notes[id].trim()) {
      const btn = document.querySelector('[data-id="' + id + '"]');
      if (btn) btn.classList.add('has-note');
    }
  });
}

function openNotesPanel() {
  const body = document.getElementById('notes-modal-body');
  const entries = Object.entries(notes).filter(([, v]) => v && v.trim());
  if (!entries.length) {
    body.innerHTML = '<div class="empty-state">No notes added yet.<br>Scroll through the page and use the note buttons to leave feedback.</div>';
  } else {
    body.innerHTML = entries.map(([id, text]) => {
      const sec = document.getElementById(id);
      const title = sec ? (sec.querySelector('h2, h1') ? sec.querySelector('h2, h1').textContent : id) : id;
      return '<div class="note-item"><div class="note-section-title">' + title + '</div><div class="note-text">' + text + '</div></div>';
    }).join('');
  }
  document.getElementById('all-notes-panel').classList.add('open');
}

function closeNotesPanel(e) {
  if (!e || e.target === document.getElementById('all-notes-panel') || e.currentTarget === document.querySelector('.notes-modal-header button')) {
    document.getElementById('all-notes-panel').classList.remove('open');
  }
}

function copyAllNotes() {
  const entries = Object.entries(notes).filter(([, v]) => v && v.trim());
  if (!entries.length) { alert('No notes to copy yet.'); return; }
  let text = 'Review Notes — ${pageTitle}\\n${reviewDate}\\n' + '─'.repeat(50) + '\\n\\n';
  entries.forEach(([id, note]) => {
    const sec = document.getElementById(id);
    const title = sec ? (sec.querySelector('h2, h1') ? sec.querySelector('h2, h1').textContent : id) : id;
    text += title + ':\\n' + note + '\\n\\n';
  });
  navigator.clipboard.writeText(text).then(() => alert('Feedback copied! Paste it into an email to send back to your team.'));
}

// Restore saved notes on load
window.addEventListener('DOMContentLoaded', () => {
  updateBadge();
  Object.entries(notes).forEach(([id, text]) => {
    if (text && text.trim()) {
      const btn = document.querySelector('[data-id="' + id + '"]');
      if (btn) btn.classList.add('has-note');
    }
  });
});
</script>
</body>
</html>`
}
