# 🛡️ VeriShield AI

VeriShield AI checks documents, images, video, text and links for signs of tampering or fraud, and keeps a SHA-256 fingerprinted record of every verdict in a personal vault.

**Live site:** https://verishield-ai-web.vercel.app

> The live site hosts the pages only. Sign-in, scans and the vault need the backend, which currently runs on your own machine (see [Run it locally](#run-it-locally)).

---

## Features

### Forensic workbench
- Upload an image, video or PDF (up to 100 MB), or paste raw text.
- Every item gets a manipulation-confidence score, a harm-risk score, a plain-language verdict and the list of signals behind it.
- **Images** are analysed from their container metadata (EXIF, XMP, IPTC, C2PA, PNG text chunks):

  | What the file shows | Verdict |
  |---|---|
  | Metadata names an AI generator (ChatGPT, Gemini, Stable Diffusion, Firefly, Midjourney and others) | AI-generated |
  | No metadata, and dimensions match a standard AI output size (for example 1024 × 1024) | Likely AI-generated |
  | Metadata names an editor such as Photoshop | Edited image |
  | No provenance metadata at all | Unverified, never "authentic" |
  | Camera make and model recorded | Consistent with camera capture |

- **Optional detection model:** with Sightengine keys configured, each image is also scored by a pixel-level AI-image detector, which catches AI images whose metadata was stripped.
- **PDFs** are checked for header and trailer integrity, page and font structure, and editing-tool signatures.
- **Text** is checked against known phishing and AI-boilerplate phrases.
- Download a PDF evidence certificate for any scan.

### URL intel
- Paste a shop, ad or social link. No account needed.
- Three-tier verdict (Safe, Suspicious, Phishing) with a trust score, a scam-risk score and reasons.
- Checks the domain against a list of known platforms, and looks for scam keywords and hyphen-stuffed lookalike domains.

### Evidence vault
- Every file and text scan is saved to the signed-in account with its SHA-256 fingerprint.
- Totals, a Flagged / Unverified / Clean filter, search by name or hash, and expandable entries with findings and next steps.

### Interface
- Dark and light themes, mobile layout, keyboard focus states and reduced-motion support.

---

## How verdicts are produced

Verdicts come from rule-based checks on file structure, metadata and wording, plus the optional detection model for images. They are indicators, not proof:

- Metadata can be stripped or forged. An image without metadata is reported as unverified because nothing in the file can settle the question.
- The URL check uses pattern rules and a fixed list of trusted domains. It does not query live threat feeds.
- Always verify independently before acting on a result.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, hand-written CSS design system (`styles.css`), vanilla JavaScript (`app.js`), pdfmake for certificates |
| Backend | Node.js, Express, Multer (uploads), JSON Web Tokens, bcrypt |
| Database | MongoDB with Mongoose |
| Optional | Sightengine AI-image detection API |

---

## Project structure

```text
verishield-ai/
├── README.md
├── backend/
│   ├── server.js                  Express app and route mounting
│   ├── .env.example               Template for backend/.env
│   ├── config/db.js               MongoDB connection
│   ├── controllers/
│   │   ├── authController.js      Register, login, profile
│   │   ├── scanController.js      File and text scans, scan history
│   │   └── urlController.js       URL checks and URL history
│   ├── services/
│   │   ├── imageForensics.js      Image container and metadata analysis
│   │   └── aiDetector.js          Optional Sightengine detection model
│   ├── middleware/                JWT auth (required and optional), uploads
│   ├── models/                    User, Scan, UrlScan
│   └── routes/                    auth, scan, url
└── frontend/
    ├── styles.css                 Design tokens, components, page layouts
    ├── app.js                     Session, API client, nav, toasts, gauges
    ├── index.html                 Landing page with quick link check (public)
    ├── auth.html                  Sign in and registration
    ├── scanner.html               Forensic workbench (sign-in required)
    ├── urlcheck.html              URL intel (public)
    └── profile.html               Evidence vault (sign-in required)
```

---

## Run it locally

**You need:** Node.js 18 or newer, and MongoDB running locally or a MongoDB Atlas connection string.

1. Clone the repository:

   ```bash
   git clone https://github.com/lalit71718-bit/verishield-ai.git
   ```

2. Create the backend settings file by copying `backend/.env.example` to `backend/.env`, then fill it in:

   | Variable | Required | Purpose |
   |---|---|---|
   | `PORT` | no | Port for the API. Defaults to `5000`. |
   | `MONGO_URI` | yes | MongoDB connection string, for example `mongodb://127.0.0.1:27017/verishield`. |
   | `JWT_SECRET` | yes | Long random string used to sign sessions. |
   | `SIGHTENGINE_API_USER` | no | Enables the AI-image detection model. |
   | `SIGHTENGINE_API_SECRET` | no | Enables the AI-image detection model. |

   `backend/.env` is ignored by git. Never commit it.

3. Install and start the backend:

   ```bash
   cd backend
   ```

   ```bash
   npm install
   ```

   ```bash
   node server.js
   ```

   It is ready when it prints `Backend Server running on http://localhost:5000` and `MongoDB Connected`.

4. Open `frontend/index.html` in a browser, or use the live site on the same computer.

### Enabling the detection model

Create a free account at [sightengine.com](https://sightengine.com), copy the API user and API secret from the dashboard into `backend/.env`, and restart the backend. Uploaded images are then sent to Sightengine for scoring. Without the keys, images are judged on metadata alone.

---

## API

Base URL: `http://localhost:5000/api`. Protected routes expect `Authorization: Bearer <token>`.

| Method | Route | Sign-in | Purpose |
|---|---|---|---|
| POST | `/auth/register` | no | Create an account; returns a token |
| POST | `/auth/login` | no | Sign in; returns a token |
| GET | `/auth/profile` | yes | Current user's details |
| POST | `/scan/media` | yes | Scan an uploaded image, video or PDF |
| POST | `/scan/text` | yes | Scan pasted text |
| GET | `/scan/history` | yes | The user's saved scans |
| POST | `/url/check` | optional | Check a link; saved to the account when signed in |
| GET | `/url/history` | yes | The user's saved link checks |

---

## Deployment

- **Frontend:** deployed on Vercel from the `frontend` folder (Root Directory `frontend`, Framework Preset "Other", no build command). It redeploys on every merge to `main`.
- **Backend:** not hosted yet. The frontend calls `http://localhost:5000` by default, so the live site is fully functional only on a computer running the backend.
- **Pointing the frontend at a hosted API:** set `window.VERISHIELD_API_BASE` before `app.js` loads, or set the `verishield_api` key in the browser's localStorage.

---

## Known limitations

- No password reset by email yet.
- Uploaded files are kept on the server's disk after scanning.
- Sessions last 30 days and cannot be revoked.
- Link checks are saved but not yet shown in the vault.
