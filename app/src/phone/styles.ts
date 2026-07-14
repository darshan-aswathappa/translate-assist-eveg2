// Even Hub G2 design system — phone-side companion chrome.
//
// Tokens are sampled from the official Even Hub UI Kit: a warm light-gray
// canvas, white surfaces, near-black ink, and a single pale-yellow accent used
// sparingly for the active/selected state. Surfaces separate by color contrast,
// not shadow. `--signal-green` is reserved for the glasses-display preview
// widget (green-on-dark mirrors what the G2 actually shows) and never appears
// in phone chrome. One semantic addition over the kit — `--signal-red` — covers
// form-error feedback, which the kit's monochrome palette omits.

export const CSS = `
:root {
  /* ---- base palette ---- */
  --gray-0: #FFFFFF;
  --gray-50: #F4F4F4;
  --gray-100: #EEEEEE;
  --gray-150: #E4E4E4;
  --gray-200: #DADADA;
  --gray-300: #C7C7C7;
  --gray-400: #A8A8A8;
  --gray-500: #7B7B7B;
  --gray-700: #4A4A4A;
  --gray-900: #1A1A1A;

  --yellow-accent: #FAFB9E;
  --yellow-accent-strong: #F5F281;
  --signal-green: #39FF6A;   /* glasses display preview only */
  --signal-red: #D93B3B;     /* semantic: form errors / destructive only */

  /* ---- semantic aliases ---- */
  --surface-canvas: var(--gray-100);
  --surface-card: var(--gray-0);
  --surface-card-pressed: var(--gray-150);
  --surface-selected: var(--yellow-accent);
  --surface-ink-gradient: linear-gradient(160deg, #3d3d3d, #1A1A1A);

  --border-hairline: rgba(0, 0, 0, 0.06);
  --border-hairline-strong: rgba(0, 0, 0, 0.12);
  --border-input: rgba(0, 0, 0, 0.10);

  --text-primary: var(--gray-900);
  --text-secondary: var(--gray-500);
  --text-tertiary: var(--gray-400);
  --text-on-accent: var(--gray-900);
  --text-inverse: var(--gray-0);

  --icon-primary: var(--gray-900);
  --icon-secondary: var(--gray-500);

  /* ---- type ---- */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;

  --text-nav-title: 600 20px/1.2 var(--font-sans);
  --text-section-label: 600 15px/1.3 var(--font-sans);
  --text-card-title: 500 19px/1.3 var(--font-sans);
  --text-card-title-lg: 600 22px/1.25 var(--font-sans);
  --text-body: 400 15px/1.4 var(--font-sans);
  --text-caption: 400 13px/1.35 var(--font-sans);
  --text-tab: 500 15px/1 var(--font-sans);
  --text-badge: 500 13px/1 var(--font-mono);
  --text-hud: 400 15px/1.5 var(--font-mono);

  /* ---- spacing & radius ---- */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-7: 32px; --space-8: 40px;
  --screen-gutter: 16px; --card-gap: 12px;

  --radius-sm: 14px; --radius-md: 20px; --radius-lg: 24px; --radius-pill: 999px;

  --shadow-soft: 0 1px 2px rgba(0, 0, 0, 0.04);
}

* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--surface-canvas);
  color: var(--text-primary);
  font: var(--text-body);
  -webkit-font-smoothing: antialiased;
}

/* ---- shell ---- */
.eh-shell { display: flex; flex-direction: column; min-height: 100vh; }
.eh-header {
  position: relative; display: flex; align-items: center;
  padding: 14px var(--screen-gutter) 10px;
}
.eh-brand { position: absolute; left: var(--screen-gutter); color: var(--icon-primary); display: flex; }
.eh-nav-title { flex: 1; text-align: center; font: var(--text-nav-title); color: var(--text-primary); }
.eh-header-spacer { width: 24px; }

.eh-content {
  flex: 1; overflow-y: auto; padding: 4px var(--screen-gutter) calc(var(--space-7) + env(safe-area-inset-bottom));
}
.eh-view { display: none; }
.eh-view.active { display: block; }

/* ---- top SegmentedTabs (replaces bottom nav) ---- */
.eh-tabs {
  position: sticky; top: 0; z-index: 1; display: flex; gap: var(--space-2);
  padding: var(--space-2) var(--screen-gutter) var(--space-4);
  background: var(--surface-canvas); border-bottom: 1px solid var(--border-hairline);
  overflow-x: auto; scrollbar-width: none;
}
.eh-tabs::-webkit-scrollbar { display: none; }
.eh-tab {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--surface-card); border: none; border-radius: var(--radius-pill);
  padding: 9px 14px; font: var(--text-tab); color: var(--text-secondary); cursor: pointer;
  white-space: nowrap; transition: background .12s, color .12s;
}
.eh-tab svg { flex-shrink: 0; width: 16px; height: 16px; }
.eh-tab.active { background: var(--surface-selected); color: var(--text-on-accent); }

/* ---- cards / rows / tiles ---- */
.eh-card {
  background: var(--surface-card); border-radius: var(--radius-md);
  padding: var(--space-5); box-shadow: var(--shadow-soft); margin-bottom: var(--card-gap);
}
.eh-card.flush { padding: 0; overflow: hidden; }
.eh-card.ink { background: var(--surface-ink-gradient); color: var(--text-inverse); }

.eh-row {
  display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-4) var(--space-5); cursor: default;
}
.eh-row.clickable { cursor: pointer; }
.eh-row.div { border-bottom: 1px solid var(--border-hairline); }
.eh-row:last-child { border-bottom: none; }
.eh-row-icon { width: 28px; height: 28px; flex-shrink: 0; color: var(--icon-primary); display: flex; }
.eh-row-main { flex: 1; min-width: 0; }
.eh-row-title { font: var(--text-card-title); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.eh-row-sub { font: var(--text-caption); color: var(--text-secondary); margin-top: 2px; }
.eh-row-trail { flex-shrink: 0; display: flex; align-items: center; gap: var(--space-2); color: var(--icon-secondary); }

.eh-section-label { font: var(--text-section-label); color: var(--text-primary); margin: var(--space-5) var(--space-1) var(--space-2); }

/* ---- pills / badges / buttons ---- */
.eh-pill {
  font: var(--text-tab); color: var(--text-primary); background: var(--surface-card);
  border: none; border-radius: var(--radius-pill); padding: 10px 18px; cursor: pointer;
  white-space: nowrap;
}
.eh-pill.active { background: var(--surface-selected); color: var(--text-on-accent); }

.eh-badge { font: var(--text-badge); background: var(--gray-150); color: var(--text-primary); padding: 4px 10px; border-radius: var(--radius-pill); }

.eh-btn {
  font: var(--text-tab); color: var(--text-inverse); background: var(--gray-900);
  border: none; border-radius: var(--radius-pill); padding: 12px 20px; cursor: pointer;
}
.eh-btn.accent { background: var(--yellow-accent-strong); color: var(--text-on-accent); }
.eh-btn.ghost { background: var(--gray-150); color: var(--text-primary); }
.eh-btn.small { padding: 8px 16px; }
.eh-btn:disabled { opacity: .5; cursor: default; }
.eh-btn.icon { width: 40px; height: 40px; padding: 0; display: flex; align-items: center; justify-content: center; }
.eh-btn.danger { color: var(--signal-red); }

/* ---- form ---- */
.eh-field { margin-bottom: var(--space-4); }
.eh-label { display: block; font: 500 13px/1.3 var(--font-sans); color: var(--text-secondary); margin-bottom: 6px; }
.eh-input {
  width: 100%; background: rgba(26,26,26,0.04); color: var(--text-primary);
  border: 1px solid var(--border-input); border-radius: var(--radius-md);
  padding: 12px 14px; font: var(--text-body);
}
.eh-input::placeholder { color: var(--text-tertiary); }
.eh-input:focus { outline: none; border-color: var(--gray-900); background: var(--surface-card); }
.eh-hint { font: var(--text-caption); color: var(--text-tertiary); margin-top: 6px; }
.eh-msg { font: var(--text-caption); color: var(--text-secondary); margin-top: var(--space-3); min-height: 1.2em; }
.eh-msg.ok { color: var(--text-primary); }
.eh-msg.err { color: var(--signal-red); }

.eh-empty { font: var(--text-caption); color: var(--text-tertiary); text-align: center; padding: var(--space-7) 0; }

/* ---- glasses-display preview (green-on-dark, mirrors the G2) ---- */
.eh-hud {
  position: relative; background: var(--surface-ink-gradient); color: var(--signal-green);
  border-radius: var(--radius-lg); padding: var(--space-5); margin-bottom: var(--card-gap);
  font-family: var(--font-mono); overflow: hidden;
}
.eh-hud-notch { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; }
.eh-hud-notch span:nth-child(1) { width: 30px; height: 3px; background: var(--signal-green); border-radius: 2px; }
.eh-hud-notch span:nth-child(2) { width: 8px; height: 3px; background: rgba(255,255,255,0.3); border-radius: 2px; }
.eh-hud-status { display: flex; align-items: center; gap: 8px; font: var(--text-hud); margin-top: 22px; }
.eh-hud-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--signal-green); box-shadow: 0 0 8px var(--signal-green); }
.eh-hud-dot.idle { box-shadow: none; opacity: .45; }
.eh-hud-caption { font: 400 15px/1.4 var(--font-mono); color: var(--signal-green); opacity: .75; font-style: italic; margin: 12px 0 6px; word-break: break-word; }
.eh-hud-translation { font: 600 17px/1.4 var(--font-mono); color: var(--signal-green); margin: 12px 0 6px; }
.eh-hud-sug { font: var(--text-hud); color: var(--signal-green); opacity: .8; }
.eh-hud-error { font: var(--text-hud); color: var(--signal-red); margin-top: 10px; word-break: break-word; }
.eh-hud-lang { display: inline-block; border: 1.5px solid var(--signal-green); border-radius: 6px; padding: 3px 8px; font: 500 11px/1 var(--font-mono); color: var(--signal-green); }
.eh-hud-empty { font: var(--text-hud); color: rgba(57,255,106,0.5); margin-top: 22px; }

/* ---- turn cards (live + transcript) ---- */
.eh-turn-orig { font: var(--text-caption); color: var(--text-secondary); }
.eh-turn-trans { font: var(--text-card-title); color: var(--text-primary); margin: 4px 0 6px; }
.eh-turn-sug { font: var(--text-caption); color: var(--text-primary); }
.eh-turn-sug .mark { color: var(--icon-secondary); margin-right: 4px; }
.eh-turn-sug div { margin-top: 2px; }

/* ---- onboarding tier picker (full-screen overlay) ---- */
.eh-onboarding {
  position: fixed; inset: 0; z-index: 10; background: var(--surface-canvas);
  overflow-y: auto;
}
.eh-onboarding-inner {
  max-width: 520px; margin: 0 auto;
  padding: var(--space-4) var(--screen-gutter) calc(var(--space-8) + env(safe-area-inset-bottom));
}

/* ---- plan / usage (Settings + onboarding) ---- */
.eh-usage-line { display: flex; justify-content: space-between; font: var(--text-caption); color: var(--text-secondary); margin-top: var(--space-3); }
.eh-progress { height: 6px; background: var(--gray-150); border-radius: 3px; overflow: hidden; margin-top: 4px; }
.eh-progress span { display: block; height: 100%; background: var(--gray-900); border-radius: 3px; }
.eh-progress.warn span { background: var(--signal-red); }

.eh-row-back { display: flex; align-items: center; gap: 6px; padding: 6px 0 var(--space-3); }
.eh-row-back button { background: none; border: none; color: var(--text-primary); cursor: pointer; display: flex; }

/* thin, unobtrusive scrollbar */
.eh-content::-webkit-scrollbar { width: 6px; }
.eh-content::-webkit-scrollbar-thumb { background: var(--gray-300); border-radius: 3px; }
`;
