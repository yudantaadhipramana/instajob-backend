# Google OAuth 2.0 Setup Guide untuk InstaJob Gmail Integration

## Overview
InstaJob menggunakan Google OAuth 2.0 untuk mengakses Gmail user secara aman tanpa meminta password. Panduan ini akan memandu Anda membuat credentials yang diperlukan.

## Prerequisites
- Akun Google (Gmail)
- Akses ke [Google Cloud Console](https://console.cloud.google.com/)

---

## Step 1: Buat Google Cloud Project

1. Kunjungi [Google Cloud Console](https://console.cloud.google.com/)
2. Klik **"Select a project"** di header atas
3. Klik **"NEW PROJECT"**
4. Isi form:
   - **Project name**: `InstaJob Gmail Integration` (atau nama lain yang Anda suka)
   - **Organization**: (biarkan kosong jika tidak punya org)
5. Klik **"CREATE"**
6. Tunggu ~10 detik hingga project selesai dibuat
7. Pastikan project yang baru dibuat sudah terpilih (cek di header atas)

---

## Step 2: Enable Gmail API

1. Di sidebar kiri, pilih **"APIs & Services"** → **"Library"**
2. Di search bar, ketik: `Gmail API`
3. Klik **"Gmail API"** dari hasil pencarian
4. Klik tombol **"ENABLE"**
5. Tunggu beberapa detik hingga API aktif

---

## Step 3: Configure OAuth Consent Screen

Sebelum membuat credentials, Anda harus setup OAuth consent screen (tampilan yang dilihat user saat authorize).

1. Di sidebar kiri, pilih **"APIs & Services"** → **"OAuth consent screen"**
2. Pilih **User Type**:
   - **External** (jika Anda ingin user publik bisa pakai)
   - **Internal** (jika hanya untuk workspace organization Anda)
   - **Rekomendasi**: Pilih **"External"** lalu klik **"CREATE"**

### 3.1 App Information (Step 1 of 4)
Isi form berikut:
- **App name**: `InstaJob`
- **User support email**: Email Anda (e.g., `support@instajob.com`)
- **App logo**: (opsional, bisa skip)
- **Application home page**: `https://instajob.com` (atau `http://localhost:3000` untuk testing)
- **Application privacy policy link**: `https://instajob.com/privacy` (buat halaman dummy dulu)
- **Application terms of service link**: `https://instajob.com/terms` (buat halaman dummy dulu)
- **Authorized domains**: 
  - Tambahkan: `instajob.com` (jika sudah punya domain)
  - Atau kosongkan untuk testing lokal
- **Developer contact information**: Email Anda

Klik **"SAVE AND CONTINUE"**

### 3.2 Scopes (Step 2 of 4)
Tambahkan scope Gmail yang diperlukan:

1. Klik **"ADD OR REMOVE SCOPES"**
2. Centang scope berikut:
   - `https://www.googleapis.com/auth/gmail.readonly` (baca email)
   - `https://www.googleapis.com/auth/gmail.send` (kirim email, jika perlu auto-reply)
   - `https://www.googleapis.com/auth/gmail.modify` (mark as read, label, dll)
3. Atau filter dengan mengetik `gmail` di search box
4. Klik **"UPDATE"**
5. Klik **"SAVE AND CONTINUE"**

### 3.3 Test Users (Step 3 of 4)
**PENTING**: Untuk app External yang belum di-publish, Anda harus tambahkan test users.

1. Klik **"ADD USERS"**
2. Masukkan email Gmail yang akan digunakan untuk testing (e.g., email Anda sendiri)
3. Klik **"ADD"**
4. Klik **"SAVE AND CONTINUE"**

### 3.4 Summary (Step 4 of 4)
1. Review semua informasi
2. Klik **"BACK TO DASHBOARD"**

---

## Step 4: Buat OAuth 2.0 Credentials

Sekarang buat credentials (Client ID & Client Secret):

1. Di sidebar kiri, pilih **"APIs & Services"** → **"Credentials"**
2. Klik tombol **"+ CREATE CREDENTIALS"** di atas
3. Pilih **"OAuth client ID"**

### 4.1 Application Type
1. **Application type**: Pilih **"Web application"**
2. **Name**: `InstaJob Backend OAuth Client`

### 4.2 Authorized Redirect URIs
Tambahkan URL callback untuk OAuth flow:

1. Di section **"Authorized redirect URIs"**, klik **"+ ADD URI"**
2. Masukkan URI berikut:
   - **Development (local)**: `http://localhost:3001/api/integrations/gmail/callback`
   - **Production** (jika sudah deploy): `https://your-backend-domain.com/api/integrations/gmail/callback`
3. Klik **"CREATE"**

### 4.3 Download Credentials
Setelah klik CREATE, modal akan muncul dengan **Client ID** dan **Client Secret**:

1. **COPY** kedua nilai tersebut (akan digunakan di Step 5)
2. Atau klik **"DOWNLOAD JSON"** untuk backup (simpan di tempat aman, JANGAN commit ke git!)
3. Klik **"OK"**

---

## Step 5: Konfigurasi Backend `.env`

Sekarang paste credentials ke file `.env` backend:

1. Buka file: `C:\Users\OMNIBOOK\Desktop\instajob-backend\.env`
2. Cari section **"Google OAuth"** (sudah ada dari setup sebelumnya)
3. Replace nilai dummy dengan credentials asli:

```env
# Google OAuth for Gmail Integration
GOOGLE_CLIENT_ID="123456789-abcdefg.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-abcd1234efgh5678"
GOOGLE_REDIRECT_URI="http://localhost:3001/api/integrations/gmail/callback"
```

**Catatan**:
- `GOOGLE_CLIENT_ID` = Client ID dari Step 4
- `GOOGLE_CLIENT_SECRET` = Client Secret dari Step 4
- `GOOGLE_REDIRECT_URI` = URI yang sama dengan yang didaftarkan di Step 4.2

4. **SAVE** file `.env`
5. **RESTART** backend server (kill proses lama, jalankan `npx tsx src/index.ts` lagi)

---

## Step 6: Testing OAuth Flow

Setelah backend restart dengan credentials asli, test OAuth flow:

### 6.1 Get Authorization URL
```bash
# Login dulu untuk dapat token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test-phase-i@instajob.test","password":"TestPhaseI1234"}' \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

# Request auth URL
curl -X POST http://localhost:3001/api/integrations/gmail/auth-url \
  -H "Authorization: Bearer $TOKEN"
```

Response akan berisi `authUrl`. **COPY** URL tersebut.

### 6.2 Authorize via Browser
1. Paste `authUrl` ke browser
2. Login dengan akun Gmail yang sudah ditambahkan sebagai test user (Step 3.3)
3. Anda akan lihat consent screen "InstaJob wants to access your Google Account"
4. Klik **"Allow"**
5. Browser akan redirect ke `http://localhost:3001/api/integrations/gmail/callback?code=...`
6. Jika sukses, halaman akan menampilkan JSON: `{"success": true, "message": "Gmail connected successfully"}`

### 6.3 Verify Connection
```bash
# Cek status koneksi Gmail
curl -X GET http://localhost:3001/api/integrations/gmail/status \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
{
  "isConnected": true,
  "email": "your-gmail@gmail.com"
}
```

---

## Troubleshooting

### Error: "Access blocked: This app's request is invalid"
**Penyebab**: Redirect URI tidak match dengan yang didaftarkan.
**Solusi**: 
1. Cek di Google Cloud Console → Credentials → OAuth client ID → Authorized redirect URIs
2. Pastikan URI di `.env` (`GOOGLE_REDIRECT_URI`) **SAMA PERSIS** (termasuk http vs https, trailing slash, dll)

### Error: "You don't have permission to access this app"
**Penyebab**: Email Anda belum ditambahkan sebagai test user.
**Solusi**: 
1. Kembali ke OAuth consent screen → Test users
2. Tambahkan email Gmail yang Anda gunakan untuk testing

### Error: "invalid_client" di callback
**Penyebab**: Client ID atau Client Secret salah.
**Solusi**: 
1. Cek lagi credentials di Google Cloud Console
2. Pastikan tidak ada typo saat copy-paste ke `.env`
3. Restart backend setelah ubah `.env`

### Gmail API quota exceeded
**Penyebab**: Free tier Gmail API punya limit 1 billion quota units/day (cukup besar untuk MVP).
**Solusi**: 
1. Cek quota usage di Cloud Console → APIs & Services → Gmail API → Quotas
2. Jika benar-benar exceed, tunggu 24 jam atau upgrade billing

---

## Security Best Practices

1. **JANGAN commit** file `.env` ke git (sudah ada di `.gitignore`)
2. **JANGAN share** Client Secret di public (Slack, Discord, screenshot, dll)
3. **Rotate credentials** jika tercidaya leak:
   - Go to Cloud Console → Credentials
   - Klik nama OAuth client → "REGENERATE SECRET"
4. **Enable 2FA** di akun Google yang digunakan untuk Cloud Console
5. **Review permissions** secara berkala di [Google Account Permissions](https://myaccount.google.com/permissions)

---

## Production Deployment

Saat deploy ke production:

1. **Update Authorized Redirect URIs**:
   - Tambahkan production URL: `https://api.instajob.com/api/integrations/gmail/callback`
   - Keep localhost URI untuk testing parallel

2. **Update `.env` di production**:
   ```env
   GOOGLE_REDIRECT_URI="https://api.instajob.com/api/integrations/gmail/callback"
   ```

3. **Publish OAuth App** (opsional, untuk akses user publik):
   - Go to OAuth consent screen
   - Klik "PUBLISH APP"
   - Submit verification form (proses review ~1-2 minggu)
   - Tanpa publish, max 100 test users

4. **Monitor API usage**:
   - Cloud Console → APIs & Services → Dashboard
   - Set up alerts untuk quota usage

---

## Referensi

- [Google OAuth 2.0 Docs](https://developers.google.com/identity/protocols/oauth2)
- [Gmail API Docs](https://developers.google.com/gmail/api)
- [OAuth Scopes for Gmail](https://developers.google.com/gmail/api/auth/scopes)
- [InstaJob Backend Codebase](C:/Users/OMNIBOOK/Desktop/instajob-backend)

---

**Status**: Panduan ini dibuat pada 2026-07-10. InstaJob backend sudah siap menerima credentials asli.
**Next Step**: Follow Step 1-6 di atas, lalu test OAuth flow end-to-end.
