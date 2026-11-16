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
.rl-tabs{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:3px;border-radius:10px;background:var(--rl-inset)}
.rl-tab{appearance:none;border:0;border-radius:7px;padding:6px 4px;background:transparent;color:var(--rl-weak);font:inherit;font-weight:550;cursor:pointer}
.rl-tab:hover{color:var(--rl-fg)}
.rl-tab[aria-selected=true]{background:var(--rl-bg);color:var(--rl-strong);box-shadow:0 1px 2px rgba(0,0,0,.2)}
.rl-body{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-content:start;padding:12px 14px 18px}
.rl-card{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;padding:12px;border:1px solid var(--rl-line);border-radius:12px;background:var(--rl-card)}
.rl-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.rl-inline{display:flex;gap:6px}
.rl-inline .rl-in{flex:1;min-width:0}
.rl-h{font-size:13px;font-weight:650;color:var(--rl-strong)}
.rl-hint{margin:0;color:var(--rl-weak);font-size:11.5px;overflow-wrap:anywhere}
.rl-hint.strong{color:var(--rl-fg);font-weight:600}
.rl-empty{padding:10px 0;text-align:center;color:var(--rl-weak);font-size:12px}
.rl-in{width:100%;min-width:0;padding:7px 9px;border:1px solid var(--rl-line);border-radius:8px;background:var(--rl-inset);color:var(--rl-strong);font:inherit;outline:none}
textarea.rl-in{min-height:64px;resize:vertical}
.rl-in:focus{border-color:var(--rl-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--rl-accent) 22%,transparent)}
.rl-in:disabled{opacity:.55}
.rl-f{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;color:var(--rl-weak);font-size:12px}
.rl-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.rl-grid2 .wide{grid-column:1/-1}
.rl-btn{appearance:none;padding:6px 12px;border:1px solid var(--rl-line2);border-radius:8px;background:transparent;color:var(--rl-fg);font:inherit;font-weight:550;cursor:pointer;white-space:nowrap}
.rl-btn:hover:not(:disabled){background:var(--rl-hover)}
.rl-btn:disabled{opacity:.5;cursor:default}
.rl-btn.sm{padding:3px 9px;font-size:12px}
.rl-btn.pri{border-color:transparent;background:var(--rl-accent);color:#fff}
.rl-btn.pri:hover:not(:disabled){background:var(--rl-accent);filter:brightness(1.1)}
.rl-btn.dng{border-color:color-mix(in srgb,var(--rl-bad) 50%,transparent);color:var(--rl-bad)}
.rl-btn.ghost{border-color:transparent}
.rl button:focus-visible,.rl summary:focus-visible,.rl input:focus-visible,.rl select:focus-visible{outline:2px solid var(--rl-accent);outline-offset:2px}
.rl-pill{--c:var(--rl-weak);display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:99px;background:color-mix(in srgb,var(--c) 16%,transparent);color:var(--c);font-size:11px;font-weight:600;white-space:nowrap}
.rl-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--c)}
.rl-pill.t-busy{--c:var(--rl-accent)}.rl-pill.t-busy::before{animation:rl-pulse 1.2s ease-in-out infinite}
.rl-pill.t-wait{--c:var(--rl-wait)}.rl-pill.t-warn{--c:var(--rl-warn)}.rl-pill.t-ok{--c:var(--rl-ok)}.rl-pill.t-bad{--c:var(--rl-bad)}
@keyframes rl-pulse{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.rl-pill.t-busy::before{animation:none}}
.rl-list{display:grid;grid-template-columns:minmax(0,1fr);gap:6px}
.rl-run{display:grid;grid-template-columns:minmax(0,1fr);gap:5px;width:100%;min-width:0;padding:8px 10px;border:1px solid var(--rl-line);border-radius:10px;background:transparent;color:var(--rl-fg);font:inherit;text-align:left;cursor:pointer}
.rl-run:hover:not(:disabled){background:var(--rl-hover)}
.rl-run[aria-current=true]{border-color:var(--rl-accent);background:color-mix(in srgb,var(--rl-accent) 9%,transparent)}
.rl-run-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rl-run-m{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--rl-weak);font-size:11px}
.rl-steps{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;margin:0;padding:0;list-style:none}
.rl-steps li{display:grid;gap:4px;color:var(--rl-weak);font-size:10.5px;text-align:center}
.rl-steps i{display:block;height:3px;border-radius:3px;background:var(--rl-line2)}
.rl-steps .d i,.rl-steps .c i{background:var(--rl-accent)}
.rl-steps .c{color:var(--rl-strong);font-weight:600}
.rl-steps .c i{animation:rl-pulse 1.6s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.rl-steps .c i{animation:none}}
.rl-note{--c:var(--rl-accent);display:grid;grid-template-columns:minmax(0,1fr);gap:2px;padding:8px 10px;border:1px solid color-mix(in srgb,var(--c) 32%,transparent);border-radius:10px;background:color-mix(in srgb,var(--c) 11%,transparent);font-size:12px;overflow-wrap:anywhere}
.rl-note.n-bad{--c:var(--rl-bad)}.rl-note.n-warn{--c:var(--rl-warn)}.rl-note.n-ok{--c:var(--rl-ok)}
.rl-note ul{margin:0;padding-left:16px}
.rl-actions{display:flex;flex-wrap:wrap;gap:6px}
.rl-req>summary,.rl-mini>summary{cursor:pointer;color:var(--rl-fg)}
.rl-req>summary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rl-mini>summary{color:var(--rl-weak);font-size:11.5px}
.rl-req>p,.rl-mini>p,.rl-mini>div{margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere}
.rl-pre{margin:6px 0 0;padding:8px;max-height:220px;overflow:auto;border-radius:8px;background:var(--rl-inset);font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}
.rl-menu{position:relative}
.rl-menu>summary{list-style:none;display:inline-block}
.rl-menu>summary::-webkit-details-marker{display:none}
.rl-menu-body{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;margin-top:6px;padding:6px;border:1px solid var(--rl-line);border-radius:10px;background:var(--rl-inset)}
.rl-menu-body .rl-btn{text-align:left;border-color:transparent}
.rl-acc{border:1px solid var(--rl-line);border-radius:12px;background:var(--rl-card)}
.rl-acc>summary{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:11px;color:var(--rl-strong);font-weight:600;cursor:pointer;list-style:none}
.rl-acc>summary::-webkit-details-marker{display:none}
.rl-acc>summary::after{content:"\\203A";margin-left:auto;color:var(--rl-weak);transition:transform .15s}
.rl-acc[open]>summary::after{transform:rotate(90deg)}
.rl-acc[open]>summary{border-radius:11px 11px 0 0}
.rl-acc>summary:hover{background:var(--rl-hover)}
.rl-sumtext{display:grid;gap:1px;min-width:0}
.rl-sumt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rl-sumtext .rl-sub{margin-left:0}
.rl-sub{margin-left:2px;color:var(--rl-weak);font-size:11px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rl-acc-body{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;padding:4px 12px 12px}
.rl-detail .rl-acc{background:transparent}
.rl-chips{display:flex;flex-wrap:wrap;gap:6px}
.rl-pick{display:grid;grid-template-columns:minmax(0,1fr);gap:4px}
.rl-pick .rl-chip{justify-self:start}
.rl-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 4px 3px 10px;border:1px solid var(--rl-line);border-radius:99px;background:var(--rl-inset);font-size:12px}
.rl-chip.bad{border-color:color-mix(in srgb,var(--rl-bad) 50%,transparent)}
.rl-chip-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rl-chip small{color:var(--rl-bad)}
.rl-x{appearance:none;flex:none;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rl-weak);font:inherit;line-height:1;cursor:pointer}
.rl-x:hover:not(:disabled){background:var(--rl-hover);color:var(--rl-strong)}
.rl-role{display:block;color:var(--rl-strong);font-weight:650}
.rl-meter-box{display:grid;gap:5px}
.rl-meter{height:6px;border-radius:99px;background:var(--rl-inset);overflow:hidden}
.rl-meter i{display:block;height:100%;border-radius:99px;background:var(--rl-accent)}
.rl-meter i.hot{background:var(--rl-warn)}.rl-meter i.full{background:var(--rl-bad)}
.rl-sw{display:flex;align-items:center;gap:10px;cursor:pointer}
.rl-sw input{appearance:none;flex:none;position:relative;width:34px;height:20px;margin:0;border-radius:99px;background:var(--rl-line2);cursor:pointer;transition:background .15s}
.rl-sw input::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
.rl-sw input:checked{background:var(--rl-accent)}
.rl-sw.warn input:checked{background:var(--rl-warn)}
.rl-sw input:checked::after{transform:translateX(14px)}
.rl-sticky{position:sticky;bottom:-18px;display:grid;gap:8px;margin:0 -14px -18px;padding:10px 14px 14px;background:var(--rl-bg);border-top:1px solid var(--rl-line)}
.rl table{width:100%;border-collapse:collapse;font-size:12px}
.rl caption{padding-bottom:4px;color:var(--rl-weak);text-align:left;font-size:11px}
.rl th,.rl td{padding:3px 4px;border-bottom:1px solid var(--rl-line);text-align:left;font-weight:400}
.rl ul.rl-plain{margin:0;padding:0;list-style:none;display:grid;gap:6px}
.rl-card-row{display:grid;grid-template-columns:minmax(0,1fr);gap:3px;padding:8px 10px;border:1px solid var(--rl-line);border-radius:10px;font-size:12px;overflow-wrap:anywhere}
.rl a{color:var(--rl-accent)}
.rl fieldset{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;min-width:0;margin:0;padding:10px;border:1px solid var(--rl-line);border-radius:10px}
.rl legend{padding:0 4px;color:var(--rl-weak);font-size:11px}
`;
