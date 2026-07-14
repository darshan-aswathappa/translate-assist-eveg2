// Translate Assist — app entry / orchestration.
//
// Pipeline (streaming, the default): glasses mic → energy-VAD speech gate →
// Deepgram live WebSocket (interim captions on the HUD as the partner speaks)
// → finalized segments → edge fn `respond` (Claude translation first, then 3
// suggested replies as a follow-up) → HUD. If the WebSocket can't connect or
// keeps dropping, the app falls back to the batch path: VAD utterance
// segmentation → WAV → edge fn `transcribe` (Deepgram pre-recorded REST).
//
// The speaker's language locks after the first non-English detection. Swipe
// cycles translation pages + replies, tap pauses the mic, double-tap exits.
// The phone shows Live/Sessions/Settings.

import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";
import {
  DEV_MODE,
  FUNCTIONS_BASE,
  RESPOND_TIMEOUT_MS,
  TRANSCRIBE_TIMEOUT_MS,
} from "./config";
import { createApiClient, ApiError } from "./api/client";
import { connectDeepgramLive, type DeepgramLive, type LiveSegment } from "./api/deepgramLive";
import { startCapture, type AudioCapture } from "./audio/capture";
import {
  createSpeechGate,
  createUtteranceSegmenter,
  type SpeechGate,
  type UtteranceSegmenter,
} from "./audio/vad";
import { pcmToWav } from "./audio/wav";
import {
  initialConversation,
  recentContext,
  withDetectedLanguage,
  withThread,
  withTurn,
  type Conversation,
  type Suggestion,
} from "./conversation/thread";
import { clampIndex, hudText, paneCount } from "./glasses/layout";
import { actionForEvent } from "./glasses/input";
import { createPage, initRender, updateHud } from "./glasses/render";
import { createKeyStore, type UserKeys } from "./phone/keys";
import { mountPhoneUi, type PhoneUi } from "./phone/ui";
import { runDevFixtures } from "./devFixtures";

// Segments shorter than this are held and coalesced with the next one so
// Claude isn't asked to translate lone interjections mid-monologue.
const MIN_SEGMENT_CHARS = 10;
// How long after the speech gate closes to give Deepgram's Finalize response
// before a held short segment is translated on its own.
const SEGMENT_FLUSH_DELAY_MS = 1_000;
// Streaming failures before giving up and switching to the batch path.
const MAX_WS_FAILURES = 3;

const bridge = await waitForEvenAppBridge();
initRender(bridge);

const api = createApiClient({
  baseUrl: FUNCTIONS_BASE,
  timeoutMs: RESPOND_TIMEOUT_MS,
  transcribeTimeoutMs: TRANSCRIBE_TIMEOUT_MS,
  retries: 2,
});
const keyStore = createKeyStore(bridge);

// ─── State ───────────────────────────────────────────────────────────────────

let conversation: Conversation = initialConversation();
let keys: UserKeys = { deepgramKey: "", anthropicKey: "" };
let paused = false;
let pipelineStarted = false;
let mode: "streaming" | "batch" = "streaming";

// Current HUD result (last turn + which pane is showing).
let shownTranslation = "";
let shownSuggestions: readonly Suggestion[] = [];
let shownIndex = 0;

let capture: AudioCapture | null = null;
let segmenter: UtteranceSegmenter | null = null;
let gate: SpeechGate | null = null;
let live: DeepgramLive | null = null;
let wsFailures = 0;

// Batch mode: utterances are transcribed strictly in order.
let transcribing: Promise<void> = Promise.resolve();
// Translations run on their own queue, decoupled from transcription, so the
// HUD can show the next caption while Claude works on the previous segment.
let translating: Promise<void> = Promise.resolve();
// Monotonic turn counter — guards late suggestion responses from overwriting
// a newer turn on the HUD.
let turnSeq = 0;

// A short segment held back for coalescing with the next one.
let pendingSegment: LiveSegment | null = null;
let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Rendering ───────────────────────────────────────────────────────────────

function showStatus(label: string): void {
  updateHud(hudText({ kind: "status", label }));
  ui.live.setStatus(label);
}

function showCaption(text: string): void {
  updateHud(hudText({ kind: "caption", text }));
  ui.live.setCaption(text);
}

function showResult(): void {
  ui.live.setCaption(null);
  updateHud(
    hudText({
      kind: "result",
      translation: shownTranslation,
      suggestions: shownSuggestions,
      index: shownIndex,
    }),
  );
}

// ─── Phone UI ────────────────────────────────────────────────────────────────

const ui: PhoneUi = mountPhoneUi(document.getElementById("app") as HTMLElement, {
  keyStore,
  api,
  getActiveThreadId: () => conversation.threadId,
  onKeysSaved: (saved) => {
    keys = saved;
    if (!pipelineStarted) void startPipeline();
  },
  onNewSession: async () => {
    const { id } = await api.createThread();
    conversation = withThread(initialConversation(), id);
    shownTranslation = "";
    shownSuggestions = [];
    shownIndex = 0;
    turnSeq++;
    pendingSegment = null;
    ui.live.reset();
    ui.live.setLanguage(null);
    if (pipelineStarted) showStatus("LISTENING");
  },
});

