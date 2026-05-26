// ===== FEEDBACK: bug reports & feature ideas =====
// Lightweight in-app capture so issues/ideas can be jotted down without
// breaking flow, then reviewed (and handed to Claude) from Settings.
// Stored under 'finFeedback' and included in the JSON backup.

function getFeedback() { return DB.get('finFeedback', []) }
function saveFeedback(list) { DB.set('finFeedback', list) }

// Two subtle ghost buttons mounted into every screen's .page-header.
const FEEDBACK_DOCK_HTML = `
  <div class="feedback-dock" role="group" aria-label="משוב">
    <button class="fb-btn" type="button" title="דיווח על באג" onclick="openFeedbackModal('bug')"><span class="fb-ic">🐞</span><span class="fb-label">באג</span></button>
    <button class="fb-btn" type="button" title="הצעת רעיון לפיתוח" onclick="openFeedbackModal('idea')"><span class="fb-ic">💡</span><span class="fb-label">רעיון</span></button>
  </div>`

function mountFeedbackButtons() {
  document.querySelectorAll('.page-header').forEach(h => {
    if (!h.querySelector('.feedback-dock')) h.insertAdjacentHTML('beforeend', FEEDBACK_DOCK_HTML)
  })
}
document.addEventListener('DOMContentLoaded', mountFeedbackButtons)

// Best-effort label of the screen the user is currently on (for context).
function _currentScreenLabel() {
  const map = { dashboard: 'לוח בקרה', transactions: 'עסקאות', import: 'ייבוא', analysis: 'ניתוח', recurring: 'קבועות', budget: 'תקציב', property: 'משכנתא ונכס', settings: 'הגדרות' }
  const s = (typeof _currentScreen !== 'undefined' && _currentScreen) || (location.hash || '').slice(1) || 'dashboard'
  return map[s] || s
}

function openFeedbackModal(type) {
  const isBug = type === 'bug'
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay open'
  overlay.style.zIndex = '1200'
  overlay.innerHTML = `
    <div class="modal-box" style="width:min(460px,95vw)" role="dialog" aria-modal="true">
      <div class="modal-header"><h3>${isBug ? '🐞 דיווח על באג' : '💡 הצעת רעיון לפיתוח'}</h3><button class="modal-close" type="button" data-x>✕</button></div>
      <div class="modal-row"><label class="form-label">כותרת קצרה</label><input id="fbTitle" placeholder="${isBug ? 'מה לא עבד?' : 'מה תרצה להוסיף?'}"></div>
      <div class="modal-row"><label class="form-label">פירוט</label><textarea id="fbText" rows="4" style="resize:vertical" placeholder="${isBug ? 'תיאור הבאג: מה עשית, מה ציפית שיקרה, ומה קרה בפועל.' : 'תיאור הרעיון והערך שהוא מוסיף.'}"></textarea></div>
      <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:1rem">נשמר אוטומטית עם המסך הנוכחי (${_currentScreenLabel()}), הגרסה והתאריך.</div>
      <div style="display:flex;gap:.6rem;justify-content:flex-end">
        <button class="btn-ghost" type="button" data-x>ביטול</button>
        <button class="btn-primary" type="button" data-save>שמירה</button>
      </div>
    </div>`
  const close = () => overlay.remove()
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-x]')) return close()
    if (e.target.closest('[data-save]')) {
      const title = (overlay.querySelector('#fbTitle').value || '').trim()
      const text = (overlay.querySelector('#fbText').value || '').trim()
      if (!title && !text) { toast('כתוב כותרת או פירוט', { type: 'error' }); return }
      const list = getFeedback()
      list.push({
        id: genId(), type, title, text,
        screen: _currentScreenLabel(),
        appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '',
        createdAt: Date.now(), status: 'open',
      })
      saveFeedback(list)
      close()
      toast(isBug ? 'הבאג נשמר 🐞' : 'הרעיון נשמר 💡', { type: 'success' })
      if (document.getElementById('feedbackList')) renderFeedbackList()
    }
  })
  document.body.appendChild(overlay)
  overlay.querySelector('#fbTitle').focus()
}

