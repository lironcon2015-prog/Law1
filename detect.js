// ===== TRANSACTION DETECTION HELPERS =====
// Stateless pattern matchers used during import (and via migration on existing
// rows) to surface CC-bill metadata the issuer hides inside the "פירוט" column:
// installment plans, standing orders, and bit/paybox payee names.
//
// All detectors operate on the raw `vendor` + `description` fields and return
// either a structured result or null. enrichDetectedFields wires them together
// and produces the side-effects we persist on the tx (extra flag fields and a
// rewritten vendor for bit/paybox).

// "תשלום X מתוך Y" / "X מתוך Y" / "X/Y" – Y up to 99.
// Returns { current, total } or null. Validates current <= total.
function detectInstallmentInfo(text) {
  if (!text) return null
  const s = String(text)
  // Order matters – the "תשלום" prefix variant is the most specific and
  // catches the canonical CC-bill phrasing. The bare "X מתוך Y" variant
  // covers exports that drop the prefix word.
  const patterns = [
    /תשלום\s*(\d{1,2})\s*(?:מתוך|מ-|\/|of)\s*(\d{1,2})/i,
    /(\d{1,2})\s*מתוך\s*(\d{1,2})/,
    /\bתשלום\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/,
    /\b(\d{1,2})\s*\/\s*(\d{1,2})\s*תשלום/,
  ]
  for (const re of patterns) {
    const m = s.match(re)
    if (!m) continue
    const cur = parseInt(m[1], 10), tot = parseInt(m[2], 10)
    if (!cur || !tot || cur > tot || tot < 2 || tot > 99) continue
    return { current: cur, total: tot }
  }
  return null
}

