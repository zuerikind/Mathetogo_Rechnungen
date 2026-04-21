# Nachhilfe Tracker

Track tutoring sessions via Google Calendar and generate monthly invoices.

## Tech Stack
- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Prisma + SQLite (`prisma/dev.db`)
- NextAuth.js v5 (Google OAuth)
- Google Calendar API, @react-pdf/renderer, Resend (email)

---

## 1. Google Cloud Console Setup

### Create OAuth Credentials
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create or select a project
3. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
4. Application type: **Web application**
5. Under **Authorized redirect URIs** add: `http://localhost:3000/api/auth/callback/google`
6. Copy the **Client ID** and **Client Secret**

### Enable Google Calendar API
1. **APIs & Services → Library → Google Calendar API → Enable**

### OAuth Consent Screen
1. **APIs & Services → OAuth consent screen**, User type: **External**
2. Add your Gmail as a **Test User**
3. Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar.readonly`

---

## 2. Local Setup

```bash
npm install
cp .env.local.example .env.local
# Edit .env.local and fill in credentials (see below)
npm run db:push    # create SQLite DB
npm run db:seed    # add default students
npm run dev        # start dev server → http://localhost:3000
```

### Required env vars in `.env.local`
```
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="<openssl rand -base64 32>"
NEXTAUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="<from Google Cloud Console>"
GOOGLE_CLIENT_SECRET="<from Google Cloud Console>"
ALLOWED_EMAIL="your-gmail@gmail.com"
RESEND_API_KEY="<from resend.com for email sending>"
TUTOR_NAME="Your Name"
TUTOR_ADDRESS="Street 1, 8000 Zürich"
TUTOR_EMAIL="your@email.ch"
TUTOR_PHONE="+41 79 000 00 00"
TUTOR_IBAN="CH00 0000 0000 0000 0000 0"
TUTOR_BANK_NAME="Zürcher Kantonalbank"
```

---

## 3. API Reference

All routes require an authenticated session.

### Students

```bash
# List active students
curl http://localhost:3000/api/students -b cookies.txt

# Create student
curl -X POST http://localhost:3000/api/students \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"name":"Max","subject":"Mathe","ratePerMin":1.1,"email":"max@example.com"}'

# Update student
curl -X PUT http://localhost:3000/api/students/<id> \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"ratePerMin":1.2}'

# Soft-delete student (sets active=false)
curl -X DELETE http://localhost:3000/api/students/<id> -b cookies.txt
```

### Calendar Sync

```bash
# Sync Google Calendar events for a month → creates/updates Sessions
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"year":2025,"month":3}'

# Response example:
# {"synced":8,"skipped":2,"unmatched":["Physik Gruppe"]}
```

**Event matching:** Case-insensitive, partial match. `"Nachhilfe Thilo"` matches student `"Thilo"`.
Events in `unmatched` didn't match any student — rename them in Google Calendar to fix.

---

## 4. Default Students (seed data)

| Name    | Subject | CHF/min |
|---------|---------|---------|
| Thilo   | Mathe   | 1.20    |
| Johanna | Mathe   | 1.10    |
| Alena   | Mathe   | 1.10    |
| Liam    | Mathe   | 1.10    |
| Flurina | Mathe   | 1.10    |

Edit rates via `PUT /api/students/<id>` or Prisma Studio (`npm run db:studio`).
