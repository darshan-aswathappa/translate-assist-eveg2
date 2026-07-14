// Phone companion shell, styled after the Even Hub G2 design system: a light
// gray canvas, a screen header with the Translate Assist mark, and a top
// SegmentedTabs bar (Live / Sessions / Settings) — no bottom nav. No
// framework — the views are small enough for direct DOM code. Public
// interface is unchanged from the previous shell so main.ts keeps working.

import { mountLive, type LiveView } from "./live";
import { mountSessions, type SessionsDeps } from "./sessions";
import { mountSettings, type SettingsDeps } from "./settings";
import { icon, type IconName } from "./icons";
import { CSS } from "./styles";

export type TabName = "live" | "sessions" | "settings";

export interface PhoneUi {
  live: LiveView;
  showTab(tab: TabName): void;
  refreshSessions(): void;
}

const TAB_LABEL: Record<TabName, string> = {
  live: "Live",
  sessions: "Sessions",
  settings: "Settings",
};

const TAB_ICON: Record<TabName, IconName> = {
  live: "house",
  sessions: "grid",
  settings: "gear",
};

export function mountPhoneUi(
  root: HTMLElement,
  deps: SettingsDeps & SessionsDeps,
): PhoneUi {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const tabMarkup = (Object.keys(TAB_LABEL) as TabName[])
    .map(
      (tab) =>
        `<button class="eh-tab${tab === "live" ? " active" : ""}" data-tab="${tab}" role="tab" aria-selected="${tab === "live"}">${icon(TAB_ICON[tab], 18)}<span>${TAB_LABEL[tab]}</span></button>`,
    )
    .join("");

  root.innerHTML = `
    <div class="eh-shell">
      <div class="eh-header">
        <span class="eh-brand">${icon("translate", 24)}</span>
        <div class="eh-nav-title">Translate Assist</div>
        <span class="eh-header-spacer"></span>
      </div>
      <div class="eh-tabs" role="tablist">${tabMarkup}</div>
      <div class="eh-content">
        <div class="eh-view active" data-view="live"></div>
        <div class="eh-view" data-view="sessions"></div>
        <div class="eh-view" data-view="settings"></div>
      </div>
    </div>`;

  const view = (name: TabName): HTMLElement =>
    root.querySelector(`[data-view="${name}"]`) as HTMLElement;

  function showTab(tab: TabName): void {
    for (const el of root.querySelectorAll<HTMLElement>(".eh-tab")) {
      const active = el.dataset.tab === tab;
      el.classList.toggle("active", active);
      el.setAttribute("aria-selected", String(active));
    }
    for (const el of root.querySelectorAll<HTMLElement>(".eh-view")) {
      el.classList.toggle("active", el.dataset.view === tab);
    }
    if (tab === "sessions") sessions.refresh();
    // Scroll the freshly-shown view back to the top.
    const content = root.querySelector(".eh-content") as HTMLElement;
    content.scrollTop = 0;
  }

  for (const el of root.querySelectorAll<HTMLElement>(".eh-tab")) {
    el.addEventListener("click", () => showTab(el.dataset.tab as TabName));
  }

  const live = mountLive(view("live"));
  const sessions = mountSessions(view("sessions"), deps);
  mountSettings(view("settings"), deps);

  return { live, showTab, refreshSessions: () => sessions.refresh() };
}