// "הוראת קבע" or the common short form "הו״ק". Used for tagging notes
// and offering an explicit filter on the transactions screen.
function detectStandingOrder(text) {
  if (!text) return false
  const s = String(text)
  if (/הוראת\s*קבע/.test(s)) return true
  // The "הו״ק" abbreviation — JS \b doesn't anchor on Hebrew letters, so
  // require a non-Hebrew-letter or end-of-string right after the ק.
  if (/הו["׳'`]ק(?=[^א-ת]|$)/.test(s)) return true
  return false
}

// Bit/Paybox lines on a CC bill carry the payee inside "פירוט". We rewrite
// the raw "BIT" / "פייבוקס" vendor into "ביט <payee>" so the user can
// categorise once per payee (autocat then propagates by normalised vendor).
// JS \b only treats ASCII letters as word chars, so /\bביט\b/ would either
// match nothing or match inside "ביטוח". For the Hebrew patterns we instead
// require the token to be flanked by non-Hebrew-letter chars (start of string
// / space / punctuation), which excludes "ביטוח" while keeping "ביט נסים".
const _BIT_PATTERNS = [/(^|\W)bit(\W|$)/i, /(?:^|[^א-ת])ביט(?=[^א-ת]|$)/]
const _PAYBOX_PATTERNS = [/paybox/i, /(?:^|[^א-ת])פייבוקס(?=[^א-ת]|$)/, /(?:^|[^א-ת])פיי\s*בוקס(?=[^א-ת]|$)/]

function _stripDiacritics(s) { return s.replace(/[֑-ֽֿׁ-ׂׄ-ׇ]/g, '') }

function detectBitPayboxRecipient(vendor, description) {
  const v = String(vendor || '')
  const d = String(description || '')
  const all = `${v} ${d}`
  let provider = null
  if (_PAYBOX_PATTERNS.some(p => p.test(all))) provider = 'פייבוקס'
  else if (_BIT_PATTERNS.some(p => p.test(all))) provider = 'ביט'
  if (!provider) return null
  // Strip the provider word + connective stop-words from description; what
  // remains is the payee name. Description is preferred over vendor because
  // the vendor cell on a bit/paybox CC line is almost always just "BIT" /
  // "PAYBOX". Installment markers ("תשלום X מתוך Y") and CC-bill
  // boilerplate are stripped too so they don't leak into the recipient.
  let raw = _stripDiacritics(d || v)
  raw = raw
    .replace(/תשלום\s*\d+\s*(?:מתוך|מ-|\/|of)\s*\d+/gi, ' ')
    .replace(/\d+\s*מתוך\s*\d+/g, ' ')
    .replace(/\b(bit|paybox)\b/gi, ' ')
    .replace(/(פייבוקס|פיי\s*בוקס|ביט)/g, ' ')
    .replace(/(העברה|תשלום|זיכוי|חיוב|העבר|מקבל|למקבל|מאת|אל|לטובת|העברת|מתוך|הוראת\s*קבע)/g, ' ')
    .replace(/[^א-תA-Za-z\s'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Drop very short or numeric-only leftovers — they're not a real name.
  if (!raw || raw.length < 2) return null
  // Capitalize-ish: keep Hebrew as-is; latin words → title case.
  raw = raw.split(' ').map(w => /[a-z]/i.test(w) ? (w[0].toUpperCase() + w.slice(1).toLowerCase()) : w).join(' ')
  return { provider, recipient: raw }
}

// Mutates a copy of `t` with whatever the detectors find. Idempotent — if the
// vendor was already rewritten on a previous pass (because the input was a
// stored, previously-enriched row), re-running keeps the same result.
function enrichDetectedFields(t) {
  const out = { ...t }
  const desc = String(t.description || '')
  const vendor = String(t.vendor || '')

  const inst = detectInstallmentInfo(desc) || detectInstallmentInfo(vendor)
  if (inst) {
    out.installmentCurrent = inst.current
    out.installmentTotal = inst.total
  }

  if (detectStandingOrder(desc) || detectStandingOrder(vendor)) {
    out.standingOrder = true
  }

  const bp = detectBitPayboxRecipient(vendor, desc)
  if (bp && bp.recipient) {
    const rewritten = `${bp.provider} ${bp.recipient}`
    if (out.vendor !== rewritten) out.vendor = rewritten
    out.detectedProvider = bp.provider
  }

  return out
}

// Given a tx with installment metadata, compute the YYYY-MM of the last
// charge. effectiveMonth comes from getTxEffectiveMonth (CC billing-cycle aware).
function computeInstallmentFinalMonth(effectiveMonth, current, total) {
  if (!effectiveMonth || !current || !total || total < current) return ''
  const [y, m] = effectiveMonth.split('-').map(Number)
  if (!y || !m) return ''
  const remaining = total - current
  let ny = y, nm = m + remaining
  while (nm > 12) { nm -= 12; ny += 1 }
  return `${ny}-${String(nm).padStart(2, '0')}`
}

// Some CC bills print the installment's ORIGINAL purchase date instead of
// the per-cycle charge date — e.g., installment 7/12 of a Nov 2025 purchase
// shows up on the June 2026 bill with date=30/11/2025. We map that into the
// bill's actual cycle so the tx sorts/displays correctly:
//   - keep the day-of-month from the original purchase (30)
//   - pick the calendar month so the day, after CC rollover, lands in the
//     bill cycle:
//       day  < billingDay → use billingMonth   (no rollover)
//       day >= billingDay → use billingMonth-1 (rollover bumps it forward)
// Day 31 clamps to the target month's last day (e.g., 30 in April).
function remapInstallmentDateToBillCycle(origIsoDate, billingMonth, billingDay) {
  if (!origIsoDate || !billingMonth) return ''
  const m1 = String(origIsoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const m2 = String(billingMonth).match(/^(\d{4})-(\d{2})$/)
  if (!m1 || !m2) return ''
  const origDay = parseInt(m1[3], 10)
  const bDay = billingDay || 10
  let ty = parseInt(m2[1], 10)
  let tm = parseInt(m2[2], 10)
  if (origDay >= bDay) {
    tm -= 1
    if (tm === 0) { tm = 12; ty -= 1 }
  }
  const daysInMonth = new Date(ty, tm, 0).getDate()
  const day = Math.min(origDay, daysInMonth)
  return `${ty}-${String(tm).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Auto-note builder — assembles the human-readable line we drop into tx.notes
// when the user hasn't typed anything there yet. Keeps things in Hebrew, in
// the same word order the user expected ("תשלום X מתוך Y · ...").
function buildAutoNotes(t) {
  const parts = []
  if (t.installmentCurrent && t.installmentTotal) {
    parts.push(`תשלום ${t.installmentCurrent} מתוך ${t.installmentTotal}`)
    if (t.installmentFinalMonth) {
      const [y, m] = t.installmentFinalMonth.split('-')
      if (y && m) parts.push(`חודש חיוב אחרון: ${m}/${y}`)
    }
  }
  // Surface the historical purchase date when we remapped the tx into a
  // newer cycle — keeps the original date discoverable without distorting
  // the bill-cycle ordering.
  if (t.originalDate) {
    const m = String(t.originalDate).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) parts.push(`תאריך עסקה מקורי: ${m[3]}/${m[2]}/${m[1]}`)
  }
  if (t.standingOrder) parts.push('הוראת קבע')
  return parts.join(' · ')
}
