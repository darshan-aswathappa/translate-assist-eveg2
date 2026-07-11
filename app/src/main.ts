// Translate Assist — app entry / orchestration.
//
// Pipeline: glasses mic → energy-VAD utterance segmentation → WAV → Supabase
// edge fn `transcribe` (Groq Whisper) → edge fn `respond` (Claude: English
// translation + 3 replies in the speaker's language) → HUD. The speaker's
// language locks after the first non-English detection. Swipe cycles replies,
// tap pauses the mic, double-tap exits. The phone shows Live/Sessions/Settings.

import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";
import { DEV_MODE, FUNCTIONS_BASE, RESPOND_TIMEOUT_MS } from "./config";
import { createApiClient, ApiError } from "./api/client";
import { startCapture, type AudioCapture } from "./audio/capture";
import { createUtteranceSegmenter, type UtteranceSegmenter } from "./audio/vad";
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
import { clampIndex, hudText } from "./glasses/layout";
import { actionForEvent } from "./glasses/input";
import { createPage, initRender, updateHud } from "./glasses/render";
import { createKeyStore, type UserKeys } from "./phone/keys";
import { mountPhoneUi, type PhoneUi } from "./phone/ui";
import { runDevFixtures } from "./devFixtures";

const bridge = await waitForEvenAppBridge();
initRender(bridge);

const api = createApiClient({ baseUrl: FUNCTIONS_BASE, timeoutMs: RESPOND_TIMEOUT_MS });
const keyStore = createKeyStore(bridge);

// ─── State ───────────────────────────────────────────────────────────────────

let conversation: Conversation = initialConversation();
let keys: UserKeys = { groqKey: "", anthropicKey: "" };
let paused = false;
let pipelineStarted = false;

// Current HUD result (last turn + which suggestion is showing).
let shownTranslation = "";
let shownSuggestions: readonly Suggestion[] = [];
let shownIndex = 0;

let capture: AudioCapture | null = null;
let segmenter: UtteranceSegmenter | null = null;

// Utterances are processed strictly in order; overlapping requests would
// scramble the conversation context.
let processing: Promise<void> = Promise.resolve();

// ─── Rendering ───────────────────────────────────────────────────────────────

function showStatus(label: string): void {
  updateHud(hudText({ kind: "status", label }));
  ui.live.setStatus(label);
}

function showResult(): void {
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
    ui.live.reset();
    ui.live.setLanguage(null);
    if (pipelineStarted) showStatus("LISTENING");
  },
});

// ─── Utterance pipeline ──────────────────────────────────────────────────────

async function processUtterance(pcm: Uint8Array): Promise<void> {
  if (!conversation.threadId) return;
  try {
    showStatus("TRANSCRIBING");
    const wav = pcmToWav(pcm);
    const t = await api.transcribe(wav, {
      groqKey: keys.groqKey,
      language: conversation.lockedLanguage ?? undefined,
    });
    if (!t.text) {
      showStatus("LISTENING");
      return;
    }

    // Before the language locks, English is assumed to be the wearer's own
    // voice bleeding into the mic — ignore it rather than locking onto it.
    if (!conversation.lockedLanguage && t.language === "en") {
      showStatus("LISTENING");
      return;
    }
    conversation = withDetectedLanguage(conversation, t.language);
    ui.live.setLanguage(conversation.lockedLanguage);

    showStatus("THINKING");
    const r = await api.respond({
      anthropicKey: keys.anthropicKey,
      threadId: conversation.threadId,
      text: t.text,
      language: conversation.lockedLanguage ?? t.language,
      context: recentContext(conversation, 10),
    });

    const turn = {
      original: t.text,
      translation: r.translation_en,
      suggestions: r.suggestions,
    };
    conversation = withTurn(conversation, turn);
    shownTranslation = r.translation_en;
    shownSuggestions = r.suggestions;
    shownIndex = 0;
    showResult();
    ui.live.addTurn(turn);
    ui.live.setStatus("LISTENING");
  } catch (err) {
    console.error("utterance pipeline failed:", err);
    const label =
      err instanceof ApiError && err.status === 401
        ? "CHECK API KEYS ON PHONE"
        : "ERROR — STILL LISTENING";
    showStatus(label);
  }
}

function onUtterance(pcm: Uint8Array): void {
  processing = processing.then(() => processUtterance(pcm));
}

async function startPipeline(): Promise<void> {
  if (pipelineStarted) return;
  pipelineStarted = true;
  try {
    if (!conversation.threadId) {
      const { id } = await api.createThread();
      conversation = withThread(conversation, id);
    }
    segmenter = createUtteranceSegmenter({ onUtterance });
    capture = await startCapture(bridge, (frame) => {
      if (!paused) segmenter?.push(frame);
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
}

const unsubscribe = bridge.onEvenHubEvent((event) => {
  // Audio frames first — they are by far the most frequent event.
  capture?.handleEvent(event);

  switch (actionForEvent(event)) {
    case "prev":
    case "next": {
      if (shownSuggestions.length === 0) break;
      const delta = actionForEvent(event) === "next" ? 1 : -1;
      shownIndex = clampIndex(shownIndex + delta, shownSuggestions.length);
      showResult();
      break;
    }
    case "toggle-pause":
      paused = !paused;
      if (paused) {
        segmenter?.flush();
        showStatus("PAUSED — TAP TO RESUME");
      } else if (shownSuggestions.length > 0) {
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
  if (keys.groqKey && keys.anthropicKey) {
    void startPipeline();
  } else {
    showStatus("SET API KEYS ON PHONE");
    ui.showTab("settings");
  }
}
