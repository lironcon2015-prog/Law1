const DRIVE_CLIENT_ID = '702808266000-m1gro990l5uflm9o5jj56ut6n0b760il.apps.googleusercontent.com'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_FILE_NAME = 'finance-app-backup.json'

let _pendingDriveAction = null
let _driveToken = null
let _driveTokenClient = null

function _initDriveClient() {
  if (_driveTokenClient) return
  _driveTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: resp => {
      if (resp.error) {
        _showDriveStatus('שגיאת התחברות: ' + resp.error, true)
        return
      }
      _driveToken = resp.access_token
      _renderDriveUI()

      if (_pendingDriveAction === 'backup') {
        _pendingDriveAction = null
        driveBackup()
      } else if (_pendingDriveAction === 'restore') {
        _pendingDriveAction = null
        driveRestore()
      }
    },
  })
}

function driveSignIn() {
  _initDriveClient()
  _driveTokenClient.requestAccessToken()
}

function driveSignOut() {
  if (_driveToken) google.accounts.oauth2.revoke(_driveToken)
  _driveToken = null
  _renderDriveUI()
}

function _renderDriveUI() {
  const on = !!_driveToken
  document.getElementById('driveNotSignedIn').style.display = on ? 'none' : ''
  const si = document.getElementById('driveSignedIn')
  si.style.display = on ? 'flex' : 'none'
  if (on) _updateDriveLastInfo()
}

function _updateDriveLastInfo() {
  const el = document.getElementById('driveLastBackupInfo')
  if (!el) return
  const at = localStorage.getItem('driveLastUploadAt') || localStorage.getItem('driveBackupAt')
  el.textContent = at ? 'גיבוי אחרון: ' + new Date(at).toLocaleString('he-IL') : 'טרם גובה לענן'
}

async function _driveReq(method, url, body, contentType) {
  const headers = { Authorization: 'Bearer ' + _driveToken }
  if (contentType) headers['Content-Type'] = contentType

  const cacheBuster = (url.includes('?') ? '&' : '?') + '_t=' + Date.now()
  const finalUrl = method === 'GET' ? url + cacheBuster : url

  const resp = await fetch(finalUrl, { method, headers, body, cache: 'no-store' })
  if (resp.status === 401) {
    _driveToken = null
    _renderDriveUI()
    throw new Error('פג תוקף החיבור — התחבר מחדש.')
  }
  return resp
}

async function _driveFindFile() {
  // סריקת ענן למציאת הקובץ הכי חדש שקיים כדי לפתור כפילויות (Split Brain)
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`)
  const r = await _driveReq('GET', `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime+desc&pageSize=5`)
  const data = await r.json()
  const searchLatest = data.files?.[0] || null

  // בדיקת הקובץ שהמכשיר הזה ננעל עליו
  const savedId = localStorage.getItem('driveBackupFileId')
  let savedFile = null
  if (savedId) {
    try {
      const r2 = await _driveReq('GET', `https://www.googleapis.com/drive/v3/files/${savedId}?fields=id,modifiedTime`)
      if (r2.ok) savedFile = await r2.json()
    } catch (e) {}
  }

  // בחירת הקובץ העדכני ביותר מביניהם
  let bestFile = savedFile || searchLatest
  if (savedFile && searchLatest) {
    const tSaved = new Date(savedFile.modifiedTime).getTime()
    const tSearch = new Date(searchLatest.modifiedTime).getTime()
    if (tSearch > tSaved) bestFile = searchLatest
  }

  if (bestFile) localStorage.setItem('driveBackupFileId', bestFile.id)
  return bestFile
}

async function driveBackup() {
  if (!_driveToken) {
    _pendingDriveAction = 'backup'
    driveSignIn()
    return
  }
  _showDriveStatus('מגבה…', false)
  try {
    const payload = JSON.stringify(collectBackupData(), null, 2)

    const existing = await _driveFindFile()
    let fileResult

    if (existing) {
      // בקשת השדות id,modifiedTime מגוגל דרייב בתשובה
      const r = await _driveReq(
        'PATCH',
        `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media&fields=id,modifiedTime`,
        payload,
        'application/json'
      )
      if (!r.ok) throw new Error(await r.text())
      fileResult = await r.json()
    } else {
      const meta = JSON.stringify({ name: DRIVE_FILE_NAME, mimeType: 'application/json' })
      const boundary = 'fb_boundary'
      const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--`
      const r = await _driveReq(
        'POST',
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime',
        body,
        `multipart/related; boundary=${boundary}`
      )
      if (!r.ok) throw new Error(await r.text())
      fileResult = await r.json()
    }

    localStorage.setItem('driveBackupFileId', fileResult.id)
    // תיקון: זמן העלאה נשמר בנפרד מזמן שחזור כדי לא לחסום משיכות ממשתמשים אחרים
    localStorage.setItem('driveLastUploadAt', fileResult.modifiedTime || new Date().toISOString())
    _updateDriveLastInfo()
    _showDriveStatus('✅ גובה בהצלחה', false)
  } catch (e) {
    _showDriveStatus('שגיאה: ' + e.message, true)
  }
}

async function driveRestore() {
  if (!_driveToken) {
    _pendingDriveAction = 'restore'
    driveSignIn()
    return
  }
  if (!confirm('שחזור יחליף את כל הנתונים הנוכחיים בגיבוי האחרון מ-Drive — כולל שינויים מקומיים שעדיין לא גובו. להמשיך?')) return
  _showDriveStatus('משחזר…', false)
  try {
    const file = await _driveFindFile()
    if (!file) throw new Error('לא נמצא קובץ גיבוי בגוגל דרייב.')
    const r = await _driveReq('GET', `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`)
    if (!r.ok) throw new Error(await r.text())
    let data
    try { data = await r.json() } catch { data = null }
    const isValid = data && typeof data === 'object' && !Array.isArray(data) &&
      (Array.isArray(data.transactions) || Array.isArray(data.accounts) || Array.isArray(data.categories))
    if (!isValid) throw new Error('קובץ הגיבוי בענן פגום — לא בוצע שחזור.')
    applyBackupData(data)
    localStorage.setItem('driveBackupFileId', file.id)
    localStorage.setItem('driveBackupAt', new Date(file.modifiedTime).toISOString())
    _showDriveStatus('✅ שוחזר — מרענן…', false)
    setTimeout(() => location.reload(), 1500)
  } catch (e) {
    _showDriveStatus('שגיאה: ' + e.message, true)
  }
}

function _showDriveStatus(msg, isErr) {
  const el = document.getElementById('driveStatus')
  if (!el) return
  el.textContent = msg
  el.style.color = isErr ? 'var(--expense)' : '#4ade80'
  if (!isErr) setTimeout(() => { if (el.textContent === msg) el.textContent = '' }, 4000)
}
