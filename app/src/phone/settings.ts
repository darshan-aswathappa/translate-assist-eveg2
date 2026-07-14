// Settings view. Top card shows the current plan: Pro renders subscription
// status + monthly fair-use meters (fetched on tab show); Free renders the
// BYOK key form plus an Upgrade-to-Pro section. Key terms get their own card —
// they bias transcription in both tiers. Keys/token persist in the Even app's
// storage (bridge.setLocalStorage); no login — those are the only credentials.

import { createApiClient, ApiError, type ApiClient, type LicenseStatus } from "../api/client";
import { pcmToWav } from "../audio/wav";
import { FUNCTIONS_BASE } from "../config";
import { isValidDeepgramKey, maskKey, parseKeyterms, type KeyStore, type UserKeys } from "./keys";
import type { LicenseStore, Plan } from "./license";
import { mountProUpgrade } from "./proUpgrade";

export interface SettingsDeps {
  keyStore: KeyStore;
  licenseStore: LicenseStore;
  api: ApiClient;
  onKeysSaved: (keys: UserKeys) => void;
  onKeytermsSaved: (terms: string[]) => void;
  onActivated: (deviceToken: string, plan: Plan) => void;
  onProRemoved: () => void;
}

export interface SettingsView {
  /** Re-render the plan card (and body, if the tier changed since last time). */
  refresh(): void;
}

const PLAN_LABEL: Record<Plan, string> = {
  monthly: "Pro Monthly — $7.99/mo",
  yearly: "Pro Yearly — $6/mo",
};

const STATUS_NOTE: Record<LicenseStatus["status"], string> = {
  active: "",
  past_due: "Payment failed — update billing via your Stripe receipt email.",
  canceled: "Subscription canceled — Pro requests are disabled.",
};

function usageBar(label: string, used: number, cap: number, unit: string): string {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return `
    <div class="eh-usage-line"><span>${label}</span><span>${used} / ${cap} ${unit}</span></div>
    <div class="eh-progress${pct >= 90 ? " warn" : ""}"><span style="width:${pct}%"></span></div>`;
}

