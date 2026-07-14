// Pro purchase + activation fragment, shared by onboarding and Settings.
// Checkout happens in the phone browser via static Stripe Payment Links —
// the Even WebView has no openUrl bridge, so each plan offers both a
// target=_blank anchor (works if the WebView allows popouts) and a copy-link
// fallback. After paying, the buyer gets a TA-… license key on the success
// page and redeems it here for this device's token.

import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import { CHECKOUT_URL_MONTHLY, CHECKOUT_URL_YEARLY } from "../config";
import { isValidLicenseKey, normalizeLicenseKey, type LicenseStore, type Plan } from "./license";

export interface ProUpgradeDeps {
  api: ApiClient;
  licenseStore: LicenseStore;
  onActivated: (deviceToken: string, plan: Plan) => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older WebViews: clipboard API unavailable — fall back to execCommand.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function planRow(label: string, price: string, note: string, url: string, id: string): string {
  if (!url) return "";
  return `
    <div class="eh-row div">
      <div class="eh-row-main">
        <div class="eh-row-title">${label}</div>
        <div class="eh-row-sub">${price} <span>· ${note}</span></div>
      </div>
      <div class="eh-row-trail">
        <a class="eh-btn small accent" href="${url}" target="_blank" rel="noopener">Checkout</a>
        <button class="eh-btn small ghost" data-copy="${id}">Copy link</button>
      </div>
    </div>`;
}

export function mountProUpgrade(root: HTMLElement, deps: ProUpgradeDeps): void {
  const hasCheckout = Boolean(CHECKOUT_URL_MONTHLY || CHECKOUT_URL_YEARLY);
  root.innerHTML = `
    <div class="eh-card flush">
      ${planRow("Pro Monthly", "$7.99 / month", "cancel anytime", CHECKOUT_URL_MONTHLY, "monthly")}
      ${planRow("Pro Yearly", "$6 / month", "billed $72 / year", CHECKOUT_URL_YEARLY, "yearly")}
      ${hasCheckout ? "" : `<div class="eh-row"><div class="eh-row-sub">Checkout is not configured in this build.</div></div>`}
    </div>
    <div class="eh-hint" style="padding:0 4px">
      Checkout opens in your phone browser (or copy the link and paste it there).
      Your license key appears right after payment — then activate it below.
    </div>
    <div class="eh-card" style="margin-top:12px">
      <div class="eh-field">
        <label class="eh-label">License key — from your purchase</label>
        <input class="eh-input" data-license type="text" placeholder="TA-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" />
      </div>
      <button class="eh-btn accent" data-action="activate" style="width:100%">Activate Pro</button>
      <div class="eh-msg" data-msg></div>
    </div>`;

  const input = root.querySelector("[data-license]") as HTMLInputElement;
  const activateBtn = root.querySelector('[data-action="activate"]') as HTMLButtonElement;
  const msg = root.querySelector("[data-msg]") as HTMLElement;

  for (const btn of root.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    btn.addEventListener("click", () => {
      const url = btn.dataset.copy === "yearly" ? CHECKOUT_URL_YEARLY : CHECKOUT_URL_MONTHLY;
      void copyText(url).then((ok) => {
        btn.textContent = ok ? "Copied ✓" : "Copy failed";
        setTimeout(() => (btn.textContent = "Copy link"), 2_000);
      });
    });
  }

  activateBtn.addEventListener("click", () => {
    void (async () => {
      msg.classList.remove("err", "ok");
      const raw = input.value;
      if (!isValidLicenseKey(raw)) {
        msg.classList.add("err");
        msg.textContent = "License keys look like TA-XXXX-XXXX-XXXX-XXXX — check for typos.";
        return;
      }
      activateBtn.disabled = true;
      msg.textContent = "Activating…";
      try {
        const { device_token, plan } = await deps.api.activateLicense(normalizeLicenseKey(raw));
        await deps.licenseStore.setActivation(device_token, plan);
        input.value = "";
        msg.classList.add("ok");
        msg.textContent = "Pro activated on this device.";
        deps.onActivated(device_token, plan);
      } catch (err) {
        msg.classList.add("err");
        msg.textContent =
          err instanceof ApiError ? err.message : "Activation failed — check your connection.";
      } finally {
        activateBtn.disabled = false;
      }
    })();
  });
}
