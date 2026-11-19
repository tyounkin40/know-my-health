/* Prior Auth Timestamp Tracker — Mosaic Life Tech
 * Static, browser-only app. All data is stored in this browser (localStorage).
 * No build step, no dependencies. */
'use strict';

/* ---------------------------------------------------------------- constants */
const STORE_KEY = 'mlt-pa-clock-v1';
const HOUR = 3600e3;

// Default program rules. Every value is editable in Settings and must be
// confirmed for the organization's state(s), programs and contracts.
const DEFAULT_RULES = [
  { program: 'Medicare Advantage', std: 168, exp: 72, rfi: 168, appealDays: 65, basis: 'CMS-0057-F: 7 calendar days / 72 hours for items and services (drugs excluded). Appeal window 65 days — confirm' },
  { program: 'Medicare Advantage – Part B drugs', std: 72, exp: 24, rfi: 168, appealDays: 65, basis: 'Drugs are excluded from CMS-0057-F; MA Part B drug rules: 72 hours / 24 hours — verify' },
  { program: 'Medicaid fee-for-service', std: 168, exp: 72, rfi: 168, appealDays: 60, basis: 'CMS-0057-F; state law may set shorter windows. Fair hearing window is set by the state (up to 90 days)' },
  { program: 'Medicaid managed care', std: 168, exp: 72, rfi: 168, appealDays: 60, basis: 'CMS-0057-F; state contract may set shorter windows. Plan appeal within 60 days' },
  { program: 'CHIP fee-for-service', std: 168, exp: 72, rfi: 168, appealDays: 60, basis: 'CMS-0057-F; appeal window set by the state — confirm' },
  { program: 'CHIP managed care', std: 168, exp: 72, rfi: 168, appealDays: 60, basis: 'CMS-0057-F; appeal window set by the state — confirm' },
  { program: 'QHP – Federally-facilitated Exchange', std: 360, exp: 72, rfi: 168, appealDays: 180, basis: 'Not covered by CMS-0057-F timeframes; ACA baseline 15 days / 72 hours — verify state law' },
  { program: 'Commercial / state-regulated', std: 360, exp: 72, rfi: 168, appealDays: 180, basis: 'ERISA/ACA baseline 15 days / 72 hours; many states are shorter — verify' },
];

const EVENTS = {
  payer: [
    { t: 'Request received', h: 'The moment the PA request first arrived (not when it was opened)', d: 'Intake reference #' },
    { t: 'Information requested (RFI sent)', h: 'When the request for more information was generated and sent', d: 'Channel + recipient' },
    { t: 'Response received', h: "When the provider's response to the RFI was received", d: 'How received / reference #' },
    { t: 'Decision made', h: 'When the determination was made; timeframe that applied', d: 'Reviewer / determination ID' },
    { t: 'Notice sent', h: 'When the written notice went out', d: 'Proof of delivery' },
  ],
  provider: [
    { t: 'Request submitted', h: 'When the payer received it — use the submission confirmation time, not when you started the form', d: 'Confirmation / tracking #' },
    { t: 'Info requested by payer (RFI)', h: "When the payer's request for more information arrived", d: 'Channel + who received it' },
    { t: 'Response sent to payer', h: 'When your RFI response was submitted', d: 'Confirmation #' },
    { t: 'Decision issued', h: 'When the payer made the determination (from the notice or portal)', d: 'Payer decision / auth #' },
    { t: 'Notice received', h: 'When the written notice reached the practice', d: 'How it arrived (portal, fax, mail, API)' },
  ],
};

const CHANNELS = ['Payer portal', 'Fax', 'Phone', 'FHIR PA API (Da Vinci PAS)', 'X12 278', 'Mail', 'Email', 'Other'];
const OUTCOMES = ['Pending', 'Approved', 'Partially approved', 'Denied', 'Withdrawn'];
const CLOSURE = ['', 'Clinical', 'Administrative (non-response)'];
const SOURCES = [['system', 'From system record'], ['manual', 'Manual / reconstructed']];
const APPEAL_STATUS = ['', 'Not appealing', 'Peer-to-peer requested', 'Appeal planned', 'Appeal filed', 'Overturned', 'Upheld'];

const STATUS_META = {
  ontrack: { label: 'On track', icon: '●' },
  risk: { label: 'At risk', icon: '▲' },
  overdue: { label: 'Overdue', icon: '✕' },
  met: { label: 'Met', icon: '✓' },
  missed: { label: 'Missed', icon: '✕' },
  noclock: { label: 'No start time', icon: '?' },
  closed: { label: 'Withdrawn', icon: '–' },
};

const CHECKLIST = [
  { sec: 'Timestamp capture', items: [
    ['cc1', 'Each of the five timestamps is captured in a system of record', 'Any timestamp you cannot produce from a system is where your record breaks down.'],
    ['cc2', 'Receipt is stamped when the request arrives, not when someone opens it', 'Fax and portal queues are the usual gap.'],
    ['cc3', 'All five timestamps can be pulled from one reconcilable record', 'If they live in three systems, document how they tie together.'],
    ['cc4', 'A named owner is assigned for each timestamp', ''],
    ['cc5', 'Time zone and timestamp source are documented (EHR, portal, fax server)', 'Calendar-day and 72-hour windows depend on it.'],
  ]},
  { sec: 'Payer and program rules', items: [
    ['pr1', 'Every payer is mapped to its program (MA, Medicaid FFS/managed care, CHIP, QHP, commercial)', 'Program determines which timeframes apply.'],
    ['pr2', 'State-law decision and RFI response windows are confirmed and entered in Settings', 'Several states set windows shorter than federal rules.'],
    ['pr3', 'Expedited (72-hour) criteria are documented and staff know when to request them', ''],
    ['pr4', 'Gold-card / PA exemption programs and service lists are tracked by payer', ''],
    ['pr5', "Payers' publicly posted PA metrics are reviewed and compared to your own experience", 'Impacted payers must post approval, denial and turnaround metrics annually.'],
  ]},
  { sec: 'Electronic prior authorization (1/1/2027)', items: [
    ['ep1', 'EHR vendor roadmap confirmed for FHIR-based PA (Da Vinci CRD, DTR, PAS)', 'Impacted payers must offer a Prior Authorization API by January 1, 2027.'],
    ['ep2', 'List of payers offering a PA API, with go-live dates', ''],
    ['ep3', 'Plan for the Electronic Prior Authorization measure (MIPS Promoting Interoperability / Medicare PI), CY 2027', 'Confirm current reporting and exclusion rules in CMS guidance.'],
    ['ep4', 'Fallback workflow for payers without an API (portal, X12 278, fax) still captures all five timestamps', ''],
    ['ep5', 'CEHRT version and certification timing confirmed with vendor', ''],
  ]},
  { sec: 'Denials and appeals', items: [
    ['da1', 'Specific denial reason is captured for every denial', 'Payers must now give a specific reason; missing reasons are worth escalating.'],
    ['da2', 'Appeal and peer-to-peer deadlines are calendared when the denial arrives', ''],
    ['da3', 'Administrative (non-response) denials are root-caused monthly', 'These are usually a missed RFI window, not a clinical problem.'],
    ['da4', 'RFI responses are tracked against the payer\'s response window', ''],
  ]},
  { sec: 'Governance', items: [
    ['gv1', 'Written SOP for PA timestamp capture and correction (who, how, reason for change)', ''],
    ['gv2', 'Staff trained on the five timestamps', ''],
    ['gv3', 'Monthly timestamp audit: trace one pended request end to end', 'Use the Audit sheet view.'],
    ['gv4', 'Record retention period set for PA documentation', ''],
    ['gv5', 'Leadership sees on-time rate, denials and gaps monthly', ''],
  ]},
];

/* -------------------------------------------------------------------- state */
let state = load();
let flash = null; // {type, msg}

