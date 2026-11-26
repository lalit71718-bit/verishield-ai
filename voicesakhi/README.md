# 🎙️ VoiceSakhi — voice-first task agent for India

A phone-style assistant that **gets things done by voice**, in Hindi, Hinglish or English:
`voice → intent → confirm → action → log`. No app install, no typing, no reading needed.

> **Proof of concept.** Partner services (clinic, billing, supplier, reminders) are mocked in `services.js`; the full voice-driven flow is real and tested.

## Run it
```bash
cd voicesakhi
npm start        # http://localhost:4100  (no dependencies, Node 18+)
npm test         # 10 tests incl. the headline scenario
```
Use **Chrome / Edge / Android Chrome** for the microphone (Web Speech API, `hi-IN`). Other browsers can type, and sample-phrase chips are provided.

## Demo script
1. Tap a mic and say: *"Kal subah 10 baje doctor ke clinic mein appointment kar dena, aur bijli bill ke liye kal 9 baje yaad dila dena."*
2. Agent reads both back: *"Doctor ka kal 10 AM ka appointment aur kal 9 AM Bijli bill payment ka reminder karna hai. Theek hai?"*
3. Say *"Haan"* → appointment + reminder created with Ref numbers, shown live in the side panel.
4. Say *"Bijli bill 1200 rupaye bhar do"* → *haan* → agent asks for **PIN** (demo `1234`, say "ek do teen char") before paying.
5. Say *"Mujhe kisi insaan se baat karni hai"* → handoff to a human operator.

## How it stays safe and bounded
| Rule | Where |
|---|---|
| Nothing executes before an explicit read-back + "haan" | `agent.js` confirm state |
| Sensitive actions (payments) need a PIN; 3 wrong tries block it and hand off | `SENSITIVE`, `MAX_PIN_TRIES` |
| Missing details are asked for, never guessed (amount, time, item…) | slot filling |
| Misunderstood 3× or "operator / insaan" → human handoff | `unclear()`, `handoff()` |
| Every utterance, decision and partner call is audit-logged (`/api/state`, `audit.log.jsonl`) | `services.audit` |
| Parser is deterministic rules, so every action is explainable and testable | `nlu.js` |

## Supported today
Appointments (doctor, mechanic, electrician, plumber, lab) · Reminders · Bill payment (bijli, paani, gas, mobile, internet) · Supplies ordering. Multiple requests in one sentence ("… aur …") and Devanagari speech output are handled.

## Scaling to a real phone line (next steps)
- **Telephony:** put Twilio / Exotel / Knowlarity in front of `POST /api/turn` for real calls on feature phones, using IVR speech-to-text (`hi-IN`, Bhashini or Google STT) and TTS.
- **Partners:** replace each `Services` method with a real adapter (clinic booking API, BBPS for bills, supplier API, Google Calendar/SMS for reminders).
- **Auth:** replace the demo PIN with per-user hashed PIN plus OTP to the registered number.
- **Languages:** add Tamil, Bengali, Marathi, Punjabi lexicons or swap `nlu.js` for an LLM that emits the same action JSON (the dialogue manager stays unchanged and still gates every action).
- **New verticals:** a new skill is one entry in `SLOT_ORDER`, `QUESTIONS`, `describe`, `execute` and a `Services` method.

## Honest limits
Rule-based NLU covers common phrasings, not every dialect. Reminders are stored but not yet delivered as outbound calls. Single shared demo state, and in-memory sessions.
