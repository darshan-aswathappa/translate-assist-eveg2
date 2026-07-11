// Live view: mirrors what the glasses are doing — status line, locked
// language, and the rolling list of translated turns.

import type { Turn } from "../conversation/thread";

export interface LiveView {
  setStatus(text: string): void;
  setLanguage(lang: string | null): void;
  addTurn(turn: Turn): void;
  reset(): void;
}

export function mountLive(root: HTMLElement): LiveView {
  root.innerHTML = `
    <div class="ta-status">Starting…</div>
    <div class="ta-lang">Language: detecting…</div>
    <div class="ta-turns"></div>
    <div class="ta-empty">Turns will appear here as your partner speaks.</div>`;

  const status = root.querySelector(".ta-status") as HTMLElement;
  const lang = root.querySelector(".ta-lang") as HTMLElement;
  const turns = root.querySelector(".ta-turns") as HTMLElement;
  const empty = root.querySelector(".ta-empty") as HTMLElement;

  return {
    setStatus(text) {
      status.textContent = text;
    },
    setLanguage(code) {
      lang.textContent = code
        ? `Language: ${code} (locked)`
        : "Language: detecting…";
    },
    addTurn(turn) {
      empty.style.display = "none";
      const el = document.createElement("div");
      el.className = "ta-turn";
      // All content is API/LLM-derived — build with textContent, never innerHTML.
      const orig = document.createElement("div");
      orig.className = "ta-orig";
      orig.textContent = turn.original;
      const trans = document.createElement("div");
      trans.className = "ta-trans";
      trans.textContent = `“${turn.translation}”`;
      const sug = document.createElement("div");
      sug.className = "ta-sug";
      for (const s of turn.suggestions) {
        const line = document.createElement("div");
        line.textContent = `↩ ${s.native}${s.gloss ? ` — ${s.gloss}` : ""}`;
        sug.appendChild(line);
      }
      el.append(orig, trans, sug);
      turns.prepend(el);
    },
    reset() {
      turns.innerHTML = "";
      empty.style.display = "";
    },
  };
}