export function mountSettings(root: HTMLElement, deps: SettingsDeps): SettingsView {
  root.innerHTML = `
    <div class="eh-section-label" style="margin-top:0">Plan</div>
    <div data-plan></div>
    <div data-body></div>`;
  const planEl = root.querySelector("[data-plan]") as HTMLElement;
  const bodyEl = root.querySelector("[data-body]") as HTMLElement;

  // Sentinel forces the first render to lay out the body.
  let lastToken: string | null = null;

  function renderProPlan(status: LicenseStatus | null, error: string | null): void {
    if (!status) {
      planEl.innerHTML = `<div class="eh-card"><div class="eh-row-title">Pro</div>
        <div class="eh-row-sub" style="margin-top:4px">${error ?? "Checking subscription…"}</div></div>`;
      return;
    }
    const note = STATUS_NOTE[status.status];
    const audioMinutes = Math.round(status.usage.audio_seconds / 60);
    const capMinutes = Math.round(status.caps.audio_seconds / 60);
    planEl.innerHTML = `
      <div class="eh-card">
        <div class="eh-row-title">${PLAN_LABEL[status.plan]}</div>
        ${note ? `<div class="eh-row-sub" style="color:var(--signal-red); margin-top:4px">${note}</div>` : ""}
        ${usageBar("Audio this month", audioMinutes, capMinutes, "min")}
        ${usageBar("Translations this month", status.usage.claude_turns, status.caps.claude_turns, "turns")}
        <button class="eh-btn ghost danger small" data-action="remove-pro" style="width:100%; margin-top:16px">
          Remove Pro from this device
        </button>
        <div class="eh-hint">The license stays used — removal only forgets it here.</div>
      </div>`;
    (planEl.querySelector('[data-action="remove-pro"]') as HTMLButtonElement).addEventListener(
      "click",
      () => {
        void deps.licenseStore.clear().then(() => {
          deps.onProRemoved();
          refresh();
        });
      },
    );
  }

  function renderFreeBody(): void {
    bodyEl.innerHTML = `
      <div class="eh-section-label">API keys</div>
      <div data-keys></div>
      <div class="eh-section-label">Upgrade to Pro</div>
      <div class="eh-hint" style="padding: 0 4px 8px">No API accounts needed — we handle the keys.</div>
      <div data-upgrade></div>
      <div class="eh-section-label">Key terms</div>
      <div data-keyterms></div>`;
    mountKeysForm(bodyEl.querySelector("[data-keys]") as HTMLElement, deps);
    mountProUpgrade(bodyEl.querySelector("[data-upgrade]") as HTMLElement, {
      api: deps.api,
      licenseStore: deps.licenseStore,
      onActivated: (token, plan) => {
        deps.onActivated(token, plan);
        refresh();
      },
    });
    mountKeytermsForm(bodyEl.querySelector("[data-keyterms]") as HTMLElement, deps);
  }

  function renderProBody(): void {
    bodyEl.innerHTML = `
      <div class="eh-section-label">Key terms</div>
      <div data-keyterms></div>`;
    mountKeytermsForm(bodyEl.querySelector("[data-keyterms]") as HTMLElement, deps);
  }

  function refresh(): void {
    void (async () => {
      const token = await deps.licenseStore.getDeviceToken();
      if (token !== lastToken) {
        lastToken = token;
        if (token) renderProBody();
        else renderFreeBody();
      }
      if (token) {
        renderProPlan(null, null);
        try {
          renderProPlan(await deps.api.licenseStatus(token), null);
        } catch (err) {
          renderProPlan(
            null,
            err instanceof ApiError ? err.message : "Could not check the subscription — offline?",
          );
        }
      } else {
        planEl.innerHTML = `<div class="eh-card">
          <div class="eh-row-title">Free — your own API keys</div>
          <div class="eh-row-sub" style="margin-top:4px">Requests use the Deepgram and Anthropic keys below.</div>
        </div>`;
      }
    })();
  }

  refresh();
  return { refresh };
}

// ─── Free-tier API keys form (verify + save) ─────────────────────────────────

function mountKeysForm(root: HTMLElement, deps: SettingsDeps): void {
  root.innerHTML = `
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

// ─── Key terms (both tiers — they bias transcription) ────────────────────────

function mountKeytermsForm(root: HTMLElement, deps: SettingsDeps): void {
  root.innerHTML = `
    <div class="eh-card">
      <div class="eh-field">
        <label class="eh-label">Names, places, jargon (one per line)</label>
        <textarea class="eh-input" data-key="keyterms" rows="3" placeholder="e.g. Nestor&#10;Shibuya&#10;HireFeed" autocomplete="off"></textarea>
        <div class="eh-hint">Boosts recognition of these words across languages. Optional; up to 50.</div>
      </div>
      <button class="eh-btn" data-action="save-terms" style="width:100%">Save terms</button>
      <div class="eh-msg" data-msg-terms></div>
    </div>`;

  const keytermsInput = root.querySelector('[data-key="keyterms"]') as HTMLTextAreaElement;
  const saveBtn = root.querySelector('[data-action="save-terms"]') as HTMLButtonElement;
  const msg = root.querySelector("[data-msg-terms]") as HTMLElement;

  void deps.keyStore.getKeyterms().then((terms) => {
    keytermsInput.value = terms.join("\n");
  });

  saveBtn.addEventListener("click", () => {
    void (async () => {
      const terms = parseKeyterms(keytermsInput.value);
      await deps.keyStore.setKeyterms(terms);
      msg.classList.add("ok");
      msg.textContent = "Terms saved — applied on the next connection.";
      deps.onKeytermsSaved(terms);
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
  await api.transcribe(silence, { auth: { deepgramKey: keys.deepgramKey } });

  const thread = await api.createThread();
  try {
    await api.respond({
      auth: { anthropicKey: keys.anthropicKey },
      threadId: thread.id,
      text: "こんにちは",
      language: "ja",
      context: [],
    });
  } finally {
    await api.deleteThread(thread.id).catch(() => {});
  }
}
