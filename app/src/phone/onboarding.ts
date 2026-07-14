// First-run tier picker, shown as a full-screen overlay instead of the tabs
// when the device has neither BYOK keys nor a Pro device token. Free routes to
// the Settings key form; Pro expands the shared purchase/activation fragment.
// Dismissal happens from main.ts once either credential exists.

import { mountProUpgrade, type ProUpgradeDeps } from "./proUpgrade";

export interface OnboardingDeps extends ProUpgradeDeps {
  /** "Use my own keys" — dismiss and land on the Settings tab. */
  onChooseFree: () => void;
}

export interface Onboarding {
  dismiss(): void;
}

export function mountOnboarding(host: HTMLElement, deps: OnboardingDeps): Onboarding {
  const overlay = document.createElement("div");
  overlay.className = "eh-onboarding";
  overlay.innerHTML = `
    <div class="eh-onboarding-inner">
      <div class="eh-nav-title" style="text-align:center; padding: 18px 0 4px">Welcome to Translate Assist</div>
      <div class="eh-hint" style="text-align:center; padding-bottom: 12px">
        Live translation on your G2 glasses. Choose how to power it:
      </div>

      <div class="eh-card">
        <div class="eh-row-title">Free — bring your own keys</div>
        <div class="eh-row-sub" style="margin: 4px 0 12px">
          Use your own Deepgram + Anthropic API keys. You pay the providers
          directly; nothing goes through us.
        </div>
        <button class="eh-btn" data-action="free" style="width:100%">Use my own keys</button>
      </div>

      <div class="eh-section-label">Pro — we handle the keys</div>
      <div class="eh-hint" style="padding: 0 4px 8px">
        No API accounts needed. Fair-use limits apply.
      </div>
      <div data-pro></div>
    </div>`;
  host.appendChild(overlay);

  (overlay.querySelector('[data-action="free"]') as HTMLButtonElement).addEventListener(
    "click",
    () => deps.onChooseFree(),
  );
  mountProUpgrade(overlay.querySelector("[data-pro]") as HTMLElement, deps);

  return {
    dismiss() {
      overlay.remove();
    },
  };
}