function blankState() {
  return { version: 1, mode: 'provider', user: '', rules: clone(DEFAULT_RULES), cases: [], checklist: {}, sample: false };
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return Object.assign(blankState(), s);
    }
  } catch (e) { console.warn('Could not read saved data', e); }
  return blankState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save — browser storage is unavailable or full. Export a backup.'); }
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function uid() { return 'pa_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

/* ------------------------------------------------------------------ helpers */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function parseTs(s) { if (!s) return null; const t = new Date(s).getTime(); return isNaN(t) ? null : t; }
function fmtTs(ms) {
  if (ms == null) return '—';
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
function fmtDate(ms) { return ms == null ? '—' : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtDur(ms) {
  const neg = ms < 0; ms = Math.abs(ms);
  const d = Math.floor(ms / (24 * HOUR)), h = Math.floor((ms % (24 * HOUR)) / HOUR), m = Math.floor((ms % HOUR) / 60e3);
  const s = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  return neg ? `${s} ago` : s;
}
function fmtHours(h) { if (h == null || isNaN(h)) return '—'; return h >= 48 ? (h / 24).toFixed(1) + ' days' : h.toFixed(1) + ' hrs'; }
function windowLabel(h) { return h % 24 === 0 && h >= 48 ? `${h / 24} calendar days` : `${h} hours`; }
function toLocalInput(ms) {
  const d = new Date(ms); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function badge(status) {
  const m = STATUS_META[status] || STATUS_META.noclock;
  return `<span class="badge b-${status}"><span aria-hidden="true">${m.icon}</span>${m.label}</span>`;
}
function ev() { return EVENTS[state.mode]; }
function ruleFor(program) {
  return state.rules.find(r => r.program === program) || state.rules[0] || DEFAULT_RULES[0];
}
function pct(n, d) { return d ? Math.round((n / d) * 100) + '%' : '—'; }

/* --------------------------------------------------------------- clock math */
function calc(c, now = Date.now()) {
  const r = ruleFor(c.program);
  const ts = c.events.map(e => parseTs(e.ts));
  const windowH = Number(c.tfOverride) > 0 ? Number(c.tfOverride) : (c.urgency === 'expedited' ? r.exp : r.std);
  const start = ts[0];
  const extH = Math.max(0, Number(c.extDays) || 0) * 24; // payer-declared extension on this case
  const due = start != null ? start + (windowH + extH) * HOUR : null;
  const end = ts[4] != null ? ts[4] : ts[3];
  const decided = ts[3] != null || ts[4] != null || (c.outcome && c.outcome !== 'Pending');

  let status;
  if (c.outcome === 'Withdrawn') status = 'closed';
  else if (start == null) status = 'noclock';
  else if (end != null) status = end <= due ? 'met' : 'missed';
  else if (now > due) status = 'overdue';
  else status = (due - now) < Math.max(24 * HOUR, 0.25 * windowH * HOUR) ? 'risk' : 'ontrack';

  const rfiOpen = ts[1] != null && ts[2] == null && ts[3] == null && c.outcome !== 'Withdrawn';
  const rfiDue = ts[1] != null ? ts[1] + r.rfi * HOUR : null;

  // Clock integrity: which events are required at this stage, and which are weak
  const hasRfi = ts[1] != null || ts[2] != null;
  let reached = -1; ts.forEach((t, i) => { if (t != null) reached = i; });
  if (decided) reached = 4;
  const required = [];
  for (let i = 0; i <= reached; i++) { if ((i === 1 || i === 2) && !hasRfi) continue; if (i === 2 && (rfiOpen || (ts[2] == null && (c.closureCode || '').startsWith('Admin')))) continue; required.push(i); }
  if (!required.includes(0)) required.unshift(0);
  const gaps = [];
  required.forEach(i => {
    const e = c.events[i];
    if (ts[i] == null) gaps.push({ i, why: 'missing' });
    else if (!e.system) gaps.push({ i, why: 'no system of record' });
    else if (e.source !== 'system') gaps.push({ i, why: 'manual / reconstructed' });
  });
  const order = [];
  let last = null, lastI = null;
  ts.forEach((t, i) => { if (t == null) return; if (last != null && t < last) order.push(`${i + 1} is before ${lastI + 1}`); last = t; lastI = i; });
  const systems = [...new Set(required.map(i => (c.events[i].system || '').trim()).filter(Boolean))];
  const reconciled = gaps.length === 0 && order.length === 0 && systems.length === 1;

  const turnaroundH = (start != null && end != null) ? (end - start) / HOUR : null;
  const decisionDate = ts[3] != null ? ts[3] : ts[4];
  const appealDue = (c.outcome === 'Denied' || c.outcome === 'Partially approved') && decisionDate != null
    ? (c.appealDeadline ? parseTs(c.appealDeadline + 'T23:59') : decisionDate + r.appealDays * 24 * HOUR) : null;

  return { r, ts, windowH, start, due, end, status, rfiOpen, rfiDue, gaps, order, systems, reconciled, turnaroundH, decided, extH, appealDue, decisionDate };
}

/* ------------------------------------------------------------------- router */
function route() {
  const [view, id] = (location.hash.slice(1) || 'dashboard').split('/');
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === (view === 'case' ? 'cases' : view)));
  $$('.mode-toggle button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  renderBanner();
  const views = { dashboard: viewDashboard, cases: viewCases, case: viewCase, sheet: viewSheet, denials: viewDenials, scorecard: viewScorecard, readiness: viewReadiness, settings: viewSettings };
  const fn = views[view] || viewDashboard;
  $('#app').innerHTML = fn(id);
  if (fn.after) fn.after(id);
  if (flash) { toast(flash); flash = null; }
}
window.addEventListener('hashchange', route);
function go(h) { if (location.hash === '#' + h) route(); else location.hash = h; }

function renderBanner() {
  const b = $('#noticeBar');
  if (state.sample) b.innerHTML = `<div class="banner"><span><strong>Sample data loaded.</strong> These are fictional cases for demonstration.</span><button class="btn secondary" data-act="clear-sample">Remove sample data</button></div>`;
  else if (!state.cases.length) b.innerHTML = '';
  else b.innerHTML = '';
}

/* ---------------------------------------------------------------- dashboard */
function viewDashboard() {
  const now = Date.now();
  const rows = state.cases.map(c => ({ c, k: calc(c, now) }));
  if (!rows.length) return emptyStart();
  const open = rows.filter(x => !x.k.decided && x.c.outcome !== 'Withdrawn');
  const risk = open.filter(x => x.k.status === 'risk');
  const overdue = open.filter(x => x.k.status === 'overdue');
  const rfiSoon = rows.filter(x => x.k.rfiOpen && x.k.rfiDue - now < 48 * HOUR);
  const closed = rows.filter(x => x.k.status === 'met' || x.k.status === 'missed');
  const met = closed.filter(x => x.k.status === 'met');
  const avg = u => { const a = closed.filter(x => x.c.urgency === u && x.k.turnaroundH != null); return a.length ? a.reduce((s, x) => s + x.k.turnaroundH, 0) / a.length : null; };
  const integ = rows.filter(x => x.k.decided);
  const recon = integ.filter(x => x.k.reconciled);
  const adminDen = rows.filter(x => x.c.closureCode === 'Administrative (non-response)').length;
  const provider = state.mode === 'provider';

  const queue = open.slice().sort((a, b) => (a.k.due ?? Infinity) - (b.k.due ?? Infinity));
  const gapRows = rows.filter(x => x.k.gaps.length || x.k.order.length).slice(0, 8);

  return `
  <div class="page-head"><div>
    <h1>${provider ? 'Practice PA dashboard' : 'Health plan PA dashboard'}</h1>
    <p>${provider ? 'Every open prior authorization, its payer deadline, and the RFIs your team must answer before they turn into administrative denials.' : 'Every pended request, its decision deadline, and whether you can prove each timestamp from a system of record.'}</p>
  </div><div class="btn-row"><a class="btn" href="#case/new">+ New PA</a></div></div>

  <div class="grid tiles">
    ${tile('Open PAs', open.length, `${rows.length} tracked in total`)}
    ${tile('At risk', risk.length, 'Less than 24 hrs or 25% of window left', risk.length ? 'warn' : '')}
    ${tile(provider ? 'Payer overdue' : 'Past due', overdue.length, 'Decision window has passed', overdue.length ? 'alert' : '')}
    ${tile(provider ? 'RFI responses due ≤ 48h' : 'RFIs awaiting response ≤ 48h', rfiSoon.length, 'Missed responses become administrative denials', rfiSoon.length ? 'warn' : '')}
    ${tile('On-time decisions', pct(met.length, closed.length), `${met.length} of ${closed.length} decided`, 'ok')}
    ${tile('Avg turnaround', fmtHours(avg('standard')), `Expedited: ${fmtHours(avg('expedited'))}`)}
    ${tile('Timestamp completeness', pct(recon.length, integ.length), 'Decided cases provable from one record', 'ok')}
    ${tile('Administrative denials', adminDen, 'Closed for non-response', adminDen ? 'alert' : '')}
  </div>

  <div class="grid two-col">
    <section class="card"><h2>Action queue</h2>
      <p class="muted small">Open requests, soonest deadline first. Click a row to update it.</p>
      ${queue.length ? `<div class="table-wrap"><table><thead><tr><th>Case</th><th>${provider ? 'Payer' : 'Program'}</th><th>Urgency</th><th>Decision due</th><th>Time left</th><th>Status</th><th>RFI</th></tr></thead><tbody>
      ${queue.map(({ c, k }) => `<tr class="click" data-href="#case/${c.id}">
        <td><strong>${esc(c.ref)}</strong><div class="small muted">${esc(c.service)}</div></td>
        <td>${esc(provider ? c.payer : c.program)}</td>
        <td>${c.urgency === 'expedited' ? '<span class="chip bad">Expedited</span>' : 'Standard'}</td>
        <td class="small">${fmtTs(k.due)}</td>
        <td class="num">${k.due == null ? '—' : k.due < now ? `<span style="color:var(--bad)">${fmtDur(now - k.due)} late</span>` : fmtDur(k.due - now)}</td>
        <td>${badge(k.status)}</td>
        <td class="small">${k.rfiOpen ? `<span class="chip ${k.rfiDue - now < 48 * HOUR ? 'bad' : ''}">Reply due ${fmtDur(k.rfiDue - now)}</span>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty">No open requests. Nice work.</div>'}
    </section>
    <section class="card"><h2>Timestamp gaps</h2>
      <p class="muted small">Timestamps you could not produce from a system — where an administrative denial becomes hard to defend.</p>
      ${gapRows.length ? gapRows.map(({ c, k }) => `<div class="check-item" style="cursor:pointer" data-href="#case/${c.id}"><div>
        <strong>${esc(c.ref)}</strong> <span class="muted small">${esc(c.payer)}</span><br>
        ${k.gaps.map(g => `<span class="chip bad">${g.i + 1}. ${esc(ev()[g.i].t)}: ${g.why}</span>`).join('')}
        ${k.order.map(o => `<span class="chip bad">Out of order: ${esc(o)}</span>`).join('')}
      </div></div>`).join('') : '<div class="empty">Every tracked case has complete, system-sourced timestamps.</div>'}
    </section>
  </div>`;
}
function tile(label, value, sub, cls = '') {
  return `<div class="tile ${cls}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
}
function emptyStart() {
  return `<div class="card empty" style="padding:48px">
    <h1>Prove when every prior authorization step happened</h1>
    <p style="max-width:640px;margin:8px auto 20px">Log the five timestamps for each PA — request, information request, response, decision and notice — and this dashboard tracks deadlines, RFIs, denials and gaps. Everything stays in this browser.</p>
    <div class="btn-row" style="justify-content:center">
      <a class="btn" href="#case/new">+ Log your first PA</a>
      <button class="btn gold" data-act="sample">Load sample data</button>
      <a class="btn secondary" href="#settings">Import a backup</a>
    </div></div>`;
}

/* -------------------------------------------------------------------- cases */
const caseFilter = { q: '', status: '', payer: '' };
function viewCases() {
  const now = Date.now();
  const payers = [...new Set(state.cases.map(c => c.payer).filter(Boolean))].sort();
  let rows = state.cases.map(c => ({ c, k: calc(c, now) }));
  const q = caseFilter.q.toLowerCase();
  if (q) rows = rows.filter(({ c }) => [c.ref, c.payer, c.service, c.codes, c.owner, c.program].join(' ').toLowerCase().includes(q));
  if (caseFilter.status) rows = rows.filter(({ k }) => k.status === caseFilter.status);
  if (caseFilter.payer) rows = rows.filter(({ c }) => c.payer === caseFilter.payer);
  rows.sort((a, b) => (b.k.start ?? 0) - (a.k.start ?? 0));
  return `
  <div class="page-head"><div><h1>PA log</h1><p>All tracked prior authorizations.</p></div>
  <div class="btn-row"><button class="btn secondary" data-act="export-csv">Export CSV</button><a class="btn" href="#case/new">+ New PA</a></div></div>
  <div class="card">
    <div class="filters">
      <input type="search" id="fq" placeholder="Search case, payer, service, code…" value="${esc(caseFilter.q)}" aria-label="Search">
      <select id="fs" aria-label="Status"><option value="">All statuses</option>${Object.entries(STATUS_META).map(([k, m]) => `<option value="${k}" ${caseFilter.status === k ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
      <select id="fp" aria-label="Payer"><option value="">All payers</option>${payers.map(p => `<option ${caseFilter.payer === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <span class="muted small">${rows.length} shown</span>
    </div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Case</th><th>Payer</th><th>Program</th><th>Service</th><th>${esc(ev()[0].t)}</th><th>Due</th><th>Outcome</th><th>Status</th><th>Integrity</th></tr></thead><tbody>
    ${rows.map(({ c, k }) => `<tr class="click" data-href="#case/${c.id}">
      <td><strong>${esc(c.ref)}</strong></td><td>${esc(c.payer)}</td><td class="small">${esc(c.program)}</td>
      <td class="small">${esc(c.service)}${c.codes ? `<div class="muted">${esc(c.codes)}</div>` : ''}</td>
      <td class="small">${fmtTs(k.start)}</td><td class="small">${fmtTs(k.due)}</td>
      <td>${esc(c.outcome)}</td><td>${badge(k.status)}</td>
      <td>${k.reconciled ? '<span class="chip">✓ Reconciled</span>' : `<span class="chip bad">${k.gaps.length + k.order.length} gap${k.gaps.length + k.order.length === 1 ? '' : 's'}</span>`}</td>
    </tr>`).join('')}</tbody></table></div>` : '<div class="empty">No cases match.</div>'}
  </div>`;
}
viewCases.after = () => {
  const rer = () => { const pos = $('#fq').selectionStart; $('#app').innerHTML = viewCases(); viewCases.after(); const f = $('#fq'); f.focus(); f.setSelectionRange(pos, pos); };
  $('#fq').addEventListener('input', e => { caseFilter.q = e.target.value; rer(); });
  $('#fs').addEventListener('change', e => { caseFilter.status = e.target.value; rer(); });
  $('#fp').addEventListener('change', e => { caseFilter.payer = e.target.value; rer(); });
};

function newCase() {
  return {
    id: uid(), ref: '', payer: '', program: state.rules[0]?.program || '', state: '', service: '', codes: '',
    urgency: 'standard', channel: CHANNELS[0], owner: state.user || '', outcome: 'Pending', denialReason: '',
    closureCode: '', appealDeadline: '', p2pDate: '', appealStatus: '', tfOverride: '', extDays: '', notes: '',
    events: [0, 1, 2, 3, 4].map(() => ({ ts: '', system: '', source: 'system', owner: '', detail: '' })),
    audit: [], created: Date.now(),
  };
}

function viewCase(id) {
  const isNew = id === 'new';
  const c = isNew ? newCase() : state.cases.find(x => x.id === id);
  if (!c) return `<div class="card empty">Case not found. <a href="#cases">Back to PA log</a></div>`;
  const k = calc(c);
  const systems = [...new Set(state.cases.flatMap(x => x.events.map(e => e.system)).filter(Boolean))];
  const payers = [...new Set(state.cases.map(x => x.payer).filter(Boolean))];
  const opt = (list, v) => list.map(o => Array.isArray(o) ? `<option value="${esc(o[0])}" ${o[0] === v ? 'selected' : ''}>${esc(o[1])}</option>` : `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');

  return `
  <div class="page-head"><div><h1>${isNew ? 'New prior authorization' : 'Case ' + esc(c.ref)}</h1>
    <p>${isNew ? 'Enter what you know now; add the remaining timestamps as they happen.' : `Created ${fmtTs(c.created)} · ${c.audit.length} logged change${c.audit.length === 1 ? '' : 's'}`}</p></div>
    <div class="btn-row">${isNew ? '' : `<a class="btn secondary" href="#sheet/${c.id}">Audit sheet</a>`}<a class="btn secondary" href="#cases">Back</a></div></div>

  <form id="caseForm" class="card" data-id="${esc(c.id)}" data-new="${isNew ? 1 : 0}" autocomplete="off">
    <h2>Request</h2>
    <div class="fields">
      <label class="f"><span class="req">Case / internal reference</span><input name="ref" required value="${esc(c.ref)}" placeholder="e.g., PA-2026-0142 (no patient names)"></label>
      <label class="f"><span class="req">Payer</span><input name="payer" required list="payerList" value="${esc(c.payer)}"><datalist id="payerList">${payers.map(p => `<option value="${esc(p)}">`).join('')}</datalist></label>
      <label class="f">Program<select name="program">${opt(state.rules.map(r => r.program), c.program)}</select></label>
      <label class="f">State<input name="state" maxlength="2" value="${esc(c.state)}" placeholder="VA"></label>
      <label class="f">Service / item<input name="service" value="${esc(c.service)}" placeholder="e.g., MRI lumbar spine"></label>
      <label class="f">CPT / HCPCS / NDC<input name="codes" value="${esc(c.codes)}"></label>
      <label class="f">Urgency<select name="urgency">${opt([['standard', 'Standard'], ['expedited', 'Expedited']], c.urgency)}</select></label>
      <label class="f">Submission channel<select name="channel">${opt(CHANNELS, c.channel)}</select></label>
      <label class="f">Case owner<input name="owner" value="${esc(c.owner)}"></label>
      <label class="f">Timeframe override (hours)<input name="tfOverride" type="number" min="1" value="${esc(c.tfOverride)}" placeholder="Uses program rule"></label>
      <label class="f">Payer extension (days)<input name="extDays" type="number" min="0" max="14" value="${esc(c.extDays)}" placeholder="0"><span class="small muted">Only if the payer formally extended this decision (standard requests, up to 14 days)</span></label>
    </div>

    <div class="clockbox" aria-live="polite">
      <div><b>Timeframe that applied</b>${windowLabel(k.windowH)}${k.extH ? ` + ${k.extH / 24}-day extension` : ''} <span class="small muted">(${esc(c.urgency)})</span></div>
      <div><b>Decision due</b>${fmtTs(k.due)}</div>
      <div><b>Status</b>${badge(k.status)}</div>
      <div><b>RFI response due</b>${k.rfiDue ? fmtTs(k.rfiDue) : '—'}</div>
      <div><b>Reconciliation</b>${k.reconciled ? '✓ One reconcilable record' : `${k.gaps.length + k.order.length} gap(s)`}</div>
    </div>

    <h2>The five timestamps</h2>
    <p class="muted small">Record the time each step happened, the system that proves it, and whether the time came from that system or was reconstructed. Leave the RFI rows blank if no information was requested.</p>
    <div class="table-wrap"><table class="event-table"><thead><tr><th>#</th><th>Step</th><th>Date &amp; time</th><th>System of record</th><th>Source</th><th>Owner</th><th>Detail</th></tr></thead><tbody>
    ${ev().map((e, i) => { const x = c.events[i]; return `<tr>
      <td class="event-num">${i + 1}</td>
      <td style="min-width:200px"><div class="event-name">${esc(e.t)}</div><div class="event-hint">${esc(e.h)}</div></td>
      <td style="min-width:190px"><input type="datetime-local" name="ev${i}_ts" value="${esc(x.ts)}"><button type="button" class="btn secondary small" style="padding:2px 8px;margin-top:4px;font-size:12px" data-now="${i}">Now</button></td>
      <td style="min-width:150px"><input name="ev${i}_system" list="sysList" value="${esc(x.system)}" placeholder="EHR, portal, fax server…"></td>
      <td style="min-width:150px"><select name="ev${i}_source">${opt(SOURCES, x.source)}</select></td>
      <td style="min-width:110px"><input name="ev${i}_owner" value="${esc(x.owner)}"></td>
      <td style="min-width:170px"><input name="ev${i}_detail" value="${esc(x.detail)}" placeholder="${esc(e.d)}"></td>
    </tr>`; }).join('')}
    </tbody></table></div>
    <datalist id="sysList">${systems.map(s => `<option value="${esc(s)}">`).join('')}</datalist>

    <h2 style="margin-top:20px">Decision, denial &amp; appeal</h2>
    <div class="fields">
      <label class="f">Outcome<select name="outcome">${opt(OUTCOMES, c.outcome)}</select></label>
      <label class="f">Closure code<select name="closureCode">${opt(CLOSURE.map(x => [x, x || '—']), c.closureCode)}</select></label>
      <label class="f" style="grid-column:span 2">Specific denial reason (as stated by payer)<input name="denialReason" value="${esc(c.denialReason)}" placeholder="Payers must give a specific reason — record it verbatim"></label>
      <label class="f">Appeal deadline<input type="date" name="appealDeadline" value="${esc(c.appealDeadline)}"><span class="small muted">Blank = decision + ${k.r.appealDays} days (program rule)</span></label>
      <label class="f">Peer-to-peer date<input type="date" name="p2pDate" value="${esc(c.p2pDate)}"></label>
      <label class="f">Appeal status<select name="appealStatus">${opt(APPEAL_STATUS.map(x => [x, x || '—']), c.appealStatus)}</select></label>
    </div>
    <label class="f" style="margin-top:12px">Notes<textarea name="notes">${esc(c.notes)}</textarea></label>

    ${isNew ? '' : `<label class="f" style="margin-top:12px"><span>Reason for change <span class="small muted">(required if you alter a timestamp that was already saved)</span></span><input name="reason" placeholder="e.g., corrected to fax server receipt time"></label>`}
    <p class="error" id="formErr"></p>
    <div class="btn-row"><button class="btn" type="submit">Save</button>
      ${isNew ? '' : '<button type="button" class="btn danger" data-act="delete-case">Delete</button>'}</div>
  </form>

  ${isNew ? '' : `<section class="card"><h2>Audit trail</h2>
    ${c.audit.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>By</th><th>Field</th><th>From</th><th>To</th><th>Reason</th></tr></thead><tbody>
    ${c.audit.slice().reverse().map(a => `<tr><td class="small">${fmtTs(a.at)}</td><td>${esc(a.by || '—')}</td><td>${esc(a.field)}</td><td class="small">${esc(a.from)}</td><td class="small">${esc(a.to)}</td><td class="small">${esc(a.reason || '')}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No changes since creation.</p>'}
  </section>`}`;
}
viewCase.after = (id) => {
  const form = $('#caseForm'); if (!form) return;
  $$('[data-now]', form).forEach(b => b.addEventListener('click', () => { form[`ev${b.dataset.now}_ts`].value = toLocalInput(Date.now()); }));
  form.addEventListener('submit', e => { e.preventDefault(); saveCase(form); });
};

const FIELD_LABELS = { ref: 'Case reference', payer: 'Payer', program: 'Program', state: 'State', service: 'Service', codes: 'Codes', urgency: 'Urgency', channel: 'Channel', owner: 'Owner', tfOverride: 'Timeframe override', extDays: 'Payer extension (days)', outcome: 'Outcome', closureCode: 'Closure code', denialReason: 'Denial reason', appealDeadline: 'Appeal deadline', p2pDate: 'Peer-to-peer date', appealStatus: 'Appeal status', notes: 'Notes' };
const EV_FIELDS = { ts: 'time', system: 'system', source: 'source', owner: 'owner', detail: 'detail' };

function saveCase(form) {
  const isNew = form.dataset.new === '1';
  const old = isNew ? null : state.cases.find(x => x.id === form.dataset.id);
  const c = isNew ? newCase() : clone(old);
  if (isNew) c.id = form.dataset.id;
  Object.keys(FIELD_LABELS).forEach(f => { c[f] = (form[f]?.value ?? '').trim(); });
  c.state = c.state.toUpperCase();
  c.events.forEach((e, i) => Object.keys(EV_FIELDS).forEach(f => { e[f] = (form[`ev${i}_${f}`].value || '').trim(); }));
  const err = $('#formErr');
  if (!c.ref || !c.payer) { err.textContent = 'Case reference and payer are required.'; return; }
  if (state.cases.some(x => x.ref === c.ref && x.id !== c.id)) { err.textContent = 'Another case already uses that reference.'; return; }
  if (c.closureCode && c.outcome === 'Pending') { err.textContent = 'Set an outcome before choosing a closure code.'; return; }

  const by = state.user || '';
  if (isNew) {
    c.audit = [{ at: Date.now(), by, field: 'Case', from: '', to: 'Created', reason: '' }];
    state.cases.push(c);
  } else {
    const reason = (form.reason?.value || '').trim();
    const changes = [];
    Object.entries(FIELD_LABELS).forEach(([f, label]) => { if ((old[f] || '') !== (c[f] || '')) changes.push({ field: label, from: old[f] || '', to: c[f] || '' }); });
    let tsAltered = false;
    c.events.forEach((e, i) => Object.entries(EV_FIELDS).forEach(([f, label]) => {
      const a = old.events[i][f] || '', b = e[f] || '';
      if (a !== b) { changes.push({ field: `Event ${i + 1} ${label}`, from: a, to: b }); if (f === 'ts' && a) tsAltered = true; }
    }));
    if (tsAltered && !reason) { err.textContent = 'A saved timestamp was changed. Enter a reason for the change — it is kept in the audit trail.'; form.reason.focus(); return; }
    if (!changes.length) { toast('No changes to save.'); return; }
    const at = Date.now();
    changes.forEach(ch => c.audit.push(Object.assign({ at, by, reason }, ch)));
    state.cases[state.cases.findIndex(x => x.id === c.id)] = c;
  }
  save(); flash = 'Saved.'; go('case/' + c.id);
}

/* -------------------------------------------------------------- clock sheet */
function viewSheet(id) {
  const opts = state.cases.slice().sort((a, b) => (b.created || 0) - (a.created || 0));
  if (!opts.length) return `<div class="card empty">Log a PA first, then print its audit sheet here. <a href="#case/new">New PA</a></div>`;
  const c = state.cases.find(x => x.id === id) || opts[0];
  const k = calc(c);
  const provider = state.mode === 'provider';
  const gapText = k.gaps.length ? k.gaps.map(g => `${g.i + 1}. ${ev()[g.i].t} (${g.why})`).join('; ') : (k.order.length ? 'Out of sequence: ' + k.order.join(', ') : 'None');
  return `
  <div class="page-head no-print"><div><h1>Five-timestamp audit sheet</h1><p>Reconstruct one request end to end. Print it or save as PDF for your monthly timestamp audit.</p></div>
    <div class="btn-row"><select id="sheetPick" class="btn secondary" aria-label="Choose case">${opts.map(o => `<option value="${o.id}" ${o.id === c.id ? 'selected' : ''}>${esc(o.ref)} · ${esc(o.payer)}</option>`).join('')}</select>
    <button class="btn" data-act="print">Print / save PDF</button></div></div>
  <div class="sheet">
    <div class="sheet-head"><div><h1 style="margin:0">The Five-Timestamp PA Audit Sheet</h1>
      <div class="muted">Trace one prior authorization from ${provider ? 'submission' : 'receipt'} to notice — the timestamp, system, and timeframe at each step.</div></div>
      <div class="sheet-kicker">Timestamp audit<br><span style="color:var(--navy)">Mosaic Life Tech</span></div></div>
    <div class="fields" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:14px">
      <div><b>Case:</b> ${esc(c.ref)}</div><div><b>Payer:</b> ${esc(c.payer)}</div><div><b>Program:</b> ${esc(c.program)}${c.state ? ' · ' + esc(c.state) : ''}</div><div><b>Service:</b> ${esc(c.service)} ${esc(c.codes)}</div>
    </div>
    <div class="sheet-intro">As decision and pend-response windows compress toward seven days, a determination is only as defensible as your ability to show <strong>when each step happened</strong>. Any field that cannot be filled from a system is where your record breaks down.</div>
    <table><thead><tr><th>#</th><th>Step</th><th>Timestamp (date &amp; time)</th><th>System of record</th><th>Timeframe that applied</th><th>Owner</th></tr></thead><tbody>
    ${ev().map((e, i) => { const x = c.events[i]; return `<tr>
      <td class="event-num">${i + 1}</td>
      <td><div class="event-name">${esc(e.t)}</div><div class="event-hint">${esc(e.h)}</div></td>
      <td>${x.ts ? fmtTs(parseTs(x.ts)) : ''}${x.ts && x.source !== 'system' ? '<div class="small" style="color:var(--bad)">Manual / reconstructed</div>' : ''}${x.detail ? `<div class="small muted">${esc(x.detail)}</div>` : ''}</td>
      <td>${esc(x.system)}</td>
      <td class="small">${i === 0 ? `${windowLabel(k.windowH)}${k.extH ? ` + ${k.extH / 24}-day extension` : ''} (${esc(c.urgency)})<br>Due ${fmtTs(k.due)}` : i === 1 && x.ts ? `Reply within ${windowLabel(k.r.rfi)}<br>Due ${fmtTs(k.rfiDue)}` : i === 3 && x.ts ? (k.status === 'met' ? 'Within window' : k.status === 'missed' ? 'Outside window' : '') : ''}</td>
      <td>${esc(x.owner || c.owner)}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="sheet-boxes">
      <div><b>Reconciliation check</b><br>Do all five timestamps come from one reconcilable record?<br><span class="box ${k.reconciled ? 'x' : ''}"></span>Yes <span class="box ${k.reconciled ? '' : 'x'}"></span>No
        ${k.systems.length > 1 ? `<div class="small muted">Systems: ${esc(k.systems.join(', '))}</div>` : ''}</div>
      <div><b>The gap</b><br>Which event could you <em>not</em> produce from the system?<br><span class="small">${esc(gapText)}</span></div>
      <div><b>Closure code</b><br>Administrative (non-response)<span class="box ${c.closureCode.startsWith('Admin') ? 'x' : ''}"></span><br>Clinical<span class="box ${c.closureCode === 'Clinical' ? 'x' : ''}"></span>
        <div class="small muted">Outcome: ${esc(c.outcome)}${c.denialReason ? ' — ' + esc(c.denialReason) : ''}</div></div>
    </div>
    <p class="small muted" style="margin-top:16px">Generated ${fmtTs(Date.now())}${state.user ? ' by ' + esc(state.user) : ''}. Operational tracking aid only; not legal advice. Timeframes vary by program and state — confirm before relying on them.</p>
  </div>`;
}
viewSheet.after = () => { const s = $('#sheetPick'); if (s) s.addEventListener('change', e => go('sheet/' + e.target.value)); };

/* ------------------------------------------------------------------ denials */
function viewDenials() {
  const now = Date.now();
  const rows = state.cases.map(c => ({ c, k: calc(c, now) })).filter(({ c }) => c.outcome === 'Denied' || c.outcome === 'Partially approved')
    .sort((a, b) => (a.k.appealDue ?? Infinity) - (b.k.appealDue ?? Infinity));
  const admin = rows.filter(x => x.c.closureCode.startsWith('Admin')).length;
  const noReason = rows.filter(x => !x.c.denialReason).length;
  const openAppeals = rows.filter(x => !['Not appealing', 'Overturned', 'Upheld', 'Appeal filed'].includes(x.c.appealStatus) && x.k.appealDue && x.k.appealDue > now);
  const decidedAppeals = rows.filter(x => ['Overturned', 'Upheld'].includes(x.c.appealStatus));
  const over = decidedAppeals.filter(x => x.c.appealStatus === 'Overturned').length;
  return `
  <div class="page-head"><div><h1>Denials &amp; appeals</h1><p>Every denial needs a specific reason, a closure code and a calendared appeal deadline. Administrative denials usually trace back to a missed RFI window.</p></div></div>
  <div class="grid tiles">
    ${tile('Denials (incl. partial)', rows.length, '')}
    ${tile('Administrative', admin, 'Closed for non-response', admin ? 'alert' : '')}
    ${tile('Missing denial reason', noReason, 'Ask the payer for the specific reason', noReason ? 'warn' : '')}
    ${tile('Appeal decisions pending', openAppeals.length, 'Deadline not yet passed')}
    ${tile('Overturned on appeal', pct(over, decidedAppeals.length), `${over} of ${decidedAppeals.length} decided appeals`, 'ok')}
  </div>
  <section class="card">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Case</th><th>Payer</th><th>Decision</th><th>Closure</th><th>Specific reason</th><th>Peer-to-peer</th><th>Appeal deadline</th><th>Appeal status</th></tr></thead><tbody>
  ${rows.map(({ c, k }) => { const left = k.appealDue ? k.appealDue - now : null; return `<tr class="click" data-href="#case/${c.id}">
    <td><strong>${esc(c.ref)}</strong><div class="small muted">${esc(c.service)}</div></td><td>${esc(c.payer)}</td>
    <td class="small">${esc(c.outcome)}<br>${fmtDate(k.decisionDate)}</td>
    <td>${c.closureCode ? `<span class="chip ${c.closureCode.startsWith('Admin') ? 'bad' : ''}">${esc(c.closureCode)}</span>` : '<span class="chip bad">Not set</span>'}</td>
    <td class="small">${c.denialReason ? esc(c.denialReason) : '<span class="chip bad">Missing</span>'}</td>
    <td class="small">${c.p2pDate ? fmtDate(parseTs(c.p2pDate + 'T12:00')) : '—'}</td>
    <td class="small">${fmtDate(k.appealDue)}${left != null ? `<br><span class="chip ${left < 0 ? 'bad' : left < 7 * 24 * HOUR ? 'bad' : ''}">${left < 0 ? 'Passed' : fmtDur(left) + ' left'}</span>` : ''}</td>
    <td>${esc(c.appealStatus || '—')}</td></tr>`; }).join('')}
  </tbody></table></div>` : '<div class="empty">No denials recorded.</div>'}</section>`;
}

/* ---------------------------------------------------------------- scorecard */
let scoreBy = 'payer';
function viewScorecard() {
  const groups = {};
  state.cases.forEach(c => { const key = c[scoreBy] || '(blank)'; (groups[key] = groups[key] || []).push({ c, k: calc(c) }); });
  const provider = state.mode === 'provider';
  const rows = Object.entries(groups).map(([key, list]) => {
    const decided = list.filter(x => ['Approved', 'Partially approved', 'Denied'].includes(x.c.outcome));
    const closed = list.filter(x => x.k.status === 'met' || x.k.status === 'missed');
    const avg = u => { const a = closed.filter(x => x.c.urgency === u && x.k.turnaroundH != null); return a.length ? a.reduce((s, x) => s + x.k.turnaroundH, 0) / a.length : null; };
    return {
      key, n: list.length,
      appr: decided.filter(x => x.c.outcome === 'Approved').length, part: decided.filter(x => x.c.outcome === 'Partially approved').length,
      den: decided.filter(x => x.c.outcome === 'Denied').length, dn: decided.length,
      ontime: closed.filter(x => x.k.status === 'met').length, cn: closed.length,
      std: avg('standard'), exp: avg('expedited'),
      rfi: list.filter(x => x.k.ts[1] != null).length,
      admin: list.filter(x => x.c.closureCode.startsWith('Admin')).length,
      over: list.filter(x => x.c.appealStatus === 'Overturned').length,
      gaps: list.filter(x => x.k.decided && !x.k.reconciled).length,
    };
  }).sort((a, b) => b.n - a.n);
  return `
  <div class="page-head"><div><h1>${provider ? 'Payer scorecard' : 'Performance scorecard'}</h1>
    <p>${provider ? 'How each payer is treating your requests. Compare these numbers with the PA metrics impacted payers must post publicly each year.' : 'Approval, denial and timeliness by group — the same measures impacted payers must report publicly.'}</p></div>
    <div class="filters" style="margin:0"><label class="small">Group by <select id="scoreBy">${[['payer', 'Payer'], ['program', 'Program'], ['owner', 'Case owner'], ['service', 'Service']].map(([v, l]) => `<option value="${v}" ${scoreBy === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button class="btn secondary" data-act="export-score">Export CSV</button></div></div>
  <section class="card">${rows.length ? `<div class="table-wrap"><table id="scoreTable"><thead><tr>
    <th>${esc(scoreBy)}</th><th class="num">PAs</th><th class="num">Approved</th><th class="num">Partial</th><th class="num">Denied</th><th class="num">Denial rate</th>
    <th class="num">On time</th><th class="num">Avg std</th><th class="num">Avg exp</th><th class="num">RFI rate</th><th class="num">Admin denials</th><th class="num">Overturned</th><th class="num">Timestamp gaps</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><strong>${esc(r.key)}</strong></td><td class="num">${r.n}</td><td class="num">${r.appr}</td><td class="num">${r.part}</td><td class="num">${r.den}</td>
      <td class="num">${pct(r.den + r.part, r.dn)}</td><td class="num">${pct(r.ontime, r.cn)}</td><td class="num">${fmtHours(r.std)}</td><td class="num">${fmtHours(r.exp)}</td>
      <td class="num">${pct(r.rfi, r.n)}</td><td class="num">${r.admin}</td><td class="num">${r.over}</td><td class="num">${r.gaps}</td></tr>`).join('')}
  </tbody></table></div><p class="small muted">Denial rate counts full and partial denials. On time = decision or notice within the applied timeframe. Timestamp gaps = decided cases not provable from one system-sourced record.</p>` : '<div class="empty">No data yet.</div>'}</section>`;
}
viewScorecard.after = () => { const s = $('#scoreBy'); if (s) s.addEventListener('change', e => { scoreBy = e.target.value; route(); }); };

/* ---------------------------------------------------------------- readiness */
function viewReadiness() {
  const all = CHECKLIST.flatMap(s => s.items); const done = all.filter(([id]) => state.checklist[id]?.done).length;
  const p = Math.round(done / all.length * 100);
  return `
  <div class="page-head"><div><h1>ePA &amp; compliance readiness</h1><p>A working checklist for the January 1, 2027 electronic prior authorization milestones and the timestamp discipline behind defensible determinations. Confirm each item against current CMS and state guidance.</p></div></div>
  <section class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">${done} of ${all.length} complete</h2><strong>${p}%</strong></div>
    <div class="progress" style="margin-top:8px" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div></section>
  ${CHECKLIST.map(s => { const sd = s.items.filter(([id]) => state.checklist[id]?.done).length; return `<section class="card"><h2>${esc(s.sec)} <span class="small muted">${sd}/${s.items.length}</span></h2>
    ${s.items.map(([id, text, why]) => { const v = state.checklist[id] || {}; return `<div class="check-item">
      <input type="checkbox" id="ck_${id}" data-ck="${id}" ${v.done ? 'checked' : ''}>
      <div style="flex:1"><label for="ck_${id}"><strong>${esc(text)}</strong></label>${why ? `<div class="why">${esc(why)}</div>` : ''}
      <input data-cknote="${id}" value="${esc(v.note || '')}" placeholder="Owner, date or note" style="margin-top:4px;width:100%;max-width:520px;padding:4px 8px;border:1px solid var(--line);border-radius:6px;font-size:13px">
      ${v.done && v.at ? `<div class="small muted">Checked ${fmtDate(v.at)}${v.by ? ' by ' + esc(v.by) : ''}</div>` : ''}</div></div>`; }).join('')}
  </section>`; }).join('')}`;
}
viewReadiness.after = () => {
  $$('[data-ck]').forEach(cb => cb.addEventListener('change', () => {
    const id = cb.dataset.ck; const v = state.checklist[id] || {};
    v.done = cb.checked; v.at = Date.now(); v.by = state.user; state.checklist[id] = v; save(); route();
  }));
  $$('[data-cknote]').forEach(inp => inp.addEventListener('change', () => {
    const id = inp.dataset.cknote; const v = state.checklist[id] || {}; v.note = inp.value.trim(); state.checklist[id] = v; save(); toast('Note saved.');
  }));
};

/* ----------------------------------------------------------------- settings */
function viewSettings() {
  return `
  <div class="page-head"><div><h1>Settings</h1><p>Program timeframes, your name for the audit trail, and backups.</p></div></div>
  <section class="card"><h2>Your name</h2><p class="muted small">Stamped on audit-trail entries and checklist items made in this browser.</p>
    <div class="filters"><input id="userName" value="${esc(state.user)}" placeholder="e.g., T. Younkin, PA coordinator"><button class="btn" data-act="save-user">Save</button></div></section>

  <section class="card"><h2>Program timeframes</h2>
    <p class="muted small">Defaults reflect federal baselines as understood in 2026. <strong>Confirm each row for your state, programs and payer contracts</strong> — many states set shorter decision windows. CMS-0057-F does not cover drugs, so drug PAs need their own rows. No federal rule sets how long a provider has to answer an RFI, so enter each payer’s own window. If a payer formally extends a decision, record it on the case.</p>
    <form id="rulesForm"><div class="table-wrap"><table><thead><tr><th>Program</th><th>Standard (hrs)</th><th>Expedited (hrs)</th><th>Payer RFI window (hrs)</th><th>Appeal window (days)</th><th>Basis / source</th><th></th></tr></thead><tbody>
    ${state.rules.map((r, i) => `<tr>
      <td><input name="program_${i}" value="${esc(r.program)}" style="width:100%;min-width:180px"></td>
      <td><input type="number" min="1" name="std_${i}" value="${r.std}" style="width:80px"></td>
      <td><input type="number" min="1" name="exp_${i}" value="${r.exp}" style="width:80px"></td>
      <td><input type="number" min="1" name="rfi_${i}" value="${r.rfi}" style="width:80px"></td>
      <td><input type="number" min="1" name="appealDays_${i}" value="${r.appealDays}" style="width:80px"></td>
      <td><input name="basis_${i}" value="${esc(r.basis)}" style="width:100%;min-width:220px"></td>
      <td><button type="button" class="btn danger" style="padding:4px 8px" data-delrule="${i}" aria-label="Remove ${esc(r.program)}">✕</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="btn-row" style="margin-top:10px"><button class="btn" type="submit">Save timeframes</button><button type="button" class="btn secondary" data-act="add-rule">+ Add program</button><button type="button" class="btn secondary" data-act="reset-rules">Restore defaults</button></div></form></section>

  <section class="card"><h2>Backup &amp; data</h2>
    <p class="muted small">Your data lives only in this browser. Clearing browser data or switching computers will lose it unless you export a backup.</p>
    <div class="btn-row">
      <button class="btn" data-act="export-json">Export full backup (JSON)</button>
      <button class="btn secondary" data-act="export-csv">Export PA log (CSV)</button>
      <label class="btn secondary" style="cursor:pointer">Import backup or CSV<input type="file" id="importFile" accept=".json,.csv" hidden></label>
      <button class="btn gold" data-act="sample">Load sample data</button>
      <button class="btn danger" data-act="wipe">Erase all data</button>
    </div>
    <p class="small muted">CSV import accepts the same columns this app exports, so you can bulk-load from an EHR or portal report after mapping the columns.</p></section>`;
}
viewSettings.after = () => {
  $('#rulesForm').addEventListener('submit', e => {
    e.preventDefault(); const f = e.target;
    const rules = state.rules.map((_, i) => ({
      program: f[`program_${i}`].value.trim(), std: +f[`std_${i}`].value || 168, exp: +f[`exp_${i}`].value || 72,
      rfi: +f[`rfi_${i}`].value || 168, appealDays: +f[`appealDays_${i}`].value || 60, basis: f[`basis_${i}`].value.trim(),
    })).filter(r => r.program);
    // keep existing cases pointing at renamed programs
    state.rules.forEach((old, i) => { const nu = rules[i]; if (nu && nu.program !== old.program) state.cases.forEach(c => { if (c.program === old.program) c.program = nu.program; }); });
    state.rules = rules; save(); toast('Timeframes saved.'); route();
  });
  $$('[data-delrule]').forEach(b => b.addEventListener('click', () => {
    const r = state.rules[+b.dataset.delrule];
    if (state.cases.some(c => c.program === r.program)) { toast('Cases use this program — reassign them first.'); return; }
    state.rules.splice(+b.dataset.delrule, 1); save(); route();
  }));
  $('#importFile').addEventListener('change', importFile);
};

/* ------------------------------------------------------------ import/export */
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const CSV_COLS = ['ref', 'payer', 'program', 'state', 'service', 'codes', 'urgency', 'channel', 'owner', 'tfOverride', 'extDays', 'outcome', 'closureCode', 'denialReason', 'appealDeadline', 'p2pDate', 'appealStatus', 'notes'];
function csvCell(v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function casesToCsv() {
  const evCols = []; for (let i = 1; i <= 5; i++) Object.keys(EV_FIELDS).forEach(f => evCols.push(`event${i}_${f}`));
  const calcCols = ['calc_window_hours', 'calc_due', 'calc_status', 'calc_turnaround_hours', 'calc_reconciled', 'calc_gaps'];
  const lines = [CSV_COLS.concat(evCols, calcCols).join(',')];
  state.cases.forEach(c => {
    const k = calc(c);
    const row = CSV_COLS.map(f => c[f]);
    c.events.forEach(e => Object.keys(EV_FIELDS).forEach(f => row.push(e[f])));
    row.push(k.windowH, k.due ? new Date(k.due).toISOString() : '', STATUS_META[k.status].label, k.turnaroundH != null ? k.turnaroundH.toFixed(1) : '', k.reconciled ? 'Yes' : 'No', k.gaps.map(g => `${g.i + 1}:${g.why}`).join('; '));
    lines.push(row.map(csvCell).join(','));
  });
  return lines.join('\r\n');
}
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function importFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result).replace(/^﻿/, '');
      if (file.name.toLowerCase().endsWith('.json')) {
        const s = JSON.parse(text);
        if (!s || !Array.isArray(s.cases)) throw new Error('Not a Prior Auth Timestamp Tracker backup file.');
        state = Object.assign(blankState(), s); save(); flash = `Restored ${state.cases.length} cases.`; go('dashboard');
      } else {
        const rows = parseCsv(text); const head = rows.shift().map(h => h.trim());
        if (!head.includes('ref') || !head.includes('payer')) throw new Error('CSV needs at least "ref" and "payer" columns.');
        let added = 0, updated = 0;
        rows.forEach(r => {
          const get = col => { const i = head.indexOf(col); return i < 0 ? undefined : (r[i] || '').trim(); };
          const ref = get('ref'); if (!ref) return;
          let c = state.cases.find(x => x.ref === ref); const isNew = !c; if (isNew) c = newCase();
          CSV_COLS.forEach(f => { const v = get(f); if (v !== undefined) c[f] = v; });
          c.events.forEach((ev, i) => Object.keys(EV_FIELDS).forEach(f => { const v = get(`event${i + 1}_${f}`); if (v !== undefined) ev[f] = v; }));
          if (!state.rules.some(x => x.program === c.program)) c.program = state.rules[0].program;
          if (!['standard', 'expedited'].includes(c.urgency)) c.urgency = /exp/i.test(c.urgency) ? 'expedited' : 'standard';
          c.audit.push({ at: Date.now(), by: state.user, field: 'Case', from: '', to: isNew ? 'Imported from CSV' : 'Updated from CSV', reason: file.name });
          if (isNew) { state.cases.push(c); added++; } else updated++;
        });
        save(); flash = `Imported: ${added} new, ${updated} updated.`; go('cases');
      }
    } catch (err) { toast('Import failed: ' + err.message); }
  };
  reader.readAsText(file);
}

/* -------------------------------------------------------------- sample data */
function sampleCases() {
  const now = Date.now(); const t = h => toLocalInput(now - h * HOUR);
  const mk = (o, evs) => { const c = Object.assign(newCase(), o); evs.forEach((e, i) => { if (e) Object.assign(c.events[i], e); }); c.audit = [{ at: now, by: 'Sample', field: 'Case', from: '', to: 'Created', reason: '' }]; return c; };
  const S = (h, system, owner, detail, source = 'system') => ({ ts: t(h), system, owner, detail, source });
  return [
    mk({ ref: 'PA-1001', payer: 'Harbor Advantage', program: 'Medicare Advantage', state: 'VA', service: 'MRI lumbar spine', codes: '72148', channel: 'Payer portal', owner: 'Dana' },
      [S(180, 'Payer portal', 'Dana', 'Conf #H-88213')]),
    mk({ ref: 'PA-1002', payer: 'Bayside Medicaid MCO', program: 'Medicaid managed care', state: 'VA', service: 'Home health PT', codes: 'G0151', channel: 'Fax', owner: 'Luis' },
      [S(100, 'Fax server', 'Luis', 'Fax log 4471'), S(60, 'Fax server', 'Luis', 'Fax from UM dept to front desk')]),
    mk({ ref: 'PA-1003', payer: 'Harbor Advantage', program: 'Medicare Advantage – Part B drugs', state: 'VA', service: 'Infusion — biologic', codes: 'J1745', urgency: 'expedited', channel: 'FHIR PA API (Da Vinci PAS)', owner: 'Dana' },
      [S(55, 'EHR (PAS)', 'Dana', 'PAS bundle 7f2a')]),
    mk({ ref: 'PA-1004', payer: 'Summit Health Plan', program: 'Commercial / state-regulated', state: 'NC', service: 'Knee arthroscopy', codes: '29881', channel: 'Payer portal', owner: 'Priya', outcome: 'Approved' },
      [S(300, 'Payer portal', 'Priya', 'Conf #S-1029'), null, null, S(200, 'Payer portal', 'Priya', 'Auth 55-1902'), S(199, 'Payer portal', 'Priya', 'Portal letter')]),
    mk({ ref: 'PA-1005', payer: 'Bayside Medicaid MCO', program: 'Medicaid managed care', state: 'VA', service: 'Power wheelchair', codes: 'K0823', channel: 'Fax', owner: 'Luis', outcome: 'Denied', closureCode: 'Administrative (non-response)', denialReason: 'Requested documentation not received within the response window', appealStatus: 'Appeal planned' },
      [S(400, 'Fax server', 'Luis', 'Fax log 4302'), S(330, 'Fax server', 'Luis', 'RFI fax to main line'), null, S(150, 'Payer letter', 'Luis', 'Denial letter', 'manual'), S(120, 'Mail', 'Luis', 'USPS letter', 'manual')]),
    mk({ ref: 'PA-1006', payer: 'Harbor Advantage', program: 'Medicare Advantage', state: 'VA', service: 'CT abdomen/pelvis', codes: '74177', channel: 'Phone', owner: 'Dana', outcome: 'Denied', closureCode: 'Clinical', denialReason: 'Does not meet criteria: conservative therapy not documented', p2pDate: toLocalInput(now + 48 * HOUR).slice(0, 10), appealStatus: 'Peer-to-peer requested' },
      [S(260, 'Phone log', 'Dana', 'Call ref 99-12', 'manual'), S(200, 'Payer portal', 'Dana', 'Portal message'), S(180, 'Payer portal', 'Dana', 'Upload conf'), S(20, 'Payer portal', 'Dana', 'Denial 77-310'), S(18, 'Payer portal', 'Dana', 'Portal letter')]),
    mk({ ref: 'PA-1007', payer: 'Summit Health Plan', program: 'Commercial / state-regulated', state: 'NC', service: 'Sleep study', codes: '95810', channel: 'X12 278', owner: 'Priya', outcome: 'Partially approved', closureCode: 'Clinical', denialReason: 'Home sleep test approved; in-lab study not medically necessary' },
      [S(500, 'Clearinghouse', 'Priya', '278 trace 3381'), null, null, S(170, 'Clearinghouse', 'Priya', '278 response'), S(150, 'Clearinghouse', 'Priya', '278 response')]),
    mk({ ref: 'PA-1008', payer: 'Coastal Kids CHIP', program: 'CHIP managed care', state: 'VA', service: 'Speech therapy eval', codes: '92523', channel: 'Payer portal', owner: 'Luis', outcome: 'Approved' },
      [S(240, 'Payer portal', 'Luis', 'Conf C-551'), S(200, 'Payer portal', 'Luis', 'Portal message'), S(180, 'Payer portal', 'Luis', 'Upload conf'), S(100, 'Payer portal', 'Luis', 'Auth C-551-A'), S(99, 'Payer portal', 'Luis', 'Portal letter')]),
    mk({ ref: 'PA-1009', payer: 'Bayside Medicaid MCO', program: 'Medicaid managed care', state: 'VA', service: 'Sleep study', codes: '95810', channel: 'Payer portal', owner: 'Priya' },
      [S(60, 'Payer portal', 'Priya', 'Conf B-7781')]),
  ];
}

/* ----------------------------------------------------------- global actions */
document.addEventListener('click', e => {
  const row = e.target.closest('[data-href]');
  if (row && !e.target.closest('a,button,input,select')) { go(row.dataset.href.slice(1)); return; }
  const m = e.target.closest('[data-mode]');
  if (m) { state.mode = m.dataset.mode; save(); route(); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'sample') {
    if (state.cases.length && !state.sample) { toast('Sample data can only be loaded into an empty workspace.'); return; }
    DEFAULT_RULES.forEach(d => { if (!state.rules.some(r => r.program === d.program)) state.rules.push(clone(d)); });
    state.cases = sampleCases(); state.sample = true; save(); flash = 'Sample data loaded.'; go('dashboard');
  } else if (act === 'clear-sample') {
    state.cases = []; state.sample = false; save(); go('dashboard');
  } else if (act === 'export-json') {
    download(`pa-timestamp-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json');
  } else if (act === 'export-csv') {
    download(`pa-log-${new Date().toISOString().slice(0, 10)}.csv`, casesToCsv(), 'text/csv');
  } else if (act === 'export-score') {
    const t = $('#scoreTable'); if (!t) return;
    const csv = $$('tr', t).map(tr => $$('th,td', tr).map(c => csvCell(c.textContent.trim())).join(',')).join('\r\n');
    download(`pa-scorecard-${scoreBy}.csv`, csv, 'text/csv');
  } else if (act === 'print') {
    window.print();
  } else if (act === 'save-user') {
    state.user = $('#userName').value.trim(); save(); toast('Name saved.');
  } else if (act === 'add-rule') {
    state.rules.push({ program: 'New program', std: 168, exp: 72, rfi: 168, appealDays: 60, basis: 'Enter source' }); save(); route();
  } else if (act === 'reset-rules') {
    const progs = new Set(DEFAULT_RULES.map(r => r.program));
    state.rules = clone(DEFAULT_RULES).concat(state.rules.filter(r => !progs.has(r.program) && state.cases.some(c => c.program === r.program)));
    save(); toast('Defaults restored.'); route();
  } else if (act === 'wipe') {
    if (a.dataset.confirm !== '1') { a.dataset.confirm = '1'; a.textContent = 'Click again to erase everything'; return; }
    state = blankState(); save(); flash = 'All data erased.'; go('dashboard');
  } else if (act === 'delete-case') {
    if (a.dataset.confirm !== '1') { a.dataset.confirm = '1'; a.textContent = 'Click again to delete'; return; }
    const id = $('#caseForm').dataset.id; state.cases = state.cases.filter(c => c.id !== id); save(); flash = 'Case deleted.'; go('cases');
  }
});

$('#year').textContent = new Date().getFullYear();
route();
// Keep countdowns fresh on the dashboard without disturbing forms
setInterval(() => { const v = (location.hash.slice(1) || 'dashboard').split('/')[0]; if (v === 'dashboard' && !document.querySelector('#app :focus')) route(); }, 60e3);
