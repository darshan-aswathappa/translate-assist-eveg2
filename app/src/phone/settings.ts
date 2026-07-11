// Settings view: enter + save the Groq and Anthropic API keys. Keys persist in
// the Even app's storage (bridge.setLocalStorage) and are shown masked once
// saved. No login — the keys are the only credentials this app has.

import { createApiClient } from "../api/client";
import { FUNCTIONS_BASE } from "../config";
import { maskKey, type KeyStore, type UserKeys } from "./keys";

export interface SettingsDeps {
  keyStore: KeyStore;
  onKeysSaved: (keys: UserKeys) => void;
}

export function mountSettings(root: HTMLElement, deps: SettingsDeps): void {
  root.innerHTML = `
    <div class="ta-field">
      <label>Groq API key (Whisper transcription)</label>
      <input type="password" data-key="groq" placeholder="gsk_…" autocomplete="off" />
      <div class="ta-hint" data-hint="groq"></div>
    </div>
    <div class="ta-field">
      <label>Anthropic API key (translation + replies)</label>
      <input type="password" data-key="anthropic" placeholder="sk-ant-…" autocomplete="off" />
      <div class="ta-hint" data-hint="anthropic"></div>
    </div>
    <button class="ta-btn" data-action="save">Save keys</button>
    <div class="ta-msg" data-msg></div>`;

  const groqInput = root.querySelector('[data-key="groq"]') as HTMLInputElement;
  const anthropicInput = root.querySelector('[data-key="anthropic"]') as HTMLInputElement;
  const groqHint = root.querySelector('[data-hint="groq"]') as HTMLElement;
  const anthropicHint = root.querySelector('[data-hint="anthropic"]') as HTMLElement;
  const saveBtn = root.querySelector('[data-action="save"]') as HTMLButtonElement;
  const msg = root.querySelector("[data-msg]") as HTMLElement;

  function showSaved(keys: UserKeys): void {
    groqHint.textContent = keys.groqKey ? `Saved: ${maskKey(keys.groqKey)}` : "Not set";
    anthropicHint.textContent = keys.anthropicKey
      ? `Saved: ${maskKey(keys.anthropicKey)}`
      : "Not set";
  }

  void deps.keyStore.getKeys().then(showSaved);

  saveBtn.addEventListener("click", () => {
    void (async () => {
      msg.classList.remove("err");
      const existing = await deps.keyStore.getKeys();
      // Empty input = keep the currently saved key; typed input replaces it.
      const keys: UserKeys = {
        groqKey: groqInput.value.trim() || existing.groqKey,
        anthropicKey: anthropicInput.value.trim() || existing.anthropicKey,
      };
      if (!keys.groqKey || !keys.anthropicKey) {
        msg.classList.add("err");
        msg.textContent = "Both keys are required.";
        return;
      }
      saveBtn.disabled = true;
      msg.textContent = "Verifying…";
      try {
        await verifyKeys(keys);
        await deps.keyStore.setKeys(keys);
        groqInput.value = "";
        anthropicInput.value = "";
        showSaved(keys);
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

// Lightweight liveness check: a tiny respond call exercises the Anthropic key;
// transcribe is checked implicitly on first use (a fake WAV would waste a call).
async function verifyKeys(keys: UserKeys): Promise<void> {
  if (!keys.groqKey.startsWith("gsk_")) {
    throw new Error("Groq keys start with gsk_ — double-check the Groq key.");
  }
  if (!keys.anthropicKey.startsWith("sk-ant-")) {
    throw new Error("Anthropic keys start with sk-ant- — double-check the Anthropic key.");
  }
  const api = createApiClient({ baseUrl: FUNCTIONS_BASE, timeoutMs: 15_000 });
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
