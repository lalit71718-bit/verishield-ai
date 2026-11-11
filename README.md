# 🛡️ VeriShield AI

VeriShield AI is a next-generation, privacy-centric cybersecurity and forensics platform built with a 2026-era design aesthetic. It provides secure document validation, URL threat intelligence, and an end-to-end encrypted user vault ledger for forensic tracking.

---

## 🚀 Tech Stack

* **Frontend:** HTML5, hand-written CSS design system (`styles.css`), Vanilla JavaScript (`app.js` shared session, API, nav and gauge helpers; dark and light themes; client-side auth guards)
* **Backend:** Node.js, Express (RESTful API architecture, middleware routing, and file processing)
* **Database:** MongoDB (Persistent user vaults, scan logs, and authentication records)

---

## 📁 Project Architecture

```text
verishield-ai/
├── .gitignore
├── README.md
├── package.json
├── backend/
│   ├── server.js
│   ├── models/
│   └── routes/
└── frontend/
    ├── styles.css       (Design tokens, components and page layouts)
    ├── app.js           (Shared session, API client, nav, toasts, gauges)
    ├── index.html       (Public landing page with quick link check)
    ├── auth.html        (Secure Sign In & Registration portal)
    ├── scanner.html     (Protected Document & Media Forensic Workbench)
    ├── urlcheck.html    (Public URL Threat Intelligence Console)
    └── profile.html     (Protected User Vault Audit Ledger)

```

The frontend calls the API at `http://localhost:5000` by default. To point it elsewhere, set `window.VERISHIELD_API_BASE` before `app.js` loads, or set the `verishield_api` key in localStorage.

Live check at here: https://verisheld.netlify.app/
