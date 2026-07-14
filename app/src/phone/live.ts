// Live view: a green-on-dark "glasses display" preview hero that mirrors what
// the G2 is showing right now (the signature Even Hub phone-side pattern), then
// a rolling list of translated turns as cards. All dynamic content is API/LLM-
// derived, so it is rendered with textContent only.

import type { Turn } from "../conversation/thread";

export interface LiveView {
  setStatus(text: string): void;
  setLanguage(lang: string | null): void;
  addTurn(turn: Turn): void;
  /** Show (or clear, with null) the live partial transcript while the partner
   * is still speaking — mirrors the caption on the glasses HUD. */
  setCaption(text: string | null): void;
  /** Show (or clear, with null) the last pipeline error — the glasses HUD only
   * has room for a short label, so the real cause is surfaced here. */
  setError(detail: string | null): void;
  reset(): void;
}

export function mountLive(root: HTMLElement): LiveView {
  root.innerHTML = `
    <div class="eh-hud">
      <div class="eh-hud-notch"><span></span><span></span></div>
      <div class="eh-hud-status">
        <span class="eh-hud-dot" data-dot></span>
        <span data-status>STARTING</span>
        <span class="eh-hud-lang" data-lang style="display:none"></span>
      </div>
      <div class="eh-hud-empty" data-empty>Turns will appear here as your partner speaks.</div>
      <div class="eh-hud-caption" data-caption style="display:none"></div>
      <div class="eh-hud-translation" data-translation style="display:none"></div>
      <div class="eh-hud-sug" data-suggestion style="display:none"></div>
      <div class="eh-hud-error" data-error style="display:none"></div>
    </div>
    <div class="eh-section-label">Recent turns</div>
    <div data-turns></div>`;

  const status = root.querySelector("[data-status]") as HTMLElement;
  const dot = root.querySelector("[data-dot]") as HTMLElement;
  const lang = root.querySelector("[data-lang]") as HTMLElement;
  const empty = root.querySelector("[data-empty]") as HTMLElement;
  const caption = root.querySelector("[data-caption]") as HTMLElement;
  const translation = root.querySelector("[data-translation]") as HTMLElement;
  const suggestion = root.querySelector("[data-suggestion]") as HTMLElement;
  const errorLine = root.querySelector("[data-error]") as HTMLElement;
  const turns = root.querySelector("[data-turns]") as HTMLElement;

  const ACTIVE = new Set(["LISTENING", "TRANSCRIBING", "THINKING"]);

  function setHud(statusText: string): void {
    status.textContent = statusText;
    dot.classList.toggle("idle", !ACTIVE.has(statusText));
  }

  return {
    setStatus(text) {
      setHud(text);
    },
    setCaption(text) {
      if (text) {
        empty.style.display = "none";
        caption.textContent = `» ${text}`;
        caption.style.display = "";
      } else {
        caption.textContent = "";
        caption.style.display = "none";
      }
    },
    setError(detail) {
      if (detail) {
        errorLine.textContent = `⚠ ${detail}`;
        errorLine.style.display = "";
      } else {
        errorLine.textContent = "";
        errorLine.style.display = "none";
      }
    },
    setLanguage(code) {
      if (code) {
        lang.textContent = code.toUpperCase();
        lang.style.display = "";
      } else {
        lang.style.display = "none";
      }
    },
    addTurn(turn) {
      empty.style.display = "none";

      // The HUD hero shows the latest turn verbatim — what the glasses display.
      translation.textContent = `"${turn.translation}"`;
      translation.style.display = "";
      const first = turn.suggestions[0];
      if (first) {
        suggestion.textContent = `↩ ${first.native}${first.gloss ? ` — ${first.gloss}` : ""}`;
        suggestion.style.display = "";
      } else {
        suggestion.style.display = "none";
      }

      const el = document.createElement("div");
      el.className = "eh-card";
      const orig = document.createElement("div");
      orig.className = "eh-turn-orig";
      orig.textContent = turn.original;
      const trans = document.createElement("div");
      trans.className = "eh-turn-trans";
      trans.textContent = `"${turn.translation}"`;
      const sug = document.createElement("div");
      sug.className = "eh-turn-sug";
      for (const s of turn.suggestions) {
        const line = document.createElement("div");
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = "↩";
        const text = document.createElement("span");
        text.textContent = `${s.native}${s.gloss ? ` — ${s.gloss}` : ""}`;
        line.append(mark, text);
        sug.appendChild(line);
      }
      el.append(orig, trans, sug);
      turns.prepend(el);
    },
    reset() {
      turns.innerHTML = "";
      caption.style.display = "none";
      translation.style.display = "none";
      suggestion.style.display = "none";
      errorLine.style.display = "none";
      empty.style.display = "";
    },
  };
}
