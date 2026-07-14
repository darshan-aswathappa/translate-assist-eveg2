// Settings view: enter + save the Deepgram and Anthropic API keys. Keys persist
// in the Even app's storage (bridge.setLocalStorage) and are shown masked once
// saved. No login — the keys are the only credentials this app has. Styled as
// an Even Hub card form with an accent save button.

import { createApiClient } from "../api/client";
import { pcmToWav } from "../audio/wav";
import { FUNCTIONS_BASE } from "../config";
import { isValidDeepgramKey, maskKey, type KeyStore, type UserKeys } from "./keys";

export interface SettingsDeps {
  keyStore: KeyStore;
  onKeysSaved: (keys: UserKeys) => void;
}

export function mountSettings(root: HTMLElement, deps: SettingsDeps): void {
  root.innerHTML = `
    <div class="eh-section-label" style="margin-top:0">API keys</div>
    <div class="eh-card">
      <div class="eh-field">
        <label class="eh-label">Deepgram API key — transcription</label>
        <input class="eh-input" type="password" data-key="deepgram" placeholder="Deepgram API key" autocomplete="off" />
        <div class="eh-hint" data-hint="deepgram"></div>
      </div>
      <div class="eh-field">
        <label class="eh-label">Anthropic API key — translation + replies</label>
        <input class="eh-input" type="password" data-key="anthropic" placeholder="sk-ant-…" autocomplete="off" />
        <div class="eh-hint" data-hint="anthropic"></div>
      </div>
      <button class="eh-btn accent" data-action="save" style="width:100%">Save keys</button>
      <div class="eh-msg" data-msg></div>
    </div>
    <div class="eh-hint" style="padding:0 4px">
      Keys are stored only on this phone via the Even app's secure storage and
      sent per-request to the Translate Assist backend. They never leave the
      device otherwise.
    </div>`;

  const deepgramInput = root.querySelector('[data-key="deepgram"]') as HTMLInputElement;
  const anthropicInput = root.querySelector('[data-key="anthropic"]') as HTMLInputElement;
  const deepgramHint = root.querySelector('[data-hint="deepgram"]') as HTMLElement;
  const anthropicHint = root.querySelector('[data-hint="anthropic"]') as HTMLElement;
  const saveBtn = root.querySelector('[data-action="save"]') as HTMLButtonElement;
  const msg = root.querySelector("[data-msg]") as HTMLElement;

  function showSaved(keys: UserKeys): void {
    deepgramHint.textContent = keys.deepgramKey ? `Saved: ${maskKey(keys.deepgramKey)}` : "Not set";
    anthropicHint.textContent = keys.anthropicKey
      ? `Saved: ${maskKey(keys.anthropicKey)}`
      : "Not set";
  }

  void deps.keyStore.getKeys().then(showSaved);

  saveBtn.addEventListener("click", () => {
    void (async () => {
      msg.classList.remove("err", "ok");
      const existing = await deps.keyStore.getKeys();
      // Empty input = keep the currently saved key; typed input replaces it.
      const keys: UserKeys = {
        deepgramKey: deepgramInput.value.trim() || existing.deepgramKey,
        anthropicKey: anthropicInput.value.trim() || existing.anthropicKey,
      };
      if (!keys.deepgramKey || !keys.anthropicKey) {
        msg.classList.add("err");
        msg.textContent = "Both keys are required.";
        return;
      }
      saveBtn.disabled = true;
      msg.textContent = "Verifying…";
      try {
        await verifyKeys(keys);
        await deps.keyStore.setKeys(keys);
        deepgramInput.value = "";
        anthropicInput.value = "";
        showSaved(keys);
        msg.classList.add("ok");
        msg.textContent = "Keys verified and saved.";
        deps.onKeysSaved(keys);
      } catch (err) {
        msg.classList.add("err");
        msg.textContent = err instanceof Error ? err.message : "Verification failed";
      } finally {
        saveBtn.disabled = false;
      }
    })();
  });
}

// Liveness checks: exercise both keys against their providers now, so a bad or
// unfunded key surfaces here instead of as a generic "ERROR" mid-conversation.
async function verifyKeys(keys: UserKeys): Promise<void> {
  if (!isValidDeepgramKey(keys.deepgramKey)) {
    throw new Error("Deepgram keys are 40-character hex strings — double-check the Deepgram key.");
  }
  if (!keys.anthropicKey.startsWith("sk-ant-")) {
    throw new Error("Anthropic keys start with sk-ant- — double-check the Anthropic key.");
  }
  const api = createApiClient({ baseUrl: FUNCTIONS_BASE, timeoutMs: 15_000 });

  // Deepgram: ~200 ms of silence is enough to authenticate the key (an empty
  // transcript is expected). Catches 401 (bad key) / quota errors up front.
  const silence = pcmToWav(new Uint8Array(6_400));
  await api.transcribe(silence, { deepgramKey: keys.deepgramKey });

  const thread = await api.createThread();
  try {
    await api.respond({
      anthropicKey: keys.anthropicKey,
      threadId: thread.id,
      text: "こんにちは",
      language: "ja",
      context: [],
    });
  } finally {
    await api.deleteThread(thread.id).catch(() => {});
  }
}
