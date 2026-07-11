// Sessions view: browse saved conversation threads, read a full transcript,
// start a new session, or delete one. All data comes from the threads edge
// function; content is API/LLM-derived so it's rendered with textContent only.

import type { ApiClient, ThreadSummary } from "../api/client";

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
    <button class="ta-btn" data-action="new">＋ New session</button>
    <div class="ta-msg" data-msg></div>
    <div data-list></div>
    <div data-detail style="display:none"></div>`;

  const list = root.querySelector("[data-list]") as HTMLElement;
  const detail = root.querySelector("[data-detail]") as HTMLElement;
  const msg = root.querySelector("[data-msg]") as HTMLElement;
  const newBtn = root.querySelector('[data-action="new"]') as HTMLButtonElement;

  newBtn.addEventListener("click", () => {
    void (async () => {
      newBtn.disabled = true;
      try {
        await deps.onNewSession();
        msg.textContent = "New session started.";
        refresh();
      } finally {
        newBtn.disabled = false;
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
      empty.className = "ta-empty";
      empty.textContent = "No sessions yet.";
      list.appendChild(empty);
      return;
    }
    for (const t of threads) {
      const row = document.createElement("div");
      row.className = "ta-list-item";

      const info = document.createElement("div");
      const title = document.createElement("div");
      title.textContent =
        (t.id === deps.getActiveThreadId() ? "● " : "") + (t.title ?? "(empty session)");
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${t.locked_language ?? "?"} · ${new Date(t.created_at).toLocaleString()}`;
      info.append(title, meta);
      info.addEventListener("click", () => void openDetail(t.id));

      const del = document.createElement("button");
      del.className = "ta-btn danger small";
      del.textContent = "Delete";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm("Delete this session and its transcript?")) return;
        void deps.api.deleteThread(t.id).then(refresh);
      });

      row.append(info, del);
      list.appendChild(row);
    }
  }

  async function openDetail(id: string): Promise<void> {
    const t = await deps.api.getThread(id);
    detail.innerHTML = "";
    const back = document.createElement("button");
    back.className = "ta-btn small ta-detail-back";
    back.textContent = "← Back";
    back.addEventListener("click", showList);
    detail.appendChild(back);

    const heading = document.createElement("div");
    heading.className = "ta-status";
    heading.textContent = t.title ?? "(empty session)";
    detail.appendChild(heading);

    for (const u of t.utterances) {
      const el = document.createElement("div");
      el.className = "ta-turn";
      const orig = document.createElement("div");
      orig.className = "ta-orig";
      orig.textContent = u.original_text;
      const trans = document.createElement("div");
      trans.className = "ta-trans";
      trans.textContent = `“${u.translation_en}”`;
      const sug = document.createElement("div");
      sug.className = "ta-sug";
      for (const s of u.suggestions) {
        const line = document.createElement("div");
        line.textContent = `↩ ${s.native}${s.gloss ? ` — ${s.gloss}` : ""}`;
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
