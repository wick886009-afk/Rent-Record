# RentFlow — Automated Rent & Tenant Management System (2026 & Beyond)

Complete Next.js + TypeScript + Tailwind CSS + Google Sheets API + A4 PDF Rent Slip SaaS application built directly from your historical rent workbook.

---

## 1. Connected Google Sheets & Backup Links

- **Live Connected Google Sheet (Primary Source of Truth)**:
  `https://docs.google.com/spreadsheets/d/1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s/edit`
  - Spreadsheet ID: `1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s`
- **Untouched Backup Copy of Original Workbook**:
  `https://drive.google.com/file/d/1F1wplNMBN2JXx9gGwtTUjCY0bT-2JVLB/view?usp=drivesdk`
- **Original Excel File (Unchanged)**:
  `https://docs.google.com/spreadsheets/d/19ALgXk-GBhzx9Iz9dmOG3_IdpFgvENdk/edit?gid=1844301726#gid=1844301726`

---

## 2. Historical Data Audit & Formula Repairs

1. **Missing October–December Meter Reading Bug Repaired**:
   - In the original workbook, `=IMSUB(D12, E12)` treated blank October `Main reading` cells (`D12`) as `0`, producing massive negative electricity bills (`-₹15,456` for Javed, `-₹41,944` for Sonu, etc.).
   - In both the upgraded Google Sheet and `lib/calculations/index.ts`, missing readings return `"Pending Calculation"` (`Reading Pending`), carry forward the last verified September meter reading (`2208` for Javed, `1258` for Raja, etc.), and preserve the exact September closing balance (`₹39,767` across all 13 tenants) without corrupting future months.
2. **Javed & Raja Combined Rent Slip (`BG-01`) Preserved**:
   - Javed (`T-01`, Room 101, ₹2,200 rent) and Raja (`T-02`, Room 102, ₹2,300 rent) maintain separate sub-meter rows on the Dashboard and in `Monthly_Records` (preventing double counting), while automatically combining into the `Javed (<Month>)` slip (`₹4,500` combined base rent + side-by-side Javed & Raja `Previous rent` and `Bill` columns) matching `Total!A1:C5` and `Javed!A18:O36`.
3. **Single-Page A4 12-Slip Print Layout & Zero Security Deposit**:
   - The `Monthly Rent Slips` sheet (`A1:F32`) and the website's **Single-A4 12-Slip Compact PDF Generator** (`lib/pdf/index.ts`) format all 12 slips (`Javed+Raja`, `Ghanti`, `Painter`, `Virasat`, `Guddu`, `Sajid`, `Dinesh`, `Sonu`, `Imran`, `Nisha`, `Sundar`, and `Sundar Ki Mummy` with `Current reading / Previous reading / Total Reading`) onto a single A4 portrait page with cut guides.
   - All security deposit fields have been removed per your instructions.

---

## 3. Google Cloud Service Account & Two-Way Sync Setup

### Option A: Google Cloud Service Account (Recommended for Production Vercel)
1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Enable the **Google Sheets API** and **Google Drive API**.
3. Go to **IAM & Admin > Service Accounts > Create Service Account** (e.g., `rentflow-sync`).
4. Open the created Service Account > **Keys > Add Key > Create new key (JSON)** and download the JSON key file.
5. Open your Google Sheet (`https://docs.google.com/spreadsheets/d/1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s/edit`), click **Share**, and share it with your Service Account's `client_email` as **Editor**.
6. Copy `client_email` and `private_key` into your Vercel Environment Variables (`.env.local`).

### Option B: Zero-Credential Google Apps Script Web App Bridge (Fastest Setup)
1. Open your Google Sheet (`1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s`) and click **Extensions > Apps Script**.
2. Paste the contents of `scripts/Code.gs` into the script editor and click **Save**.
3. Click **Deploy > New deployment > Select type: Web app**.
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
4. Copy the generated **Web App URL** (`https://script.google.com/macros/s/.../exec`) and paste it into the RentFlow website's **Google Sheets Sync** settings modal (or set `GOOGLE_APPS_SCRIPT_WEBHOOK_URL` in Vercel).

---

## 4. Vercel Deployment Instructions

1. Extract `rentflow-vercel-app.zip` and push the folder to a private GitHub/GitLab repository, or deploy directly using the Vercel CLI:
   ```bash
   npm install
   npx vercel
   ```
2. In your Vercel Project Settings > **Environment Variables**, configure:
   - `GOOGLE_SHEETS_SPREADSHEET_ID` = `1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` = `<your-service-account-email>`
   - `GOOGLE_PRIVATE_KEY` = `"-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
"`
   - `ADMIN_USERNAME` = `admin`
   - `ADMIN_PASSWORD` = `<your-strong-admin-password>`
3. Click **Deploy**.
