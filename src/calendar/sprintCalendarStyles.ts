/** The approved calendar shell; light and contrast hosts retain accessible variants. */
export const CALENDAR_STYLES = `
*{box-sizing:border-box}
body{--bg:#0c1018;--surface:#121a27;--day:#151e2c;--weekend:#192335;--fg:#edf2f7;--muted:#9dafc6;--border:#344158;--button:#203149;--raised:#263548;--field:#1b2433;margin:0;background:var(--bg);color:var(--fg);font:13px Inter,system-ui,sans-serif}
body.vscode-light{--bg:#f3f5f9;--surface:#fff;--day:#fff;--weekend:#f2f5fa;--fg:#172435;--muted:#526178;--border:#c5cfdd;--button:#e5ebf4;--raised:#fff;--field:#f3f6fa}
body.vscode-high-contrast,body.vscode-high-contrast-light{--bg:var(--vscode-editor-background);--surface:var(--vscode-editor-background);--day:var(--vscode-editor-background);--weekend:var(--vscode-editor-background);--fg:var(--vscode-editor-foreground);--muted:var(--vscode-editor-foreground);--border:var(--vscode-contrastBorder);--button:var(--vscode-button-secondaryBackground);--raised:var(--vscode-editor-background);--field:var(--vscode-editor-background)}
[hidden]{display:none!important}
.app{width:min(1100px,calc(100% - 40px));margin:28px auto;border:1px solid var(--border);border-radius:11px;background:var(--surface);overflow:hidden}
.top{height:58px;padding:0 22px;display:flex;align-items:center;gap:18px;border-bottom:1px solid var(--border)}
.brand{font-weight:800}.crumb,.muted{color:var(--muted)}.spacer{flex:1}
.main{display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:690px}
.cal{padding:20px;min-width:0;position:relative}
.bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:13px}.bar h1{font-size:21px;margin:0}.bar nav{display:flex;gap:7px;margin-left:auto}
button,select{font:inherit}button{border:1px solid var(--border);background:var(--button);color:var(--fg);padding:8px 10px;border-radius:6px;cursor:pointer}
button:disabled{opacity:.6;cursor:default}button:hover:not(:disabled){filter:brightness(1.12)}
:focus-visible{outline:2px solid var(--vscode-focusBorder,#8bbaff);outline-offset:2px}
.top button{padding:4px 7px;font-size:11px}
.ribbons{position:relative;margin-bottom:6px;display:grid;gap:4px}
.ribbon-lane{height:28px;position:relative}
.ribbon{position:absolute;height:24px;top:2px;background:var(--sprint);color:var(--sprint-fg);font-weight:700;font-size:11px;border:0;border-radius:5px;padding:4px 9px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:left}
.picker,.task-menu,.backlog-picker{position:fixed;z-index:20;width:259px;max-height:350px;overflow:auto;padding:5px;background:var(--raised);border:1px solid var(--border);border-radius:7px;box-shadow:0 10px 24px #0008}
.picker{width:216px;padding:10px}.picker strong,.picker small{display:block;overflow-wrap:anywhere}.picker small{color:var(--muted);margin:4px 0 8px}
.swatches{display:flex;align-items:center;gap:9px}.swatch{flex:none;width:18px;height:18px;border-radius:50%;border:2px solid transparent;padding:0;background:var(--swatch)}
.swatch.selected{border-color:#fff;box-shadow:0 0 0 2px #fff}.delete-sprint{margin-left:auto;padding:0;width:20px;height:20px}
.calendar-scroll{overflow-x:auto;max-width:100%}.calendar-grid{min-width:490px}
.weekdays,.dates{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
.weekdays{height:21px;color:var(--muted);font-size:10px;text-transform:uppercase}.weekdays span{padding:0 7px 7px}
.dates{border-top:1px solid var(--border);border-left:1px solid var(--border)}
.day{min-width:0;min-height:101px;position:relative;padding:7px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--day)}
.weekend{background:var(--weekend)}.adjacent time{color:var(--muted);opacity:.7}
time{display:inline-flex;height:20px;min-width:20px;align-items:center;justify-content:center}
.today{border-radius:50%;background:#4e84d5;color:#fff}
.card{display:block;width:100%;margin-top:7px;padding:5px;border:0;border-left:3px solid var(--sprint);border-radius:4px;color:var(--sprint-fg);background:var(--sprint);font-size:10px;text-align:left;overflow-wrap:anywhere;min-height:38px}
.card .task-status{display:block;font-size:9px;margin-top:3px}.card.selected{outline:2px solid var(--sprint);outline-offset:2px}
.week-controls{padding:3px 0}.week-controls:empty{display:none}.week-controls button{font-size:11px;padding:3px 6px}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:11px;color:var(--muted);font-size:11px}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:var(--sprint)}
.side{border-left:1px solid var(--border);padding:20px;min-width:0;max-height:850px;overflow-y:auto}
.side h2{font-size:16px;margin:0}.side label{display:block;font-size:11px;color:var(--muted);margin:12px 0 5px}
.task-trigger{width:100%;padding:9px;text-align:left;border:1px solid var(--border);border-radius:6px;background:var(--field);color:var(--fg);overflow-wrap:anywhere}
.task-trigger.selected{border-color:var(--sprint);outline:2px solid var(--sprint)}
.task-option{position:relative;min-height:47px;border-bottom:1px solid var(--border);padding-right:26px}.task-option:last-child{border:0}
.task-choice,.backlog-choice{display:block;width:100%;min-height:47px;text-align:left;padding:8px;background:transparent;border:0;color:var(--fg)}
.task-choice small{display:block;color:var(--muted);margin-top:2px}.remove-task{position:absolute;right:4px;bottom:6px;width:18px;height:18px;padding:0;margin:0;background:var(--field);line-height:14px;border-radius:4px}
.details{margin-top:16px;border-top:1px solid var(--border);padding-top:13px;overflow-wrap:anywhere}
.taskname{display:block;border-left:4px solid var(--sprint);padding-left:8px;font-weight:750}
.meta{display:grid;grid-template-columns:82px minmax(0,1fr);gap:7px;margin-top:11px;font-size:11px}.meta dt{color:var(--muted);font-weight:700}.meta dd{margin:0}
.details h3{font-size:11px;text-transform:uppercase;color:var(--muted);margin:15px 0 5px}
.description{line-height:1.45;margin:0;white-space:pre-wrap}
.detail-actions{display:flex;gap:7px;margin-top:15px;flex-wrap:wrap}.detail-actions button{font-size:11px}
.empty{position:absolute;z-index:4;top:50%;left:50%;transform:translate(-50%,-50%);width:min(330px,calc(100% - 32px));text-align:center;padding:17px;background:var(--raised);border:1px solid var(--border);border-radius:8px;box-shadow:0 12px 30px #0008}
.empty strong{display:block;font-size:16px}.empty p{margin:7px 0;color:var(--muted);font-size:12px}
.add-task{margin-top:12px}.sprint-target{width:100%;padding:6px;background:var(--field);color:var(--fg);border:1px solid var(--border);border-radius:5px}
.warnings{margin:12px 20px;border:1px solid var(--vscode-editorWarning-foreground,#e7a35a);padding:10px;overflow-wrap:anywhere}.warnings h2{font-size:13px}
.help{margin:0 20px 15px;color:var(--muted);font-size:11px}.help summary{cursor:pointer}.help p{line-height:1.5}
.preview{position:fixed;z-index:30;max-width:300px;background:var(--raised);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:8px;pointer-events:none;white-space:pre-line;font-size:12px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
@media(max-width:800px){.app{width:calc(100% - 20px);margin:10px}.main{grid-template-columns:minmax(0,1fr)}.cal{padding:12px}.side{border-left:0;border-top:1px solid var(--border);max-height:440px}.top{padding:0 12px}.bar nav{margin-left:0}.ribbon{font-size:10px}.card{min-height:38px}}
@media(forced-colors:active){.card,.ribbon,.swatch{border:1px solid CanvasText}.card.selected{outline:2px solid Highlight}.dot{border:1px solid CanvasText}}
`;
