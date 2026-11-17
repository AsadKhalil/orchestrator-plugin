/**
 * Styles for the Relay panel. Everything is scoped under `.rl` so nothing leaks into the host, and every colour comes from the host's own theme
 * variables with a neutral fallback, so the panel follows light and dark themes. Plain CSS in a string because the GUI bundle has no CSS pipeline.
 */
export const panelCss = `
.rl{--rl-fg:var(--text-base,#2b2f36);--rl-strong:var(--text-strong,#14171c);--rl-weak:var(--text-weak,#6e7681);--rl-bg:var(--background-base,#fff);
--rl-card:var(--surface-raised-base,rgba(127,127,127,.07));--rl-inset:var(--surface-inset-base,rgba(127,127,127,.11));--rl-hover:var(--surface-base-hover,rgba(127,127,127,.15));
--rl-line:var(--border-weak-base,rgba(127,127,127,.22));--rl-line2:var(--border-base,rgba(127,127,127,.38));--rl-accent:var(--text-interactive-base,#4f7cff);
--rl-ok:var(--icon-success-base,#2ea36a);--rl-warn:var(--icon-warning-base,#d99a1c);--rl-bad:var(--icon-critical-base,#d9483b);--rl-wait:#8a7cf0;
display:flex;flex-direction:column;height:100%;min-height:0;color:var(--rl-fg);font-size:13px;line-height:1.4}
.rl *{box-sizing:border-box}
.rl h2,.rl h3,.rl p{margin:0}
.rl-top{display:grid;gap:10px;padding:14px 14px 0;flex:none}
.rl-brand{display:flex;align-items:center;gap:8px;min-width:0}
.rl-logo{flex:none;width:22px;height:22px;border-radius:7px;display:grid;place-items:center;color:#fff;font-size:12px;font-weight:700;background:linear-gradient(135deg,var(--rl-accent),#9b6bff)}
.rl-name{font-size:15px;font-weight:650;color:var(--rl-strong)}
.rl-tag{margin-left:auto;color:var(--rl-weak);font-size:11px;white-space:nowrap}
.rl-body{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-content:start;padding:12px 14px 18px}
.rl-card{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;padding:12px;border:1px solid var(--rl-line);border-radius:12px;background:var(--rl-card)}
.rl-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.rl-inline{display:flex;align-items:center;gap:6px}
.rl-inline .rl-in{flex:1;min-width:0}
.rl-hint{margin:0;color:var(--rl-weak);font-size:11.5px;overflow-wrap:anywhere}
.rl-in{width:100%;min-width:0;padding:7px 9px;border:1px solid var(--rl-line);border-radius:8px;background:var(--rl-inset);color:var(--rl-strong);font:inherit;outline:none}
.rl-in:focus{border-color:var(--rl-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--rl-accent) 22%,transparent)}
.rl-in:disabled{opacity:.55}
.rl-btn{appearance:none;padding:6px 12px;border:1px solid var(--rl-line2);border-radius:8px;background:transparent;color:var(--rl-fg);font:inherit;font-weight:550;cursor:pointer;white-space:nowrap}
.rl-btn:hover:not(:disabled){background:var(--rl-hover)}
.rl-btn:disabled{opacity:.5;cursor:default}
.rl-btn.sm{padding:3px 9px;font-size:12px}
.rl button:focus-visible,.rl summary:focus-visible,.rl input:focus-visible,.rl select:focus-visible{outline:2px solid var(--rl-accent);outline-offset:2px}
.rl-note{--c:var(--rl-accent);display:grid;grid-template-columns:minmax(0,1fr);gap:2px;padding:8px 10px;border:1px solid color-mix(in srgb,var(--c) 32%,transparent);border-radius:10px;background:color-mix(in srgb,var(--c) 11%,transparent);font-size:12px;overflow-wrap:anywhere}
.rl-note.n-bad{--c:var(--rl-bad)}.rl-note.n-warn{--c:var(--rl-warn)}.rl-note.n-ok{--c:var(--rl-ok)}
.rl-pre{margin:6px 0 0;padding:8px;max-height:220px;overflow:auto;border-radius:8px;background:var(--rl-inset);font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}
.rl-acc{border:1px solid var(--rl-line);border-radius:12px;background:var(--rl-card)}
.rl-acc>summary{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:11px;color:var(--rl-strong);font-weight:600;cursor:pointer;list-style:none}
.rl-acc>summary::-webkit-details-marker{display:none}
.rl-acc>summary::after{content:"\\203A";margin-left:auto;color:var(--rl-weak);transition:transform .15s}
.rl-acc[open]>summary::after{transform:rotate(90deg)}
.rl-acc[open]>summary{border-radius:11px 11px 0 0}
.rl-acc>summary:hover{background:var(--rl-hover)}
.rl-sub{margin-left:2px;color:var(--rl-weak);font-size:11px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rl-acc-body{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;padding:4px 12px 12px}
.rl-pick{display:grid;grid-template-columns:minmax(0,1fr);gap:4px}
.rl-pick .rl-chip{justify-self:start}
.rl-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 4px 3px 10px;border:1px solid var(--rl-line);border-radius:99px;background:var(--rl-inset);font-size:12px}
.rl-chip.bad{border-color:color-mix(in srgb,var(--rl-bad) 50%,transparent)}
.rl-chip-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rl-chip small{color:var(--rl-bad)}
.rl-x{appearance:none;flex:none;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rl-weak);font:inherit;line-height:1;cursor:pointer}
.rl-x:hover:not(:disabled){background:var(--rl-hover);color:var(--rl-strong)}
.rl-role{display:block;color:var(--rl-strong);font-weight:650}
.rl .rl-plain{margin:0;padding:0;list-style:none;display:grid;gap:6px}
`;