// ===== SETTINGS TAB: review list =====
function toggleFeedbackStatus(id) {
  const list = getFeedback()
  const it = list.find(x => x.id === id)
  if (!it) return
  it.status = it.status === 'done' ? 'open' : 'done'
  saveFeedback(list)
  renderFeedbackList()
}
function deleteFeedbackItem(id) {
  saveFeedback(getFeedback().filter(x => x.id !== id))
  renderFeedbackList()
}

function _feedbackDigest() {
  const list = getFeedback()
  if (list.length === 0) return ''
  const fmt = ts => new Date(ts).toLocaleDateString('he-IL')
  const block = (label, type) => {
    const items = list.filter(x => x.type === type)
    if (items.length === 0) return ''
    const lines = items.map(x => `- [${x.status === 'done' ? 'x' : ' '}] ${x.title || '(ללא כותרת)'}${x.text ? ' — ' + x.text : ''}  _(מסך: ${x.screen}, גרסה: ${x.appVersion}, ${fmt(x.createdAt)})_`).join('\n')
    return `## ${label} (${items.length})\n${lines}`
  }
  return [block('באגים', 'bug'), block('רעיונות', 'idea')].filter(Boolean).join('\n\n')
}

function copyAllFeedback() {
  const digest = _feedbackDigest()
  if (!digest) { toast('אין משוב לייצוא', { type: 'info' }); return }
  navigator.clipboard.writeText(digest)
    .then(() => toast('הועתק ללוח — אפשר להדביק לקלוד', { type: 'success' }))
    .catch(() => toast('ההעתקה נכשלה', { type: 'error' }))
}

function renderFeedbackList() {
  const el = document.getElementById('feedbackList')
  if (!el) return
  const list = getFeedback().slice().sort((a, b) => b.createdAt - a.createdAt)
  const open = list.filter(x => x.status !== 'done').length
  const fmt = ts => new Date(ts).toLocaleDateString('he-IL')

  const card = x => {
    const isBug = x.type === 'bug'
    return `
      <div class="fb-item ${x.status === 'done' ? 'fb-item-done' : ''}">
        <div class="fb-item-main">
          <div class="fb-item-title">${isBug ? '🐞' : '💡'} ${x.title || '(ללא כותרת)'}</div>
          ${x.text ? `<div class="fb-item-text">${x.text}</div>` : ''}
          <div class="fb-item-meta">${x.screen} · גרסה ${x.appVersion || '—'} · ${fmt(x.createdAt)}</div>
        </div>
        <div class="fb-item-actions">
          <button class="btn-ghost" style="font-size:.75rem;padding:.3rem .6rem" onclick="toggleFeedbackStatus('${x.id}')">${x.status === 'done' ? 'פתח מחדש' : 'סמן כטופל'}</button>
          <button class="btn-ghost" style="font-size:.75rem;padding:.3rem .55rem;color:var(--expense)" onclick="deleteFeedbackItem('${x.id}')" title="מחק">🗑</button>
        </div>
      </div>`
  }

  if (list.length === 0) {
    el.innerHTML = emptyStateHTML({
      icon: '📝',
      title: 'אין משוב עדיין',
      text: 'השתמש בכפתורי 🐞 / 💡 שבראש כל מסך כדי לתעד באגים ורעיונות תוך כדי שימוש.',
    })
    return
  }
  el.innerHTML = `
    <div class="fb-toolbar">
      <span style="color:var(--text-muted);font-size:.85rem">${list.length} פריטים · ${open} פתוחים</span>
      <button class="btn-primary" style="font-size:.8rem;padding:.4rem .8rem" onclick="copyAllFeedback()">📋 העתק הכל ל-Claude</button>
    </div>
    <div class="fb-list">${list.map(card).join('')}</div>`
}
