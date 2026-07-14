# Translate Assist — Even G2 Live Translation

## What it does

Worn G2 glasses listen to a conversation partner speaking a foreign language.
Each utterance is transcribed (Deepgram nova-3), translated to English, and
answered with 3 suggested replies in the speaker's language (native script +
romanization + English gloss), shown on the glasses HUD:

```
"Do you speak English?"

[2/3]
すみません、あまり得意ではありません。
Sumimasen, amari tokui dewa arimasen.
(Sorry, I'm not very good at it.)

<swipe for more>
```

- The speaker's language is auto-detected on the first utterance and locked
  for the rest of the conversation thread.
- Transcripts and threads persist in Supabase; the phone companion UI manages
  sessions (list / read / new / delete) and API keys. No login.

## Architecture

```
G2 glasses ──BLE──► Even app WebView (this app, on phone)
   mic PCM 16k s16le     │ energy-VAD segments utterances → WAV
                         │ user keys sent per-request (x-deepgram-key / x-anthropic-key)
                         ▼
             Supabase Edge Functions (pass-through proxies, CORS ours)
               ├─ transcribe → Deepgram nova-3
               ├─ respond   → Claude Sonnet: translation + 3 replies
               └─ threads   → create / list / fetch / delete
                         ▼
                   Supabase Postgres (threads, utterances; RLS locked,
                   service-role access from functions only)
```

## Controls (glasses)

| Gesture | Action |
| --- | --- |
| swipe up / down | cycle suggested replies [1/3]–[3/3] |
| single tap | pause / resume listening |
| double tap | system exit dialog |

## Dev loop (real device)

```
cd app && npm run dev
npx evenhub qr --url http://<mac-LAN-ip>:5173   # scan in Even app Developer Center
```

API keys are entered on the phone Settings screen and stored via
`bridge.setLocalStorage` (the only reliable persistence in the Even WebView).