// ─── Errors ──────────────────────────────────────────────────────────────────

// The glasses HUD only fits a short label; the detailed cause goes to the phone
// Live view (console.error is invisible on-device).
function describeError(err: unknown): string {
  if (err instanceof ApiError) return `${err.status} · ${err.message}`;
  if (err instanceof DOMException && err.name === "AbortError") return "Request timed out";
  if (err instanceof Error) return err.message; // e.g. "Failed to fetch" (network/CORS)
  return String(err);
}

function showPipelineError(err: unknown): void {
  console.error("pipeline error:", err);
  const label =
    err instanceof ApiError && err.status === 401
      ? "CHECK API KEYS ON PHONE"
      : "ERROR — STILL LISTENING";
  showStatus(label);
  ui.live.setError(describeError(err));
}

// ─── Translation queue ───────────────────────────────────────────────────────

function handleSegment(seg: LiveSegment): void {
  if (!conversation.threadId) return;
  if (pendingFlushTimer !== null) {
    clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
  }

  // Before the language locks, English is assumed to be the wearer's own
  // voice bleeding into the mic — ignore it rather than locking onto it.
  if (!conversation.lockedLanguage && seg.language === "en") {
    ui.live.setCaption(null);
    if (shownTranslation) showResult();
    else showStatus("LISTENING");
    return;
  }
  conversation = withDetectedLanguage(conversation, seg.language);
  ui.live.setLanguage(conversation.lockedLanguage);

  if (pendingSegment) {
    seg = {
      text: `${pendingSegment.text} ${seg.text}`.trim(),
      language: pendingSegment.language || seg.language,
    };
    pendingSegment = null;
  }
  // Very short segments read as choppy one-word turns — hold them briefly so
  // they merge with the continuation.
  if (seg.text.length < MIN_SEGMENT_CHARS) {
    pendingSegment = seg;
    scheduleSegmentFlush();
    return;
  }

  showCaption(seg.text);
  enqueueTranslation(seg);
}

function scheduleSegmentFlush(): void {
  if (pendingFlushTimer !== null) clearTimeout(pendingFlushTimer);
  pendingFlushTimer = setTimeout(() => {
    pendingFlushTimer = null;
    flushPendingSegment();
  }, SEGMENT_FLUSH_DELAY_MS);
}

function flushPendingSegment(): void {
  if (!pendingSegment) return;
  const seg = pendingSegment;
  pendingSegment = null;
  showCaption(seg.text);
  enqueueTranslation(seg);
}

function enqueueTranslation(seg: LiveSegment): void {
  translating = translating.then(() => translateSegment(seg));
}

async function translateSegment(seg: LiveSegment): Promise<void> {
  if (!conversation.threadId) return;
  const seq = ++turnSeq;
  const language = conversation.lockedLanguage ?? seg.language;
  try {
    ui.live.setError(null);
    const context = recentContext(conversation, 10);
    const r = await api.respond({
      anthropicKey: keys.anthropicKey,
      threadId: conversation.threadId,
      text: seg.text,
      language,
      context,
      mode: "translate",
    });
    // Context for later segments needs this original even before suggestions
    // arrive; the suggestions call only decorates the turn.
    conversation = withTurn(conversation, {
      original: seg.text,
      translation: r.translation_en,
      suggestions: [],
    });
    if (seq === turnSeq) {
      shownTranslation = r.translation_en;
      shownSuggestions = [];
      shownIndex = 0;
      showResult();
      ui.live.setStatus("LISTENING");
    }
    void fetchSuggestions(seq, seg.text, r.translation_en, language, context, r.utterance_id);
  } catch (err) {
    showPipelineError(err);
  }
}

// Suggestions are fetched after the translation is already on the HUD, and
// never block the next segment's translation.
async function fetchSuggestions(
  seq: number,
  original: string,
  translation: string,
  language: string,
  context: readonly string[],
  utteranceId: string | null | undefined,
): Promise<void> {
  let suggestions: Suggestion[] = [];
  try {
    const r = await api.respond({
      anthropicKey: keys.anthropicKey,
      threadId: conversation.threadId ?? "",
      text: original,
      language,
      context,
      mode: "suggest",
      utteranceId: utteranceId ?? undefined,
    });
    suggestions = r.suggestions;
  } catch (err) {
    console.error("suggestions failed:", err);
  }
  ui.live.addTurn({ original, translation, suggestions });
  if (seq === turnSeq && suggestions.length > 0) {
    shownSuggestions = suggestions;
    shownIndex = clampIndex(shownIndex, paneCount(shownTranslation, suggestions));
    showResult();
  }
}

// ─── Batch (fallback) transcription path ─────────────────────────────────────

