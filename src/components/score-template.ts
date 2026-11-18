import play from "@tabler/icons/outline/player-play.svg"
import pause from "@tabler/icons/outline/player-pause.svg"
import stop from "@tabler/icons/outline/player-stop.svg"
import { transportButtonHeight, transportWidth } from "./score-shared"

export const template = `
<style>
  :host { display: block; box-sizing: border-box; min-inline-size: 300px; max-inline-size: 2100px;
    min-block-size: var(--score-row-height, 82px); overflow: auto; scrollbar-width: thin;
    color: var(--ww-text-color, inherit); font: 0.875rem/1.45 var(--ww-font-family, system-ui, sans-serif); }
  [hidden] { display: none !important; }
  .notice { margin: 0; }
  .sheet { --position-blue: var(--ww-theme-accent-1, #356ad6); --position-ink: var(--ww-theme-accent-1, #2358c0);
    position: relative; display: grid; grid-template-columns: minmax(0, 1fr);
    background: white; color: black; }
  #score, .transport { grid-area: 1 / 1; align-self: start; }
  .at-surface { position: relative; }
  .at-surface > div { position: absolute; }
  .at-surface svg text { dominant-baseline: alphabetic; white-space: pre; }
  .at-surface .at { font: normal var(--music-font-size, 36px)/1 var(--music-font, alphaTab); overflow: visible; }
  .append-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .append-layer svg { visibility: hidden; }
  .append-layer [data-append-ghost] { visibility: visible; }
  .append-layer [data-append-ghost=new] { opacity: .4; }
  .at-surface [data-append-replaced] { visibility: hidden; }
  .at-surface :is([data-trim-ghost=row], [data-trim-ghost=copy]) { opacity: .26; filter: url(#trim-tint); }
  .at-surface [data-trim-ghost=copy] { position: absolute; inset: 0; pointer-events: none; }
  .at-cursor-bar { background: #d6e3ff60; scroll-margin-block: 8px; }
  .at-cursor-beat { background: var(--position-blue); }
  .sheet:not(.playing) .at-cursors { visibility: hidden; }
  .playing .at-highlight * { fill: var(--position-ink); stroke: var(--position-ink); }
  .at-surface .selected-ink, .at-surface .selected-ink text { fill: var(--position-blue); }
  .track-labels { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .track-label { position: absolute; transform: translate(-100%, -50%) rotate(180deg);
    writing-mode: vertical-rl; text-orientation: sideways; white-space: nowrap; line-height: 1;
    max-inline-size: 7em; overflow: hidden; text-overflow: ellipsis; }
  .transport { position: sticky; top: 4px; justify-self: left; margin: 4px 0 0 4px;
    z-index: 1001; display: flex; flex-direction: column; }
  .transport button { display: grid; place-items: center; inline-size: ${transportWidth}px; block-size: ${transportButtonHeight}px;
    color: inherit; background: transparent; padding: 0; border: 0; border-radius: 0.25rem; }
  .playing .transport button, .transport button:hover:enabled { color: var(--position-blue); }
  .transport .icon { inline-size: 16px; block-size: 16px; background: currentColor;
    mask: var(--icon) center / contain no-repeat; }
  #playIcon { --icon: url(${JSON.stringify(play)}); }
  #pauseIcon { --icon: url(${JSON.stringify(pause)}); }
  #stopIcon { --icon: url(${JSON.stringify(stop)}); }
  .transport button { position: relative; }
  .transport button::after { content: ""; position: absolute; inset-inline: -4px; }
  #play::after { inset-block: -6px 0; }
  #stop::after { inset-block: 0 -6px; }
  .transport button:enabled { cursor: pointer; }
  .transport button:disabled { opacity: 0.5; }
  :focus-visible { outline: 2px solid var(--position-blue); outline-offset: 2px; }
  #surface:focus, #targets:focus { outline: none; }
  .points { position: absolute; inset: 0; z-index: 1001; pointer-events: none; user-select: none; }
  .point { position: absolute; box-sizing: border-box; padding: 0; border: 0; border-radius: 0.2rem;
    color: var(--position-ink); background: transparent; pointer-events: auto; cursor: pointer; }
  .point:hover { background: color-mix(in srgb, var(--position-blue) 12.5%, transparent); }
  .point[data-kind=insert] { cursor: crosshair; }
  .point:is([data-kind=tempo], [data-kind=text], [data-kind=lyric], [data-kind=title], [data-kind=subtitle]) { cursor: text; }
  .point[data-heading-action] { cursor: pointer; font: 0.75rem system-ui; color: var(--position-blue); background: #fff; }
  .point[data-heading-action]:hover { background: color-mix(in srgb, var(--position-blue) 9%, #fff); }
  .sheet:not(.focused) .point[data-heading-action] { visibility: hidden; }
  .point:is([data-kind=beat], [data-kind=insert], [data-kind=note]) { touch-action: none; }
  .point[data-selected] { background: color-mix(in srgb, var(--position-blue) 15%, transparent); }
  .point[data-drop] { box-shadow: inset 2px 0 var(--position-blue); }
  .point[data-kind=note] { z-index: 1; }
  @media (pointer: coarse) {
    .point[data-kind=note]::after { content: ""; position: absolute; inset-block: 50% auto; inset-inline: 50% auto;
      translate: -50% -50%; inline-size: max(100%, 24px); block-size: max(100%, 24px); }
  }
  .point[data-kind=note]:hover { background: transparent; }
  .point[data-pitch-drag] { cursor: ns-resize; }
  .point[data-move] { cursor: grab; }
  .point[data-kind=append] { z-index: 1; color: var(--position-blue); background: color-mix(in srgb, var(--position-blue) 8%, transparent);
    font: 1.125rem system-ui; white-space: nowrap; cursor: pointer; touch-action: none; }
  .sheet:not(.focused) .point[data-kind=append] { visibility: hidden; }
  .point[data-kind=append]::before { content: ""; position: absolute; inset: 0 calc(100% + 1px) 0 auto;
    width: var(--end-bar-span); cursor: ew-resize; }
  .sheet:not(.resizing-end-bar):has(.point[data-kind=append]:hover) [data-end-barline] { fill: var(--position-blue); }
  .point[data-kind=append]:hover { background: color-mix(in srgb, var(--position-blue) 17%, transparent); }
  .point[data-trimming] { opacity: 0; }
  .sheet.resizing-end-bar, .sheet.resizing-end-bar * { cursor: ew-resize !important; }
  .tempo-digits, .editing-text { visibility: hidden; }
  .point.inline-input { z-index: 3; border-radius: 0;
    appearance: none; background: transparent; cursor: text; user-select: text; }
  .point.tempo-input { min-inline-size: calc(3ch + 2px); }
  .point.text-input { color: var(--score-text-color, black); }
  .point.text-input[data-original-text] { color: transparent; caret-color: var(--score-text-color, black); }
  .text-input[data-original-text]::selection { color: transparent; background: color-mix(in srgb, var(--position-blue) 30%, transparent); }
  :is(.ww-direction-text, .ww-direction-lyric, .ww-heading-title, .ww-heading-subtitle) text,
  .text-input { font-kerning: normal; text-rendering: geometricPrecision; }
  .text-input::placeholder { color: #767676; opacity: 1; }
  .inline-input:focus { outline: none; }
  .tempo-input:focus { box-shadow: inset 0 -1px var(--position-blue); }
  .completion { position: fixed; inset: auto; margin: 0; z-index: 1010;
    box-sizing: border-box; inline-size: min(17rem, calc(100vw - 16px)); padding: 4px;
    color: #222; background: #fff; border: 1px solid #cfd4de; border-radius: 8px;
    box-shadow: 0 4px 16px #151f3430; font: inherit; }
  .completion:not(:popover-open) { display: none; }
  .completion input { box-sizing: border-box; width: 100%; padding: 6px 8px; border: 1px solid #cfd4de;
    border-radius: 4px; color: inherit; background: #fff; font: inherit; }
  .completion:has(.entry-duration:not([hidden])) input { padding-inline-end: 3.6rem; }
  .entry-duration { position: absolute; inset: 10px 10px auto auto; pointer-events: none; color: #5d6677; }
  .completion input:focus { outline: 1px solid var(--position-blue); outline-offset: -1px; }
  .completion ul { list-style: none; padding: 0; margin: 4px 0 0;
    max-block-size: min(15rem, max(3rem, calc(100vh - 4rem))); overflow-y: auto; overscroll-behavior: contain; }
  .completion li[role=option] { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto;
    align-items: center; column-gap: 6px; min-block-size: 34px; border-radius: 4px; padding: 0 5px;
    cursor: pointer; }
  .completion li[aria-selected=true] { color: var(--position-ink); background: color-mix(in srgb, var(--position-blue) 13%, transparent); }
  .completion li[role=option]:hover { background: color-mix(in srgb, var(--position-blue) 8%, transparent); }
  .completion li[aria-current=true] > span::after { content: " ✓"; color: var(--position-blue); }
  .completion svg { inline-size: 44px; block-size: 34px; font-family: var(--music-font, alphaTab); overflow: hidden; }
  .completion svg text { text-anchor: middle; }
  .completion kbd { max-inline-size: 8rem; overflow-wrap: anywhere;
    padding: 0 4px; border: 1px solid #d7dce6; border-radius: 4px; font-size: .8em; }
  .completion-empty { margin: 4px 0 0; padding: 4px 8px; color: #5d6677; }
  @media print {
    :host { overflow: visible; }
    .transport, .notice, .points, .at-cursors, .append-layer, .completion { display: none !important; }
    .tempo-digits, .editing-text { visibility: visible; }
    .sheet { min-height: 0 !important; }
    .at-surface [data-append-replaced] { visibility: visible; }
    .at-surface [data-trim-ghost] { clip-path: none !important; filter: none; opacity: 1; }
    .at-surface [data-trim-ghost=copy] { display: none; }
  }
</style>
<style id="rowMinimum"></style>
<section id="surface" contenteditable="false" tabindex="-1">
  <p id="notice" class="notice" part="notice" role="status" hidden></p>
  <div id="sheet" class="sheet" part="sheet">
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <filter id="trim-tint">
        <feFlood flood-color="#a43131" />
        <feComposite in2="SourceAlpha" operator="in" />
      </filter>
    </svg>
    <div id="transport" class="transport" hidden>
      <button id="play" type="button" disabled>
        <span id="playIcon" class="icon" aria-hidden="true"></span>
        <span id="pauseIcon" class="icon" aria-hidden="true" hidden></span>
      </button>
      <button id="stop" type="button" disabled>
        <span id="stopIcon" class="icon" aria-hidden="true"></span>
      </button>
    </div>
    <div id="score"></div>
    <div id="trackLabels" class="track-labels"></div>
    <div class="append-layer" aria-hidden="true"><div id="appendScore"></div></div>
    <div id="points" class="points" data-ww-can="edit" hidden>
      <div id="targets" tabindex="-1"></div>
      <input id="tempo" class="point inline-input tempo-input" type="text" inputmode="numeric" autocomplete="off" hidden>
      <input id="scoreText" class="point inline-input text-input" type="text" autocomplete="off" hidden>
    </div>
    <div id="completion" class="completion" popover="manual">
      <input id="completionInput" type="text" role="combobox" aria-autocomplete="list"
        aria-controls="completionList" aria-expanded="false" autocomplete="off" autocapitalize="off" spellcheck="false">
      <kbd id="entryDuration" class="entry-duration" hidden></kbd>
      <ul id="completionList" role="listbox"></ul>
      <p id="completionEmpty" class="completion-empty" role="status" hidden></p>
    </div>
  </div>
</section>`
