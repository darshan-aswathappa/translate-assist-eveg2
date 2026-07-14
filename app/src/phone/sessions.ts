// Sessions view: browse saved conversation threads, read a full transcript,
// start a new session, or delete one. Styled as Even Hub cards / list rows with
// a back-chevron header on the transcript detail. All data is API/LLM-derived,
// so it is rendered with textContent only.

import type { ApiClient, ThreadSummary } from "../api/client";
import { icon } from "./icons";

export interface SessionsDeps {
  api: ApiClient;
  getActiveThreadId: () => string | null;
  onNewSession: () => Promise<void>;
}

export interface SessionsView {
  refresh: () => void;
}

export function mountSessions(root: HTMLElement, deps: SessionsDeps): SessionsView {
  root.innerHTML = `
    <div class="eh-card flush">
      <div class="eh-row clickable" data-action="new">
        <span class="eh-row-icon">${icon("plus", 22)}</span>
        <div class="eh-row-main"><div class="eh-row-title">New session</div></div>
        <span class="eh-row-trail">${icon("caret-right", 16)}</span>
      </div>
    </div>
    <div class="eh-msg" data-msg></div>
    <div data-list></div>
    <div data-detail style="display:none"></div>`;

  const list = root.querySelector("[data-list]") as HTMLElement;
  const detail = root.querySelector("[data-detail]") as HTMLElement;
  const msg = root.querySelector("[data-msg]") as HTMLElement;
  const newBtn = root.querySelector('[data-action="new"]') as HTMLElement;

  newBtn.addEventListener("click", () => {
    void (async () => {
      (newBtn as HTMLElement).style.pointerEvents = "none";
      try {
        await deps.onNewSession();
        msg.classList.remove("err");
        msg.textContent = "New session started.";
        refresh();
      } catch (err) {
        msg.classList.add("err");
        msg.textContent = err instanceof Error ? err.message : "Could not start a new session";
      } finally {
        (newBtn as HTMLElement).style.pointerEvents = "";
      }
    })();
  });

  function showList(): void {
    detail.style.display = "none";
    list.style.display = "";
  }

  function renderThreads(threads: ThreadSummary[]): void {
    list.innerHTML = "";
    if (threads.length === 0) {
      const empty = document.createElement("div");
      empty.className = "eh-empty";
      empty.textContent = "No sessions yet.";
      list.appendChild(empty);
      return;
    }
    for (const t of threads) {
      const card = document.createElement("div");
      card.className = "eh-card flush";

      const row = document.createElement("div");
      row.className = "eh-row clickable";

      const iconWrap = document.createElement("span");
      iconWrap.className = "eh-row-icon";
      iconWrap.innerHTML = icon(t.id === deps.getActiveThreadId() ? "microphone" : "list", 22);

      const main = document.createElement("div");
      main.className = "eh-row-main";
      const title = document.createElement("div");
      title.className = "eh-row-title";
      title.textContent = t.title ?? "(empty session)";
      const meta = document.createElement("div");
      meta.className = "eh-row-sub";
      meta.textContent = `${t.locked_language ?? "?"} · ${new Date(t.created_at).toLocaleString()}`;
      main.append(title, meta);

      const trail = document.createElement("span");
      trail.className = "eh-row-trail";
      const del = document.createElement("button");
      del.className = "eh-btn ghost small icon";
      del.title = "Delete session";
      del.innerHTML = icon("trash", 18);
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm("Delete this session and its transcript?")) return;
        void deps.api.deleteThread(t.id).then(refresh);
      });
      const caret = document.createElement("span");
      caret.innerHTML = icon("caret-right", 16);
      trail.append(del, caret);

      row.append(iconWrap, main, trail);
      row.addEventListener("click", () => void openDetail(t.id));
      card.appendChild(row);
      list.appendChild(card);
    }
  }

  async function openDetail(id: string): Promise<void> {
    const t = await deps.api.getThread(id);
    detail.innerHTML = "";

    const back = document.createElement("div");
    back.className = "eh-row-back";
    const backBtn = document.createElement("button");
    backBtn.innerHTML = icon("caret-left", 20);
    const backLabel = document.createElement("span");
    backLabel.textContent = "Sessions";
    backLabel.style.font = "var(--text-tab)";
    backBtn.append(backLabel);
    backBtn.addEventListener("click", showList);
    back.appendChild(backBtn);
    detail.appendChild(back);

    const heading = document.createElement("div");
    heading.className = "eh-section-label";
    heading.style.marginTop = "0";
    heading.textContent = t.title ?? "(empty session)";
    detail.appendChild(heading);

    if (t.utterances.length === 0) {
      const empty = document.createElement("div");
      empty.className = "eh-empty";
      empty.textContent = "No turns in this session yet.";
      detail.appendChild(empty);
    }

    for (const u of t.utterances) {
      const el = document.createElement("div");
      el.className = "eh-card";
      const orig = document.createElement("div");
      orig.className = "eh-turn-orig";
      orig.textContent = u.original_text;
      const trans = document.createElement("div");
      trans.className = "eh-turn-trans";
      trans.textContent = `"${u.translation_en}"`;
      const sug = document.createElement("div");
      sug.className = "eh-turn-sug";
      for (const s of u.suggestions) {
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
      detail.appendChild(el);
    }
    list.style.display = "none";
    detail.style.display = "";
  }

  function refresh(): void {
    msg.classList.remove("err");
    msg.textContent = "";
    deps.api
      .listThreads()
      .then(({ threads }) => renderThreads(threads))
      .catch((err) => {
        msg.classList.add("err");
        msg.textContent = err instanceof Error ? err.message : "Could not load sessions";
      });
  }

  refresh();
  return { refresh };
}