async function transcribeUtterance(pcm: Uint8Array): Promise<void> {
  if (!conversation.threadId) return;
  try {
    ui.live.setError(null);
    showStatus("TRANSCRIBING");
    const wav = pcmToWav(pcm);
    const t = await api.transcribe(wav, {
      deepgramKey: keys.deepgramKey,
      language: conversation.lockedLanguage ?? undefined,
    });
    if (!t.text) {
      showStatus("LISTENING");
      return;
    }
    handleSegment({ text: t.text, language: t.language });
  } catch (err) {
    showPipelineError(err);
  }
}

function onUtterance(pcm: Uint8Array): void {
  transcribing = transcribing.then(() => transcribeUtterance(pcm));
}

function switchToBatch(): void {
  if (mode === "batch") return;
  console.warn("streaming unavailable — falling back to batch transcription");
  mode = "batch";
  gate = null;
  live?.close();
  live = null;
  segmenter = createUtteranceSegmenter({ onUtterance });
  if (pipelineStarted && !paused) showStatus("LISTENING");
}

// ─── Streaming transcription path ────────────────────────────────────────────

async function startStreaming(): Promise<void> {
  const connection = await connectDeepgramLive({
    apiKey: keys.deepgramKey,
    language: conversation.lockedLanguage ?? undefined,
    onInterim: (text) => {
      if (!paused) showCaption(text);
    },
    onSegment: (seg) => {
      wsFailures = 0;
      handleSegment(seg);
    },
    onClose: () => {
      live = null;
      handleStreamingDrop();
    },
  });
  live = connection;
  if (!gate) {
    gate = createSpeechGate({
      onAudio: (frame) => live?.sendPcm(frame),
      onGateClose: () => {
        // Flush anything Deepgram is still buffering, then translate a held
        // short segment if no continuation follows.
        live?.finalize();
        scheduleSegmentFlush();
      },
    });
  }
}

function handleStreamingDrop(): void {
  if (teardownDone || !pipelineStarted || mode !== "streaming") return;
  wsFailures++;
  if (wsFailures >= MAX_WS_FAILURES) {
    switchToBatch();
    return;
  }
  setTimeout(() => {
    if (teardownDone || mode !== "streaming" || live) return;
    startStreaming().catch(() => handleStreamingDrop());
  }, 1_000 * wsFailures);
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

async function startPipeline(): Promise<void> {
  if (pipelineStarted) return;
  pipelineStarted = true;
  try {
    if (!conversation.threadId) {
      const { id } = await api.createThread();
      conversation = withThread(conversation, id);
    }
    try {
      await startStreaming();
      mode = "streaming";
    } catch (err) {
      console.warn("live transcription connect failed:", err);
      mode = "batch";
      segmenter = createUtteranceSegmenter({ onUtterance });
    }
    capture = await startCapture(bridge, (frame) => {
      if (paused) return;
      if (mode === "streaming") gate?.push(frame);
      else segmenter?.push(frame);
    });
    showStatus("LISTENING");
  } catch (err) {
    console.error("pipeline start failed:", err);
    pipelineStarted = false;
    showStatus("ERROR — CHECK PHONE");
  }
}

// ─── Glasses input ───────────────────────────────────────────────────────────

let teardownDone = false;
function teardown(): void {
  if (teardownDone) return;
  teardownDone = true;
  void capture?.stop();
  live?.close();
  live = null;
}

const unsubscribe = bridge.onEvenHubEvent((event) => {
  // Audio frames first — they are by far the most frequent event.
  capture?.handleEvent(event);

  switch (actionForEvent(event)) {
    case "prev":
    case "next": {
      const panes = paneCount(shownTranslation, shownSuggestions);
      if (!shownTranslation || panes <= 1) break;
      const delta = actionForEvent(event) === "next" ? 1 : -1;
      shownIndex = clampIndex(shownIndex + delta, panes);
      showResult();
      break;
    }
    case "toggle-pause":
      paused = !paused;
      if (paused) {
        segmenter?.flush();
        live?.finalize();
        scheduleSegmentFlush();
        showStatus("PAUSED — TAP TO RESUME");
      } else if (shownTranslation) {
        showResult();
        ui.live.setStatus("LISTENING");
      } else {
        showStatus("LISTENING");
      }
      break;
    case "exit-dialog":
      // Don't tear down yet — the user can cancel the system dialog. Cleanup
      // happens on SYSTEM_EXIT / ABNORMAL_EXIT.
      void bridge.shutDownPageContainer(1);
      break;
    case "cleanup":
      teardown();
      unsubscribe();
      break;
  }
});

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", teardown);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

const created = await createPage(hudText({ kind: "status", label: "STARTING" }));
console.log("Page created:", created === 0 ? "success" : `failed(${created})`);

if (DEV_MODE) {
  runDevFixtures({
    setResult: (translation, suggestions) => {
      shownTranslation = translation;
      shownSuggestions = suggestions;
      shownIndex = 0;
      showResult();
      ui.live.addTurn({ original: "(dev fixture)", translation, suggestions });
    },
    showStatus,
    ui,
  });
} else {
  keys = await keyStore.getKeys();
  if (keys.deepgramKey && keys.anthropicKey) {
    void startPipeline();
  } else {
    showStatus("SET API KEYS ON PHONE");
    ui.showTab("settings");
  }
}
