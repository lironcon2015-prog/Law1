# הוספת custom subdomain ל-GitHub Pages עם Cloudflare DNS

מדריך לחיבור subdomain חדש (תחת `lironcon.com`) לאפליקציה שמתארחת על GitHub Pages תחת חשבון המשתמש `lironcon2015-prog`.
שלבים שעבדו לדומיין `homebudget.lironcon.com`.

## הקשר

- דומיין `lironcon.com` רשום ב-Cloudflare (Registrar + DNS)
- האפליקציה מתארחת ב-GitHub Pages תחת `lironcon2015-prog.github.io/REPO_NAME/`
- המטרה: לחבר `APPNAME.lironcon.com` ישירות לריפו

## שלבים — בסדר הזה בדיוק

### 1. בריפו של האפליקציה (צד הקוד)

צור קובץ בשם `CNAME` (בלי סיומת) בשורש הריפו, עם שורה אחת בלבד — ה-FQDN המלא:

```
APPNAME.lironcon.com
```

Commit + push ל-`main`.

### 2. ב-Cloudflare (צד ה-DNS)

Dashboard → `lironcon.com` → **DNS → Records → + Add record**:

| שדה | ערך |
|---|---|
| Type | `CNAME` |
| Name | `APPNAME` (רק החלק לפני הדומיין — לא FQDN מלא) |
| Target | `lironcon2015-prog.github.io` |
| Proxy status | **DNS only** (ענן אפור 🌥️ — קריטי) |
| TTL | Auto |

**Save.**

### 3. ב-GitHub (צד ה-Pages)

ריפו → **Settings → Pages**:

1. Custom domain — לרוב מאוכלס אוטומטית מקובץ ה-CNAME. אם לא, להזין `APPNAME.lironcon.com` → Save
2. לחכות ל-**✓ DNS check successful** (1-3 דקות, לרענן)
3. לחכות ל-**Enforce HTTPS** שיהפוך מאפור ללבן (עוד 5-15 דקות — GitHub מקצה SSL מ-Let's Encrypt)
4. לסמן **Enforce HTTPS** ✓

## מה לא צריך לעשות

פעולות שמדריכים / Claudes אחרים מבקשים לפעמים — לא נחוצות בסטאפ הזה:

- ❌ **אין** צורך באימות בעלות בקובץ TXT/verification — Cloudflare כבר authoritative DNS לדומיין
- ❌ **אין** צורך ברשומות `A` או `AAAA` ל-GitHub's IPs — זה רק ל-apex domain (`lironcon.com` ללא subdomain), לא ל-subdomain
- ❌ **אין** צורך ב-Page Rule, Redirect Rule או "Always Use HTTPS" ב-Cloudflare — GitHub Pages עושה את ה-HTTPS redirect לבד
- ❌ **אין** צורך לעשות proxy דרך Cloudflare (ענן כתום) — זה דווקא שובר את ההקצאה האוטומטית של SSL ב-GitHub
- ❌ **אין** צורך באישור domain ownership ב-GitHub User Settings — זה רלוונטי רק אם רוצים את כל ה-`lironcon.com` ב-apex לכל ה-user, לא ל-subdomain בודד לריפו ספציפי

## פתרון בעיות

| בעיה | סיבה נפוצה |
|---|---|
| "DNS check unsuccessful" אחרי 10+ דקות | ענן ב-Cloudflare כתום במקום אפור — להפוך לאפור ולחכות |
| "Certificate not issued" אחרי שעה+ | Proxy פעיל ב-Cloudflare. כבה אותו, חכה, נסה שוב |
| Site לא נטען עם 404 גם אחרי שהכל ירוק | Pages לא מוגדר לפרסם מ-`main`. Settings → Pages → Source: Deploy from branch → main |
| `ERR_TOO_MANY_REDIRECTS` | Cloudflare SSL/TLS mode על "Flexible" — צריך להעביר ל-"Full" (או Full strict) |

## הערה לסשן חדש של Claude Code

אם תבקש מ-Claude להגדיר subdomain חדש על אותו דומיין — הצמד אותו למדריך הזה.
ספציפית להעיר לו ש:

1. ה-DNS כבר ב-Cloudflare (לא צריך nameservers חדשים)
2. הפרוקסי בענן **חייב להישאר אפור** (DNS only) לפחות עד שה-SSL הוקצה
3. אין צורך ב-A records / TXT verification / Cloudflare Page Rules
