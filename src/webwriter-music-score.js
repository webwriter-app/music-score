import { AlphaTabApi, Environment, FontFileFormat, NotationElement, PlayerMode, ScrollMode, Settings, synth } from "./vendor/alphaTab.core.min.mjs"
import {
  appendMeasure, beatAddress, blankScore, canChangePitch, changePitch,
  findBeat, findNote, importMusicXML, pitchAtStep, placeNote,
  readScore, serializeScore, setHeading, setLyric, setScoreText, setTempo, trimMeasures, writtenPitch,
} from "./score-model.js"
import {
  appendButtonRect, beatPointAt, colorNote, endBarDragDelta, endBarStrokes, scoreBraces, scorePoints, sheetPosition, staffStep,
  trackLabelPoints, trackLabelPositions,
} from "./score-points.js"
import { playbackInstrumentName } from "./score-instruments.js"
import { copyPassage, editPassage, inPassage, passageBetween, readPassage, sameVoice } from "./score-passage.js"
import { applyScoreType, defaultScoreType, scoreScales, scoreTypes } from "./score-notation.js"
import { languageAncestors, messages, optionFor, sizeOption, typeOption } from "./messages.js"
import { completionPreview, entryRhythm, rhythmShortcut, scoreCompletions } from "./score-completion.js"

const tagName = "webwriter-music-score"
const accept = ".musicxml,.xml,.mxl"
const asset = path => new URL("./vendor/" + path, import.meta.url).href
const dataSelector = 'script[type="application/json"][slot="data"]:is([data-music-score], [data-musical-score]):not([src])'
const sameAddress = (left, right) => left?.join("/") === right?.join("/")
const headingFields = { title: "title", subtitle: "subTitle" }
const textFonts = {
  text: NotationElement.EffectText, lyric: NotationElement.EffectLyrics,
  title: NotationElement.ScoreTitle, subtitle: NotationElement.ScoreSubTitle,
}
const clipboardType = "application/x-webwriter-score-passage"
const transportWidth = 36
const transportButtonHeight = 18
const transportGap = 8
const rightGutter = 35
const maxAppendMeasures = 64

function position(element, { x, y, w, h }) {
  Object.assign(element.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" })
}

// Local package requests in WebWriter's editor frame are relayed by the window.
// Read alphaTab's standalone build there so workers need no nested imports.
Environment.initializeMain(
  (settings, name) => new Worker(settings.core.scriptFile, { name }),
  (context, settings) => context.audioWorklet.addModule(settings.core.scriptFile),
)
let workerSource
function loadWorkerSource() {
  workerSource ??= fetch(asset("alphaTab.min.js")).then(response => {
    if (!response.ok) throw new Error("Could not load alphaTab worker")
    return response.blob()
  }).catch(error => {
    workerSource = null
    throw error
  })
  return workerSource
}

const template = `
<style>
  :host { display: block; min-inline-size: 300px; min-block-size: var(--score-row-height, 82px);
    overflow: auto; scrollbar-width: thin; font: 0.875rem/1.45 system-ui, sans-serif; }
  [hidden] { display: none !important; }
  .notice { margin: 0; }
  .sheet { --position-blue: #356ad6; position: relative; display: grid; grid-template-columns: minmax(0, 1fr);
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
  .playing .at-highlight * { fill: #2358c0; stroke: #2358c0; }
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
  .transport button:enabled { cursor: pointer; }
  .transport button:disabled { opacity: 0.5; }
  :focus-visible { outline: 2px solid #356ad6; outline-offset: 2px; }
  #surface:focus, #targets:focus { outline: none; }
  .points { position: absolute; inset: 0; z-index: 1001; pointer-events: none; user-select: none; }
  .point { position: absolute; box-sizing: border-box; padding: 0; border: 0; border-radius: 0.2rem;
    color: #2358c0; background: transparent; pointer-events: auto; cursor: pointer; }
  .point:hover { background: #356ad620; }
  .point[data-kind=insert] { cursor: crosshair; }
  .point:is([data-kind=tempo], [data-kind=text], [data-kind=lyric], [data-kind=title], [data-kind=subtitle]) { cursor: text; }
  .point[data-heading-action] { cursor: pointer; font: 0.75rem system-ui; color: var(--position-blue); background: #fff; }
  .point[data-heading-action]:hover { background: #edf2fc; }
  .sheet:not(.focused) .point[data-heading-action] { visibility: hidden; }
  .point:is([data-kind=beat], [data-kind=insert], [data-kind=note]) { touch-action: none; }
  .point[data-selected] { background: #356ad626; }
  .point[data-drop] { box-shadow: inset 2px 0 var(--position-blue); }
  .point[data-kind=note] { z-index: 1; }
  .point[data-kind=note]:hover { background: transparent; }
  .point[data-pitch-drag] { cursor: ns-resize; }
  .point[data-move] { cursor: grab; }
  .point[data-kind=append] { z-index: 1; color: var(--position-blue); background: #356ad614;
    font: 1.125rem system-ui; white-space: nowrap; cursor: pointer; touch-action: none; }
  .sheet:not(.focused) .point[data-kind=append] { visibility: hidden; }
  .point[data-kind=append]::before { content: ""; position: absolute; inset: 0 calc(100% + 1px) 0 auto;
    width: var(--end-bar-span); cursor: ew-resize; }
  .sheet:not(.resizing-end-bar):has(.point[data-kind=append]:hover) [data-end-barline] { fill: var(--position-blue); }
  .point[data-kind=append]:hover { background: #356ad62b; }
  .point[data-trimming] { opacity: 0; }
  .sheet.resizing-end-bar, .sheet.resizing-end-bar * { cursor: ew-resize !important; }
  .tempo-digits, .editing-text { visibility: hidden; }
  .point.inline-input { z-index: 3; border-radius: 0;
    appearance: none; background: transparent; cursor: text; user-select: text; }
  .point.tempo-input { min-inline-size: calc(3ch + 2px); }
  .point.text-input { color: var(--score-text-color, black); }
  .point.text-input[data-original-text] { color: transparent; caret-color: var(--score-text-color, black); }
  .text-input[data-original-text]::selection { color: transparent; background: #356ad64d; }
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
  .completion li[aria-selected=true] { color: #2358c0; background: #356ad622; }
  .completion li[role=option]:hover { background: #356ad614; }
  .completion li[aria-current=true] > span::after { content: " ✓"; color: var(--position-blue); }
  .completion svg { inline-size: 44px; block-size: 34px; font-family: var(--music-font, alphaTab); overflow: hidden; }
  .completion svg text { text-anchor: middle; }
  .completion kbd { max-inline-size: 8rem; overflow-wrap: anywhere;
    padding: 0 4px; border: 1px solid #d7dce6; border-radius: 4px; font-size: .8em; }
  .completion-empty { margin: 4px 0 0; padding: 4px 8px; color: #5d6677; }
  @media print {
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
  <p id="notice" class="notice" role="status" hidden></p>
  <div id="sheet" class="sheet">
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <filter id="trim-tint">
        <feFlood flood-color="#a43131" />
        <feComposite in2="SourceAlpha" operator="in" />
      </filter>
    </svg>
    <div id="transport" class="transport" hidden>
      <button id="play" type="button" disabled>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          <path id="playIcon" d="M7 4v16l13-8z"/>
          <path id="pauseIcon" d="M6 4h4v16H6zM14 4h4v16h-4z" hidden/>
        </svg>
      </button>
      <button id="stop" type="button" disabled>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          <rect x="5" y="5" width="14" height="14"/>
        </svg>
      </button>
    </div>
    <div id="score"></div>
    <div id="trackLabels" class="track-labels"></div>
    <div class="append-layer" aria-hidden="true"><div id="appendScore"></div></div>
    <div id="points" class="points" hidden>
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

class MusicScore extends HTMLElement {
  static observedAttributes = ["contenteditable", "lang", "type", "size"]
  get options() {
    return { type: optionFor(this, typeOption), size: optionFor(this, sizeOption) }
  }

  get actions() {
    return { importMusicXML: { label: { _: messages(this).importScore }, input: { type: "file", accept } } }
  }

  #ui
  #api = null
  #appendApi = null
  #workerURL = null
  #score = null
  #scoreType = null
  #snapshot
  #selection = null
  #passage = null
  #targets = new Map()
  #ink = []
  #drag = null
  #endBarSpan = 0
  #appendDrag = null
  #appendPreview = null
  #previewInk = []
  #trimInk = []
  #tempo = null
  #textEdit = null
  #completion = null
  #completionNext = null
  #restoreFocus = false
  #focusListeners = null
  #focusCheck = null
  #notice = null
  #importRequest = 0
  #observer = new MutationObserver(() => this.#sync())
  #languageObserver = new MutationObserver(() => this.#refreshLanguage())

  #refreshLanguage() {
    this.#labelPoints()
    this.#refreshCompletion()
    this.#updateControls()
    this.dispatchEvent(new Event("optionschange", { bubbles: true }))
  }

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: "open" })
    shadow.innerHTML = template
    this.#ui = Object.fromEntries(Array.from(shadow.querySelectorAll("[id]"), node => [node.id, node]))
    const ui = this.#ui
    this.addEventListener("focusin", () => this.#updateFocus())
    this.addEventListener("focusout", () => {
      // Let focus settle when the popover closes or a score control is rebuilt.
      clearTimeout(this.#focusCheck)
      this.#focusCheck = setTimeout(() => this.#updateFocus(), 0)
    })
    ui.surface.addEventListener("click", event => {
      if (!this.#editing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const { target } = event
      if (target === ui.surface || target === ui.sheet || ui.score.contains(target)) {
        ui.surface.focus({ preventScroll: true })
      }
    })
    ui.play.addEventListener("click", () => this.#api?.playPause())
    ui.stop.addEventListener("click", () => this.#api?.stop())
    ui.targets.addEventListener("click", event => this.#activate(event))
    ui.targets.addEventListener("dblclick", event => this.#activate(event))
    ui.targets.addEventListener("pointerdown", event => this.#startDrag(event))
    ui.targets.addEventListener("pointermove", event => this.#moveDrag(event))
    ui.targets.addEventListener("pointerup", event => this.#endDrag(event))
    ui.targets.addEventListener("pointercancel", event => this.#endDrag(event))
    ui.targets.addEventListener("lostpointercapture", event => this.#endDrag(event))
    ui.points.addEventListener("keydown", event => this.#noteKey(event))
    for (const type of ["copy", "cut", "paste"]) {
      ui.points.addEventListener(type, event => {
        if (event.target === ui.tempo || event.target === ui.scoreText) event.stopPropagation()
        else this.#clipboard(event)
      })
    }
    ui.completionInput.addEventListener("input", () => this.#refreshCompletion())
    ui.scoreText.addEventListener("input", () => this.#showTextDraft())
    ui.completionInput.addEventListener("keydown", event => this.#completionKey(event))
    ui.completionList.addEventListener("pointerdown", event => {
      if (event.target.closest("[role=option]")) event.preventDefault()
    })
    ui.completionList.addEventListener("click", event => {
      const option = event.target.closest("[role=option]")
      if (option) this.#acceptCompletion(Number(option.dataset.index))
    })
    ui.completion.addEventListener("focusout", event => {
      if (event.relatedTarget && !ui.completion.contains(event.relatedTarget)) this.#closeCompletion()
    })
    for (const type of ["copy", "cut", "paste"]) {
      ui.completionInput.addEventListener(type, event => {
        event.stopPropagation()
        if (this.#completion?.point.address && !ui.completionInput.value) this.#clipboard(event)
      })
    }
    for (const [input, close] of [
      [ui.tempo, (save, focus) => this.#closeTempo(save, focus)],
      [ui.scoreText, (save, focus) => this.#closeText(save, focus)],
    ]) {
      input.addEventListener("blur", () => close(true))
      input.addEventListener("keydown", event => {
        event.stopPropagation()
        if (event.isComposing) return
        if (event.key === "Tab" && input === ui.tempo) {
          close(true)
          return
        }
        if (event.key === "Tab" && input === ui.scoreText && this.#textEdit?.point.kind === "lyric") {
          this.#tabLyric(event)
          return
        }
        if (event.key !== "Escape" && event.key !== "Enter") return
        event.preventDefault()
        close(event.key === "Enter", true)
      })
    }
  }

  connectedCallback() {
    this.#focusListeners = new AbortController()
    const { signal } = this.#focusListeners
    const view = this.ownerDocument.defaultView
    view?.addEventListener("focus", () => this.#updateFocus(), { signal })
    view?.addEventListener("blur", () => this.#updateFocus(false), { signal })
    this.#observer.observe(this, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["slot", "type", "src", "data-music-score", "data-musical-score"],
    })
    for (const ancestor of languageAncestors(this)) {
      if (ancestor === this) continue
      this.#languageObserver.observe(ancestor, { attributes: true, attributeFilter: ["lang"] })
    }
    this.#sync()
    this.#updateFocus()
  }

  disconnectedCallback() {
    this.#importRequest++
    this.#focusListeners?.abort()
    this.#focusListeners = null
    clearTimeout(this.#focusCheck)
    this.#ui.sheet.classList.remove("focused")
    this.#observer.disconnect()
    this.#languageObserver.disconnect()
    this.#destroyApi()
    this.#ui.sheet.hidden = true
    this.#score = null
    this.#snapshot = undefined
    this.#selection = null
    this.#passage = null
    this.#clearPoints()
    this.#notice = null
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return
    if (name === "type") {
      this.#sync()
      return
    }
    if (name === "size") {
      this.#resizeNotation()
      return
    }
    if (name === "lang") {
      this.#refreshLanguage()
    } else {
      this.#placeGutter()
      if (this.#editing) this.#drawPoints()
      else {
        this.#finishDrag()
        this.#releaseAppendDrag()
        this.#closeAppendPreview()
        this.#selection = null
        this.#passage = null
        this.#clearPoints()
      }
    }
    this.#updateControls()
  }

  get #editing() {
    return this.contentEditable !== "false" && this.isContentEditable
  }

  get #playing() {
    return this.#api?.playerState === synth.PlayerState.Playing
  }

  #updateFocus(focused = this.matches(":focus-within") && this.ownerDocument.hasFocus()) {
    const { sheet } = this.#ui
    const wasFocused = sheet.classList.contains("focused")
    sheet.classList.toggle("focused", focused)
    if (focused || !wasFocused) return
    this.#closeText(true)
    this.#closeCompletion()
    this.#restoreFocus = false
    this.#completionNext = null
    this.#finishDrag()
    this.#releaseAppendDrag()
    this.#closeAppendPreview()
    this.#selection = null
    this.#passage = null
    this.#markSelection()
  }

  get type() {
    const type = this.getAttribute("type")
    return scoreTypes.includes(type) ? type : defaultScoreType
  }

  get size() {
    const size = this.getAttribute("size")
    return Object.hasOwn(scoreScales, size) ? size : "normal"
  }

  #dataBlock() {
    return Array.from(this.children).find(child => child.matches(dataSelector))
  }

  async importMusicXML([file]) {
    if (!file || !this.isConnected || !this.#editing) return
    const request = ++this.#importRequest
    const block = this.#dataBlock()
    const original = block?.textContent
    const canCommit = () => this.isConnected && this.#editing && request === this.#importRequest
      && block === this.#dataBlock() && original === block?.textContent

    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("MusicXML exceeds 8 MiB")
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!canCommit()) return
      const text = serializeScore(importMusicXML(bytes))
      this.#writeScore(text)
    } catch {
      if (!canCommit()) return
      this.#notice = "importError"
      this.#updateControls()
      throw new Error(messages(this).importError)
    }
  }

  #writeScore(text, keepSelection = false) {
    const block = this.#dataBlock()
    if (block) {
      block.textContent = text
    } else {
      const data = this.ownerDocument.createElement("script")
      data.type = "application/json"
      data.slot = "data"
      data.setAttribute("data-music-score", "")
      data.textContent = text
      this.append(data)
    }
    this.#sync(keepSelection)
  }

  #sync(keepSelection = false) {
    const text = this.#dataBlock()?.textContent ?? null
    const type = this.type
    if (text === this.#snapshot && type === this.#scoreType) {
      this.#updateControls()
      return
    }
    this.#snapshot = text
    this.#scoreType = type
    if (!keepSelection) {
      this.#selection = null
      this.#passage = null
      this.#restoreFocus = false
      this.#completionNext = null
    }
    this.#score = null
    this.#clearPoints()
    this.#notice = null
    try {
      const score = text === null ? blankScore(type) : readScore(text)
      if (applyScoreType(score, type)) this.#notice = type
      this.#score = score
    } catch {
      this.#notice = "readError"
    }
    this.#ui.sheet.hidden = !this.#score
    if (this.#score) void this.#renderScore(this.#score)
    else this.#destroyApi()
    this.#updateControls()
  }

  async #renderScore(score) {
    try {
      if (!this.#api) {
        const source = await loadWorkerSource()
        if (!this.isConnected || this.#score !== score) return
        this.#workerURL = URL.createObjectURL(source)
        this.#createApi()
      }
      this.#api.stop()
      this.#api.renderScore(score, score.tracks.map(track => track.index))
    } catch {
      if (this.#score !== score) return
      this.#destroyApi()
      this.#notice = "renderError"
    }
    this.#updateControls()
  }

  #createScoreApi(container, playerMode) {
    const settings = new Settings()
    settings.core.scriptFile = this.#workerURL
    settings.core.includeNoteBounds = true
    settings.core.enableLazyLoading = false
    settings.core.smuflFontSources = new Map([[FontFileFormat.Woff2, asset("font/Bravura.woff2")]])
    // The shared gutter holds the controls and track names without indenting any system.
    settings.display.padding = [transportGap + transportWidth + 4, 0, rightGutter, 0]
    settings.display.scale = scoreScales[this.size]
    settings.notation.elements.set(NotationElement.TrackNames, false)
    settings.player.playerMode = playerMode
    if (playerMode === PlayerMode.EnabledSynthesizer) {
      settings.player.enablePlaybackRangeSelection = false
      settings.player.soundFont = asset("soundfont/sonivox.sf2")
      settings.player.scrollMode = ScrollMode.Off
    }
    const api = new AlphaTabApi(container, settings)
    container.style.setProperty("--music-font-size", settings.display.resources.engravingSettings.musicFontSize + "px")
    const fontClass = Array.from(api.canvasElement.element.classList).find(name => /^at\d*$/.test(name))
    container.style.setProperty("--music-font", "alphaTab" + (fontClass?.slice(2) ?? ""))
    return api
  }

  #createApi() {
    const api = this.#createScoreApi(this.#ui.score, PlayerMode.EnabledSynthesizer)
    this.#api = api
    let playingSystem = null
    const reducedMotion = this.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)")
    api.postRenderFinished.on(() => {
      playingSystem = null
      this.#placeGutter()
      if (this.#drag?.kind === "pitch") this.#updateDragPreview()
      else if (!this.#drag) this.#drawPoints()
    })
    api.playerReady.on(() => this.#updateControls())
    api.playerStateChanged.on(() => {
      playingSystem = null
      this.#updateControls()
    })
    api.playedBeatChanged.on(beat => {
      if (this.#api !== api || !this.#playing) return
      const system = api.boundsLookup?.findMasterBarByIndex(beat.voice.bar.index)?.staffSystemBounds
      if (!system || system === playingSystem) return
      const behavior = playingSystem && !reducedMotion?.matches ? "smooth" : "instant"
      playingSystem = system
      this.#ui.score.querySelector(".at-cursor-bar")?.scrollIntoView({
        block: "nearest", inline: "nearest", behavior,
      })
    })
    api.error.on(() => {
      this.#notice = "renderError"
      this.#updateControls()
    })
  }

  #destroyApi() {
    this.#appendApi?.destroy()
    this.#appendApi = null
    this.#api?.destroy()
    this.#api = null
    this.#ui.transport.hidden = true
    this.#ui.trackLabels.replaceChildren()
    this.#ui.rowMinimum.textContent = ""
    if (this.#workerURL) URL.revokeObjectURL(this.#workerURL)
    this.#workerURL = null
  }

  #resizeNotation() {
    const scale = scoreScales[this.size]
    if (!this.#score || !this.#api || this.#api.settings.display.scale === scale) return
    this.#clearPoints()
    for (const api of [this.#api, this.#appendApi]) {
      if (!api) continue
      api.settings.display.scale = scale
      api.updateSettings()
    }
    this.#api.render()
  }

  #placeGutter() {
    const systems = this.#api?.boundsLookup?.staffSystems ?? []
    const system = systems[0]
    const firstStaff = system?.bars[0]?.bars[0]
    const { rowMinimum, trackLabels, transport } = this.#ui
    if (!firstStaff || firstStaff.bar.staff.track.score !== this.#score) return
    const { resources, scale } = this.#api.settings.display
    trackLabels.style.font = resources.elementFonts.get(NotationElement.TrackNames).toCssString(scale)
    trackLabels.style.color = resources.barSeparatorColor.rgba
    const { thinBarlineThickness, thinThickBarlineSeparation, thickBarlineThickness } = resources.engravingSettings
    this.#endBarSpan = (thinBarlineThickness + thinThickBarlineSeparation + thickBarlineThickness) * scale
    const minimum = `:host { --score-row-height: ${Math.ceil(system.realBounds.h)}px; }`
    if (rowMinimum.textContent !== minimum) rowMinimum.textContent = minimum
    const { y, h } = firstStaff.realBounds
    transport.style.marginTop = this.#score.title?.trim() ? "" : Math.max(4, y + h / 2 - transportButtonHeight) + "px"
    transport.hidden = false
    const braces = scoreBraces(this.#ui.sheet, this.#ui.score)
    const labels = trackLabelPositions(this.#score, systems, braces, this.#editing)
    trackLabels.replaceChildren(...labels.map(({ name, trackIndex, x, y }) => {
      const label = this.ownerDocument.createElement("span")
      label.className = "track-label"
      label.dataset.track = trackIndex
      label.textContent = name
      label.style.left = x - 4 + "px"
      label.style.top = y + "px"
      return label
    }))
  }

  #clearPoints() {
    const focused = this.shadowRoot.activeElement
    const { targets, tempo, scoreText, completion } = this.#ui
    this.#drag = null
    this.#closeTempo(false)
    this.#closeText(false)
    this.#closeCompletion()
    this.#releaseAppendDrag()
    this.#closeAppendPreview()
    for (const glyph of this.#ink) glyph.classList.remove("selected-ink")
    for (const stroke of this.#ui.score.querySelectorAll("[data-end-barline]")) stroke.removeAttribute("data-end-barline")
    this.#ink = []
    this.#targets.clear()
    if (this.#editing && (targets.contains(focused) || completion.contains(focused) || focused === tempo || focused === scoreText)) {
      targets.focus({ preventScroll: true })
    }
    targets.replaceChildren()
  }

  #drawPoints() {
    const bounds = this.#api?.boundsLookup
    if (this.#drag || !this.#editing || !bounds?.isFinished) return
    const firstBar = bounds.staffSystems[0]?.bars[0]?.bars[0]?.bar
    if (firstBar?.staff.track.score !== this.#score) return
    const active = this.#targets.get(this.shadowRoot.activeElement)
    this.#clearPoints()
    const fragment = this.ownerDocument.createDocumentFragment()
    const { sheet, score, trackLabels } = this.#ui
    const points = scorePoints(sheet, bounds, score).concat(trackLabelPoints(sheet, trackLabels.children))
    for (const point of points) {
      const button = this.ownerDocument.createElement("button")
      button.type = "button"
      button.className = "point"
      button.dataset.kind = point.kind
      if (point.printed) button.tabIndex = -1
      button.toggleAttribute("data-heading-action", point.headingAction === true)
      button.toggleAttribute("data-pitch-drag", point.pitchDrag === true)
      if (point.kind === "append") {
        button.textContent = "+"
        button.style.setProperty("--end-bar-span", this.#endBarSpan + "px")
        for (const stroke of endBarStrokes(this.#ui.sheet, this.#ui.score, point.rect, this.#endBarSpan)) {
          stroke.setAttribute("data-end-barline", "")
        }
        button.addEventListener("pointerdown", event => this.#startAppendDrag(event))
        button.addEventListener("pointermove", event => this.#moveAppendDrag(event))
        for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
          button.addEventListener(type, event => this.#endAppendDrag(event))
        }
        button.addEventListener("keydown", event => {
          if (event.key !== "Escape" || !this.#appendDrag) return
          event.preventDefault()
          this.#releaseAppendDrag()
          this.#closeAppendPreview()
        })
      }
      position(button, point.rect)
      this.#targets.set(button, point)
      fragment.append(button)
    }
    this.#ui.targets.replaceChildren(fragment)
    this.#labelPoints()
    const focus = this.#restoreFocus === true ? { address: this.#selection ?? this.#passage?.first } : this.#restoreFocus || active
    if (this.matches(":focus-within") && (focus?.address || focus?.kind)) {
      for (const [button, point] of this.#targets) {
        if ((!focus.kind || point.kind === focus.kind) && sameAddress(point.address, focus.address)
          && (focus.measure === undefined || point.measure === focus.measure)
          && (focus.trackIndex === undefined || point.trackIndex === focus.trackIndex)
          && (!focus.bar || sameAddress(point.bar, focus.bar))) {
          button.focus({ preventScroll: true })
          break
        }
      }
    }
    this.#restoreFocus = false
    this.#resumeEditor()
  }

  #labelPoints() {
    const t = messages(this)
    const kind = this.#textEdit?.point.kind
    if (kind) this.#labelTextInput(kind, t)
    for (const [button, point] of this.#targets) {
      const label = point.kind === "instrument" ? this.#instrumentLabel(point.trackIndex, t)
        : point.headingAction ? this.#headingActionLabel(point.kind, t)
        : point.kind === "note" && !point.pitchDrag ? t.selectNote : t[point.kind]
      if (point.headingAction) button.textContent = label
      button.title = point.kind === "append" ? t.appendDrag : label
      button.setAttribute("aria-label", label)
    }
    this.#markSelection()
  }

  #instrumentLabel(trackIndex, t) {
    const track = this.#score.tracks[trackIndex]
    const part = track.name ? t.instrumentFor.replace("{part}", track.name) : t.instrument
    return part + " (" + playbackInstrumentName(track) + ")"
  }

  #currentScore() {
    if (!this.isConnected || !this.#editing) return null
    const current = this.#dataBlock()?.textContent ?? null
    if (current !== this.#snapshot || this.type !== this.#scoreType) {
      this.#sync()
      return null
    }
    return current === null ? blankScore(this.#scoreType) : readScore(current)
  }

  #commit(change, selection = this.#selection) {
    const score = this.#currentScore()
    if (!score) return
    const result = change(score)
    if (!result) {
      this.#restoreFocus = false
      return
    }
    this.#selection = Array.isArray(result) ? result : selection
    if (this.#selection) this.#passage = null
    this.#writeScore(serializeScore(score), true)
  }

  #activate(event) {
    const point = this.#targets.get(event.target)
    if (!point || this.#drag || this.#appendDrag || !this.#editing) return
    if (event.type === "dblclick" && point.kind !== "insert") return
    if (["clef", "key", "meter", "tempo", "append"].includes(point.kind)) this.#closeCompletion()
    switch (point.kind) {
      case "note":
      case "beat":
        if (event.detail === 0) {
          this.#selectPoint(point)
          this.#openCompletion(point, event.target)
        }
        break
      case "insert": {
        if (event.type === "click") {
          if (event.detail === 0) {
            this.#selectPoint(point)
            this.#openCompletion(point, event.target)
          }
          break
        }
        const { rect, staff, address } = point
        const { x, y } = sheetPosition(this.#ui.sheet, event.clientX, event.clientY)
        this.#commit(score => placeNote(findBeat(score, address), staffStep(staff, y), (x - rect.x) / rect.w))
        break
      }
      case "clef":
      case "key":
      case "meter":
      case "instrument":
        this.#openCompletion(point, event.target)
        break
      case "text":
      case "title":
      case "subtitle":
        this.#openText(point, event.target)
        break
      case "lyric":
        if (this.#textEdit?.point.kind === "lyric") {
          if (!sameAddress(this.#textEdit.point.address, point.address)) this.#moveLyricEditor(event.target, point)
        } else this.#openText(point, event.target)
        break
      case "dynamics":
        this.#selectPoint(point)
        this.#openCompletion(point, event.target)
        break
      case "tempo":
        this.#openTempo(point, event.target)
        break
      case "append":
        if (event.detail === 0) this.#addMeasures(1, true)
        break
    }
  }

  #startDrag(event) {
    const point = this.#targets.get(event.target)
    if (event.button === 0 && point?.kind === "lyric" && this.#textEdit?.point.kind === "lyric") {
      event.preventDefault()
      return
    }
    if (this.#drag || this.#appendDrag || !point || !["note", "beat", "insert"].includes(point.kind)
      || event.button !== 0 || !this.#editing) return
    this.#closeCompletion()
    this.#closeAppendPreview()
    const origin = point.address.slice(0, 5)
    const prior = this.#selectedPassage()
    const inside = prior && inPassage(origin, prior)
      && (prior.note === undefined || sameAddress(point.address, this.#selection))
    const movable = inside && (this.#selection || Array.from(this.#targets.values()).some(candidate =>
      candidate.kind === "note" && inPassage(candidate.address, prior)))
    const note = point.pitchDrag ? findNote(this.#score, point.address) : null
    const { sheet } = this.#ui
    const stepHeight = (point.staff.h / 8) * sheet.getBoundingClientRect().height / sheet.offsetHeight
    const startStep = staffStep(point.staff, point.rect.y + point.rect.h / 2)
    const anchor = event.shiftKey && prior && sameVoice(prior.first, origin)
      ? prior.first : origin
    this.#drag = {
      kind: "pending", point, origin, anchor, extend: event.shiftKey,
      priorNote: this.#selection, priorPassage: this.#passage,
      move: !event.shiftKey && movable ? prior : null,
      note, address: point.address, button: event.target, id: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      startStep, step: startStep, stepHeight, preview: null, previewShift: 0, rendering: false,
    }
    event.target.setPointerCapture(event.pointerId)
    if (!inside && !event.shiftKey) this.#selectPoint(point)
  }

  #moveDrag(event) {
    const drag = this.#drag
    if (!drag || drag.id !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.kind === "pending") {
      if (Math.hypot(dx, dy) < 4) return
      if (!drag.extend && (!drag.move || drag.move.note !== undefined)) {
        if (Math.abs(dy) > Math.abs(dx) && drag.stepHeight > 0 && canChangePitch(drag.note, 0)) {
          drag.kind = "pitch"
          this.#selectPoint(drag.point)
        }
      }
      if (drag.kind === "pending") drag.kind = drag.move ? "move" : "select"
    }
    if (drag.kind === "pitch") {
      drag.step = drag.startStep + Math.round(dy / drag.stepHeight)
      this.#renderDragPreview()
      return
    }
    const sheet = this.#ui.sheet
    const position = sheetPosition(sheet, event.clientX, event.clientY)
    const outside = position.x < 0 || position.x > sheet.offsetWidth || position.y < 0 || position.y > sheet.offsetHeight
    const target = drag.kind === "move" && outside ? null : beatPointAt(this.#targets.values(), drag.origin, position)?.address
    if (sameAddress(target, drag.target)) return
    drag.target = target
    if (drag.kind === "select" && target) {
      this.#selection = null
      this.#passage = passageBetween(drag.anchor, target)
    }
    this.#markSelection()
  }

  #renderDragPreview() {
    const drag = this.#drag
    if (drag.rendering) return
    const { note, step, startStep } = drag
    const pitch = writtenPitch(note)
    const shift = step === startStep ? 0 : pitchAtStep(note.beat, step) - pitch
    const previewShift = canChangePitch(note, shift) ? shift : 0
    if (previewShift === drag.previewShift) return

    // Keep the document and the synth on the committed score. Only update the notation.
    drag.preview ??= readScore(serializeScore(this.#score))
    const previewNote = findNote(drag.preview, drag.address)
    changePitch(previewNote, pitch + previewShift - writtenPitch(previewNote))
    if (!previewShift) previewNote.accidentalMode = note.accidentalMode
    drag.previewShift = previewShift
    drag.rendering = true
    this.#api.renderer.renderScore(drag.preview, this.#api.tracks.map(track => track.index))
  }

  #updateDragPreview() {
    const drag = this.#drag
    if (!drag.preview) return
    const note = findNote(drag.preview, drag.address)
    const bounds = this.#api.boundsLookup?.findBeat(note.beat)
    if (bounds?.beat !== note.beat) return
    const head = bounds.notes?.find(item => item.note === note)
    if (head) {
      position(drag.button, head.noteHeadBounds)
      this.#markSelection(head)
    }
    drag.rendering = false
    this.#renderDragPreview()
  }

  #endDrag(event) {
    const drag = this.#drag
    if (!drag || drag.id !== event.pointerId) return
    this.#finishDrag(event.type === "pointerup")
  }

  #finishDrag(commit = false) {
    const drag = this.#drag
    if (!drag) return
    this.#drag = null
    if (drag.button.hasPointerCapture(drag.id)) drag.button.releasePointerCapture(drag.id)
    const score = this.#score
    if (!commit) {
      this.#selection = drag.priorNote
      this.#passage = drag.priorPassage
    } else if (drag.kind === "pending") {
      if (drag.extend) {
        this.#selection = null
        this.#passage = passageBetween(drag.anchor, drag.origin)
      } else this.#selectPoint(drag.point)
    } else if (drag.kind === "pitch" && drag.step !== drag.startStep) {
      this.#movePitch(drag.address, drag.step)
    } else if (drag.kind === "move" && drag.target && !sameAddress(drag.origin, drag.target)) {
      this.#editSelection({ selection: drag.move, target: drag.target, grab: drag.origin })
    }
    if (drag.preview && score === this.#score) {
      this.#api.renderer.renderScore(score, this.#api.tracks.map(track => track.index))
    }
    this.#markSelection()
    if (commit && (drag.kind === "pending" || drag.kind === "select")) {
      const range = this.#passage && !sameAddress(this.#passage.first, this.#passage.last)
      const end = range && Array.from(this.#targets).find(([, point]) =>
        point.beatBounds && sameAddress(point.address, drag.target))
      const y = drag.point.kind === "note" ? drag.point.rect.y + drag.point.rect.h / 2
        : sheetPosition(this.#ui.sheet, drag.startX, drag.startY).y
      this.#openCompletion(end?.[1] ?? drag.point, end?.[0] ?? drag.button, {
        group: range ? "passage" : undefined, step: staffStep(drag.point.staff, y),
      })
    }
  }

  #selectPoint(point) {
    const address = point.address
    this.#selection = point.kind === "note" ? address : null
    this.#passage = this.#selection ? null : passageBetween(address, address)
    if (point.kind === "dynamics") this.#passage.annotation = point.kind
    this.#markSelection()
  }

  #selectedPassage() {
    if (!this.#selection) return this.#passage?.annotation ? null : this.#passage
    const first = this.#selection.slice(0, 5)
    return { first, last: first, note: this.#selection[5] }
  }

  #editSelection(options) {
    const score = this.#currentScore()
    if (!score) return false
    const result = editPassage(score, options)
    if (!result) return false
    const first = options.selection?.first
    this.#selection = null
    this.#passage = result.passage ?? passageBetween(first, first)
    this.#restoreFocus = true
    this.#writeScore(result.text, true)
    return true
  }

  #clipboard(event) {
    const selection = this.#selectedPassage()
    const clipboard = event.clipboardData
    if (!selection || !clipboard || this.#drag || this.#appendDrag || !this.#editing) return
    if (event.type === "paste") {
      const source = readPassage(clipboard.getData(clipboardType) || clipboard.getData("text/plain"))
      if (!source) return
      event.preventDefault()
      this.#editSelection({ source, target: selection.first })
      return
    }
    const score = this.#currentScore()
    const source = score && copyPassage(score, selection)
    if (!source) {
      event.preventDefault()
      return
    }
    const text = JSON.stringify(source)
    event.preventDefault()
    if (event.type === "cut" && !this.#editSelection({ selection })) return
    clipboard.setData("text/plain", text)
    clipboard.setData(clipboardType, text)
  }

  #movePitch(address, step) {
    this.#commit(score => {
      const note = findNote(score, address)
      return note && changePitch(note, pitchAtStep(note.beat, step) - writtenPitch(note))
    }, address)
  }

  #noteKey(event) {
    const point = this.#targets.get(event.target)
    if (!point?.address && event.target !== this.#ui.targets) return
    if (this.#drag) {
      if (event.key === "Escape") {
        event.preventDefault()
        this.#finishDrag()
      }
      return
    }
    if (event.key === "Tab" && point?.address) {
      this.#tabPosition(event, point.address)
    } else if (point?.pitchDrag && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const { staff, rect, address } = point
      event.preventDefault()
      this.#restoreFocus = true
      const step = staffStep(staff, rect.y + rect.h / 2) + (event.key === "ArrowUp" ? -1 : 1)
      this.#movePitch(address, step)
    } else if (event.key === " " && point?.address) {
      event.preventDefault()
      if (point.kind === "text" || point.kind === "lyric") this.#openText(point, event.target)
      else {
        this.#selectPoint(point)
        this.#openCompletion(point, event.target)
      }
    } else if (event.key === "Escape") {
      this.#selection = null
      this.#passage = null
      this.#markSelection()
    } else if (event.key === "Delete" || event.key === "Backspace") {
      const selection = this.#selectedPassage() ?? (point?.kind === "note" && {
        first: point.address.slice(0, 5), last: point.address.slice(0, 5), note: point.address[5],
      })
      if (selection) {
        event.preventDefault()
        this.#editSelection({ selection })
      }
    }
  }

  #adjacentPoint(address, backwards, matches) {
    const direction = backwards ? -1 : 1
    const compare = (a, b) => direction * (a[2] - b[2] || a[4] - b[4])
    let next
    for (const target of this.#targets) {
      const point = target[1]
      if (!matches(point) || !sameVoice(point.address, address) || compare(point.address, address) <= 0) continue
      if (!next || compare(point.address, next[1].address) < 0) next = target
    }
    return next
  }

  #tabPosition(event, address, state) {
    if (event.altKey || event.ctrlKey || event.metaKey || !this.#editing || this.#playing) return
    const next = this.#adjacentPoint(address, event.shiftKey, point => point.beatBounds)
    if (!next) {
      this.#closeCompletion(true)
      return
    }
    const [, beat] = next
    const [button, point] = Array.from(this.#targets).find(([, point]) =>
      point.kind === "note" && sameAddress(point.address.slice(0, 5), beat.address)) ?? next
    event.preventDefault()
    event.stopPropagation()
    this.#closeCompletion()
    button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
    button.focus({ preventScroll: true })
    this.#selectPoint(point)
    this.#openCompletion(point, button, {
      duration: state?.duration, dots: state?.dots, step: point.kind === "note" ? undefined : state?.step,
    })
  }

  #tabLyric(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const next = this.#adjacentPoint(this.#textEdit.point.address, event.shiftKey,
      point => point.kind === "lyric" && !point.printed)
    if (!next) return
    event.preventDefault()
    this.#moveLyricEditor(...next)
  }

  #moveLyricEditor(button, point) {
    this.#completionNext = { kind: "lyric", address: point.address }
    this.#closeText(true, true)
    if (this.#targets.has(button)) this.#resumeEditor()
  }

  #markSelection(previewHead) {
    const beats = new Set()
    const { annotation, first } = this.#passage ?? {}
    const passage = annotation ? null : this.#passage
    let selected
    for (const [button, point] of this.#targets) {
      if (point.kind === "note") {
        const active = sameAddress(point.address, this.#selection)
        const inRange = Boolean(passage && inPassage(point.address, passage))
        button.setAttribute("aria-pressed", String(active || inRange))
        button.toggleAttribute("data-move", inRange)
        if (active) selected = point
      } else if (point.beatBounds) {
        const active = Boolean(passage && inPassage(point.address, passage))
        button.setAttribute("aria-pressed", String(active))
        button.toggleAttribute("data-selected", active)
        button.toggleAttribute("data-move", active)
        button.toggleAttribute("data-drop", this.#drag?.kind === "move" && sameAddress(point.address, this.#drag.target))
        if (active) beats.add(point.beatBounds.beat.id)
      } else if (point.kind === "dynamics") {
        const active = point.kind === annotation && sameAddress(point.address, first)
        button.setAttribute("aria-pressed", String(active))
        button.toggleAttribute("data-selected", active && !point.printed)
      }
    }
    const note = selected && findNote(this.#score, selected.address)
    const { sheet, score } = this.#ui
    for (const glyph of this.#ink) glyph.classList.remove("selected-ink")
    for (const beat of beats) {
      for (const group of score.querySelectorAll(`svg g.b${beat}`)) group.classList.add("selected-ink")
    }
    if (note) {
      const groups = score.querySelectorAll(`svg g.b${previewHead?.note.beat.id ?? note.beat.id}`)
      colorNote(sheet, groups, previewHead?.noteHeadBounds ?? selected.rect)
    }
    this.#ink = Array.from(score.querySelectorAll(".selected-ink"))
  }

  #openCompletion(point, button, { group, step, duration, dots } = {}) {
    this.#closeCompletion()
    if (!this.#score || !button.isConnected || !this.#editing || this.#playing) return
    const { completion, completionInput, score } = this.#ui
    if (step === undefined && point.kind === "note") step = staffStep(point.staff, point.rect.y + point.rect.h / 2)
    const passage = group === "passage" ? this.#passage : null
    const state = { point, button, group, passage, step, duration, dots, entries: [], index: -1, listeners: new AbortController() }
    this.#completion = state
    completionInput.value = ""
    this.#refreshCompletion()
    if (!state.entries.length) {
      this.#completion = null
      return
    }
    completionInput.setAttribute("aria-expanded", "true")
    completion.style.setProperty("--music-font", score.style.getPropertyValue("--music-font"))
    completion.showPopover()
    this.#positionCompletion()
    const { ownerDocument: document } = this
    const { signal } = state.listeners
    document.addEventListener("pointerdown", event => {
      if (!event.composedPath().includes(completion) && !event.composedPath().includes(button)) this.#closeCompletion()
    }, { capture: true, signal })
    document.addEventListener("scroll", event => {
      if (event.target !== this.#ui.completionList) this.#positionCompletion()
    }, { capture: true, signal })
    document.defaultView.addEventListener("resize", () => this.#positionCompletion(), { signal })
    completionInput.focus({ preventScroll: true })
  }

  #positionCompletion() {
    const state = this.#completion
    if (!state) return
    const { completion, completionList, completionInput } = this.#ui
    const viewport = this.ownerDocument.documentElement
    const anchor = state.button.getBoundingClientRect()
    const gap = 6
    if (anchor.bottom < 0 || anchor.top > viewport.clientHeight) {
      this.#closeCompletion()
      return
    }
    const below = viewport.clientHeight - anchor.bottom - gap * 2
    const above = anchor.top - gap * 2
    const flip = below < 285 && above > below
    completionList.style.maxBlockSize = Math.max(30, Math.min(240,
      (flip ? above : below) - completionInput.offsetHeight - 14)) + "px"
    const left = Math.max(gap, Math.min(anchor.left, viewport.clientWidth - completion.offsetWidth - gap))
    const top = flip ? Math.max(gap, anchor.top - completion.offsetHeight - gap) : anchor.bottom + gap
    completion.style.left = left + "px"
    completion.style.top = top + "px"
  }

  #refreshCompletion() {
    const state = this.#completion
    if (!state) return
    const { completionInput, completionList, completionEmpty, entryDuration: badge } = this.#ui
    const t = messages(this)
    const search = state.point.kind === "instrument" ? t.searchInstruments : t.searchScore
    completionInput.placeholder = search
    completionInput.setAttribute("aria-label", search)
    completionList.setAttribute("aria-label", t.scoreChoices)
    const beat = state.point.address && findBeat(this.#score, state.point.address)
    const editingKey = state.keyMenu || /^key(?: |$)/i.test(completionInput.value.trim())
    const rhythm = !editingKey && state.point.kind !== "dynamics" && state.group !== "passage"
      && entryRhythm(beat, state.duration, state.dots)
    badge.hidden = !rhythm
    if (!badge.hidden) {
      badge.textContent = rhythmShortcut(rhythm)
      badge.setAttribute("aria-label", t.duration + " " + badge.textContent)
      completionInput.setAttribute("aria-describedby", badge.id)
    } else completionInput.removeAttribute("aria-describedby")
    state.entries = scoreCompletions(this.#score, state, completionInput.value, t)
    completionList.replaceChildren(...state.entries.map((entry, index) => {
      const document = this.ownerDocument
      const row = document.createElement("li")
      row.id = "score-choice-" + index
      row.dataset.index = index
      row.setAttribute("role", "option")
      if (entry.current) row.setAttribute("aria-current", "true")
      const label = document.createElement("span")
      label.textContent = entry.label
      const key = document.createElement("kbd")
      key.textContent = entry.shortcut
      row.append(completionPreview(document, entry), label, key)
      return row
    }))
    completionEmpty.hidden = state.entries.length > 0
    completionEmpty.textContent = t.noScoreChoices
    this.#selectCompletion(state.entries.length ? 0 : -1)
    completionList.scrollTop = 0
    if (this.#ui.completion.matches(":popover-open")) this.#positionCompletion()
  }

  #selectCompletion(index, scroll = false) {
    const { completionInput, completionList } = this.#ui
    this.#completion.index = index
    const selected = completionList.children[index]
    for (const row of completionList.children) row.setAttribute("aria-selected", String(row === selected))
    if (!selected) {
      completionInput.removeAttribute("aria-activedescendant")
      return
    }
    completionInput.setAttribute("aria-activedescendant", selected.id)
    if (scroll) {
      const top = selected.offsetTop - completionList.offsetTop
      if (top < completionList.scrollTop) completionList.scrollTop = top
      else if (top + selected.offsetHeight > completionList.scrollTop + completionList.clientHeight) {
        completionList.scrollTop = top + selected.offsetHeight - completionList.clientHeight
      }
    }
  }

  #completionKey(event) {
    const state = this.#completion
    if (!state) return
    event.stopPropagation()
    if (event.isComposing) return
    const { key } = event
    if (key === "Escape") {
      event.preventDefault()
      this.#closeCompletion(true)
    } else if (key === "Tab" && state.point.address) {
      const address = state.group === "passage" && this.#passage
        ? (event.shiftKey ? this.#passage.first : this.#passage.last) : state.point.address
      this.#tabPosition(event, address, state)
    } else if (key === "Delete" && !event.repeat && !event.target.value && state.point.address) {
      const selection = this.#selectedPassage()
      if (selection) {
        event.preventDefault()
        this.#editSelection({ selection })
      }
    } else if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault()
      const length = state.entries.length
      if (length) this.#selectCompletion((state.index + (key === "ArrowUp" ? -1 : 1) + length) % length, true)
    } else if (key === "Enter") {
      event.preventDefault()
      this.#acceptCompletion(state.index)
    }
  }

  #acceptCompletion(index) {
    const state = this.#completion
    const choice = state?.entries[index]
    if (!choice || this.#playing) return
    const input = this.#ui.completionInput
    const value = input.value
    if (choice.openKey || choice.openGrace || choice.openMarks) {
      state.keyMenu = choice.openKey
      state.graceMenu = choice.openGrace
      state.marksMenu = choice.openMarks
      input.value = ""
      this.#refreshCompletion()
      return
    }
    if (choice.setEntryDuration) {
      state.duration = choice.duration
      state.dots = choice.dots
      input.value = ""
      this.#refreshCompletion()
      input.focus({ preventScroll: true })
      return
    }
    this.#closeCompletion(true)
    if (choice.id === "clear") {
      if (this.#passage) this.#editSelection({ selection: this.#passage })
      return
    }
    const point = state.point
    this.#restoreFocus = point
    this.#commit(score => {
      const entry = scoreCompletions(score, state, value, messages(this)).find(entry => entry.id === choice.id)
      if (!entry) return false
      const result = entry.apply()
      if (entry.advance) {
        const address = point.address.slice()
        const voice = findBeat(score, address).voice
        address[4]++
        if (address[4] >= voice.beats.length) {
          address[2]++
          address[4] = 0
        }
        const rhythm = entry.explicit || state.duration === undefined ? entry : state
        this.#completionNext = { address, step: state.step, duration: rhythm.duration, dots: rhythm.dots }
      }
      if (Array.isArray(result)) this.#restoreFocus = { address: result }
      if (entry.clearsNote) this.#restoreFocus = { address: point.address.slice(0, 5) }
      return result
    }, choice.clearsNote ? null : this.#selection)
    if (this.#completionNext && this.#targets.has(state.button)) this.#resumeEditor()
  }

  #resumeEditor() {
    const next = this.#completionNext
    if (!next) return
    this.#completionNext = null
    if (!this.matches(":focus-within")) return
    if (next.kind === "lyric") {
      for (const [button, point] of this.#targets) {
        if (point.kind !== "lyric" || point.printed || !sameAddress(point.address, next.address)) continue
        button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
        this.#openText(point, button)
        break
      }
      return
    }
    if (!entryRhythm(findBeat(this.#score, next.address), next.duration, next.dots)) return
    for (const [button, point] of this.#targets) {
      if (!point.beatBounds || !sameAddress(point.address, next.address)) continue
      this.#selectPoint(point)
      this.#openCompletion(point, button, next)
      break
    }
  }

  #closeCompletion(restoreFocus = false) {
    const state = this.#completion
    if (!state) return
    this.#completion = null
    state.listeners.abort()
    const { completion, completionInput } = this.#ui
    completion.hidePopover()
    completionInput.setAttribute("aria-expanded", "false")
    completionInput.removeAttribute("aria-activedescendant")
    if (restoreFocus && state.button.isConnected) state.button.focus({ preventScroll: true })
  }

  #addMeasures(count = 1, restoreFocus = false) {
    this.#restoreFocus = restoreFocus ? { kind: "append" } : false
    this.#commit(score => appendMeasure(score, count))
  }

  #removeMeasures(count) {
    const remaining = this.#score.masterBars.length - count
    const selection = this.#selection?.[2] >= remaining ? null : this.#selection
    this.#commit(score => {
      if (!trimMeasures(score, remaining)) return false
      if (this.#passage?.last[2] >= remaining) this.#passage = null
      return true
    }, selection)
  }

  #startAppendDrag(event) {
    if (event.button !== 0 || this.#appendDrag || this.#drag || !this.#editing) return
    const button = event.currentTarget
    const start = sheetPosition(this.#ui.sheet, event.clientX, event.clientY)
    this.#appendDrag = { button, id: event.pointerId, start, count: 0, clickAdds: start.x >= this.#targets.get(button).rect.x }
    button.setPointerCapture(event.pointerId)
  }

  #moveAppendDrag(event) {
    const drag = this.#appendDrag
    if (!drag || drag.id !== event.pointerId || drag.released) return
    const { sheet } = this.#ui
    const point = sheetPosition(sheet, event.clientX, event.clientY)
    if (!drag.point) {
      if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 4) return
      sheet.classList.add("resizing-end-bar")
    }
    drag.point = point
    this.#updateEndBarDrag()
  }

  #updateEndBarDrag(redraw = false) {
    const drag = this.#appendDrag
    const { point } = drag
    const systems = this.#api.boundsLookup.staffSystems
    const row = systems.at(-1)
    const end = row.bars.at(-1).realBounds
    const forward = point.y >= row.realBounds.y
      && (point.x > end.x + end.w || point.y >= row.realBounds.y + row.realBounds.h)
    if (forward) this.#prepareAppendPreview()
    drag.awaitingLayout = forward && this.#appendPreview?.rendering
    const count = endBarDragDelta(point, systems, forward ? this.#appendPreview?.areas : undefined)
    if (count === drag.count && !redraw) return
    this.#clearEndBarInk()
    drag.count = count
    if (count < 0) this.#showTrimPreview(this.#score.masterBars.length + count)
    else if (count > 0) this.#showAppendPreview(count)
  }

  #endAppendDrag(event) {
    const drag = this.#appendDrag
    if (!drag || drag.id !== event.pointerId || drag.released) return
    if (event.type === "pointerup" && drag.awaitingLayout) {
      drag.released = true
      return
    }
    this.#finishAppendDrag(event.type === "pointerup")
  }

  #finishAppendDrag(commit) {
    const drag = this.#appendDrag
    this.#releaseAppendDrag()
    if (commit) {
      if (!drag.point && drag.clickAdds) this.#addMeasures()
      else if (drag.count > 0) this.#addMeasures(drag.count)
      else if (drag.count < 0) this.#removeMeasures(-drag.count)
    }
    this.#closeAppendPreview()
  }

  #releaseAppendDrag() {
    const drag = this.#appendDrag
    this.#appendDrag = null
    this.#ui.sheet.classList.remove("resizing-end-bar")
    if (drag?.button.hasPointerCapture(drag.id)) drag.button.releasePointerCapture(drag.id)
  }

  #prepareAppendPreview() {
    if (this.#appendPreview) return
    const score = readScore(serializeScore(this.#score))
    // Measure one stable projection. Each gesture reveals only the measures it has covered.
    if (!appendMeasure(score, maxAppendMeasures)) return
    if (!this.#appendApi) {
      this.#appendApi = this.#createScoreApi(this.#ui.appendScore, PlayerMode.Disabled)
      this.#appendApi.postRenderFinished.on(() => this.#measureAppendPreview())
      this.#appendApi.error.on(() => {
        if (this.#appendDrag) this.#finishAppendDrag(false)
      })
    }
    this.#appendPreview = { score, rendering: true }
    this.#appendApi.renderScore(score, score.tracks.map(track => track.index))
  }

  #measureAppendPreview() {
    const preview = this.#appendPreview
    const drag = this.#appendDrag
    if (!preview || !drag) return
    const bounds = this.#appendApi.boundsLookup
    const count = this.#score.masterBars.length
    const last = bounds?.findMasterBarByIndex(preview.score.masterBars.length - 1)
    if (last?.bars[0]?.bar.staff.track.score !== preview.score) return
    preview.rendering = false

    // Replace the final line with the renderer's layout. Start earlier if a bar wraps differently.
    const liveSystems = this.#api.boundsLookup.staffSystems
    const projectedSystems = bounds.staffSystems
    const firstChanged = liveSystems.findIndex((system, index) =>
      system.bars.at(-1).index !== projectedSystems[index]?.bars.at(-1).index)
    const start = firstChanged < 0 ? liveSystems.length - 1 : firstChanged
    preview.replacementTop = liveSystems[start].realBounds.y
    const dy = preview.replacementTop - projectedSystems[start].realBounds.y
    preview.areas = projectedSystems.slice(start).map(({ realBounds: { y, h }, bars }) => {
      const added = bars.filter(bar => bar.index >= count)
      const edges = added.map(({ realBounds: bar }) => bar.x + bar.w)
      return { y, h, dy, bars, edges, fadeAt: added[0]?.realBounds.x }
    })
    this.#updateEndBarDrag(true)
    if (drag.released) this.#finishAppendDrag(true)
  }

  #showAppendPreview(count) {
    const { sheet, score, appendScore } = this.#ui
    const existing = this.#score.masterBars.length
    const endIndex = existing + count - 1
    const areas = []
    let last
    for (const area of this.#appendPreview.areas) {
      if (area.bars[0].index > endIndex) break
      last = area.bars[Math.min(area.bars.length - 1, endIndex - area.bars[0].index)]
      const { x, w } = last.realBounds
      areas.push({ ...area, right: x + w })
    }
    sheet.style.minHeight = Math.ceil(Math.max(...areas.map(({ y, h, dy }) => y + h + dy))) + "px"
    for (const svg of appendScore.querySelectorAll(".at-surface-svg")) {
      const box = svg.getBoundingClientRect()
      const start = sheetPosition(sheet, box.left, box.top)
      const end = sheetPosition(sheet, box.right, box.bottom)
      const middle = (start.y + end.y) / 2
      const area = areas.find(({ y, h, right }) => middle >= y && middle < y + h && start.x < right)
      if (!area) continue
      svg.style.clipPath = `inset(0 ${Math.max(0, end.x - area.right)}px 0 0)`
      svg.style.transform = `translateY(${area.dy}px)`
      const replacesExisting = area.bars[0].index < existing
      if (replacesExisting && area.fadeAt !== undefined) {
        const split = Math.max(0, area.fadeAt - start.x) + "px"
        svg.style.maskImage = `linear-gradient(to right, #000 ${split}, #0006 ${split})`
      }
      svg.setAttribute("data-append-ghost", replacesExisting ? "replacement" : "new")
      this.#previewInk.push(svg)
    }
    for (const svg of score.querySelectorAll(".at-surface-svg")) {
      const box = svg.getBoundingClientRect()
      const { y } = sheetPosition(sheet, box.left, (box.top + box.bottom) / 2)
      if (y >= this.#appendPreview.replacementTop) svg.setAttribute("data-append-replaced", "")
    }
    const area = areas.at(-1)
    const staff = last.bars[0].realBounds
    position(this.#appendDrag.button, appendButtonRect(sheet.offsetWidth, { ...staff, y: staff.y + area.dy }))
  }

  #clearAppendInk() {
    for (const svg of this.#previewInk) {
      svg.removeAttribute("data-append-ghost")
      svg.style.clipPath = ""
      svg.style.maskImage = ""
      svg.style.transform = ""
    }
    this.#previewInk = []
    for (const svg of this.#ui.score.querySelectorAll("[data-append-replaced]")) svg.removeAttribute("data-append-replaced")
  }

  #showTrimPreview(remaining) {
    const { sheet, score } = this.#ui
    const bounds = this.#api.boundsLookup
    const last = bounds.findMasterBarByIndex(remaining - 1)
    const firstRemoved = bounds.findMasterBarByIndex(remaining)
    if (!last || !firstRemoved) return
    const rows = bounds.staffSystems.slice(firstRemoved.staffSystemBounds.index)
    const edge = last.realBounds.x + last.realBounds.w
    for (const svg of score.querySelectorAll(".at-surface-svg")) {
      const box = svg.getBoundingClientRect()
      const { x, y } = sheetPosition(sheet, box.left, (box.top + box.bottom) / 2)
      const row = rows.find(({ realBounds: bounds }) => y >= bounds.y && y < bounds.y + bounds.h)
      if (!row) continue
      if (row !== last.staffSystemBounds || x >= edge) {
        svg.setAttribute("data-trim-ghost", "row")
      } else {
        const right = sheetPosition(sheet, box.right, box.top).x
        if (right <= edge) continue
        const ghost = svg.cloneNode(true)
        ghost.classList.remove("at-surface-svg")
        ghost.setAttribute("data-trim-ghost", "copy")
        ghost.setAttribute("aria-hidden", "true")
        ghost.style.clipPath = `inset(0 0 0 ${edge - x}px)`
        svg.after(ghost)
        this.#trimInk.push(ghost)
        svg.style.clipPath = `inset(0 ${right - edge}px 0 0)`
        svg.setAttribute("data-trim-ghost", "suffix")
      }
      this.#trimInk.push(svg)
    }
    if (this.#trimInk.length) this.#appendDrag.button.setAttribute("data-trimming", "")
  }

  #closeAppendPreview() {
    this.#appendPreview = null
    this.#clearEndBarInk()
  }

  #clearEndBarInk() {
    this.#clearAppendInk()
    for (const svg of this.#trimInk) {
      if (svg.dataset.trimGhost === "copy") svg.remove()
      else {
        svg.style.clipPath = ""
        svg.removeAttribute("data-trim-ghost")
      }
    }
    this.#trimInk = []
    this.#ui.sheet.style.minHeight = ""
    const button = this.#ui.targets.querySelector('[data-kind="append"]')
    if (button) {
      button.removeAttribute("data-trimming")
      position(button, this.#targets.get(button).rect)
    }
  }

  #headingActionLabel(kind, t) {
    if (kind === "title") return this.#score.title ? t.title : t.addTitle
    return this.#score.subTitle ? t.subtitle : t.addSubtitle
  }

  #labelTextInput(kind, t = messages(this)) {
    const input = this.#ui.scoreText
    input.setAttribute("aria-label", t[kind])
    input.placeholder = kind === "lyric" ? t.addLyric : kind === "title" ? t.addTitle
      : kind === "subtitle" ? t.addSubtitle : t.addText
  }

  #openText(point, button) {
    if (this.#textEdit || this.#playing) return
    const { kind } = point
    const heading = headingFields[kind]
    const beat = point.address && findBeat(this.#score, point.address)
    if (!heading && !beat) return
    const printed = !heading && !point.glyph && Array.from(this.#targets.values()).find(target =>
      target.kind === kind && target.printed && sameAddress(target.address, point.address))
    const glyph = point.glyph ?? printed?.glyph
    const { sheet, scoreText: input } = this.#ui
    const minWidth = 96
    const { resources, scale } = this.#api.settings.display
    input.style.font = resources.elementFonts.get(textFonts[kind]).toCssString(scale)
    input.style.removeProperty("--score-text-color")
    const ink = glyph?.matches("text") ? glyph : glyph?.querySelector("text")
    input.style.textAlign = !ink && (heading || kind === "lyric") ? "center" : "start"
    let { x, y, w, h } = point.rect
    if (ink) {
      const { fontFamily, fontSize, fontStyle, fontWeight, fill } = getComputedStyle(ink)
      Object.assign(input.style, { fontFamily, fontSize, fontStyle, fontWeight })
      input.style.setProperty("--score-text-color", fill)
      // The click target can be clipped to the staff's editing area. Align the
      // input with the text itself so it stays put when selected.
      const box = ink.getBoundingClientRect()
      const start = sheetPosition(sheet, box.left, box.top)
      const end = sheetPosition(sheet, box.right, box.bottom)
      x = start.x
      y = start.y
      w = end.x - x
      h = end.y - y
    } else if (heading) {
      x = Math.min(48, sheet.offsetWidth / 6)
      w = sheet.offsetWidth - 2 * x
      h = Math.ceil(parseFloat(input.style.fontSize)) + 6
      const title = kind === "subtitle" && Array.from(this.#targets.values()).find(target => target.kind === "title" && target.glyph)
      if (title) y = title.rect.y + title.rect.h
    } else if (kind === "lyric") {
      w = minWidth
      x = Math.max(0, Math.min(sheet.offsetWidth - w, (point.onNotesX ?? x + point.rect.w / 2) - w / 2))
      const height = 16
      y = Math.max(0, Math.min(sheet.offsetHeight - height, y + (h - height) / 2))
      h = height
    } else {
      x = Math.max(x, point.onNotesX ?? x)
      const height = Math.max(16, Math.min(20, h))
      y = Math.max(0, y + (h - height) / 2)
      h = height
      const tempo = Array.from(this.#targets.values()).find(({ kind, rect }) =>
        kind === "tempo" && y < rect.y + rect.h && y + h > rect.y
        && x < rect.x + rect.w && x + minWidth > rect.x)
      if (tempo) {
        const afterTempo = tempo.rect.x + tempo.rect.w + 3
        if (afterTempo + minWidth <= sheet.offsetWidth) x = afterTempo
      }
    }
    w = Math.min(sheet.offsetWidth - x, Math.max(minWidth, w + 2))
    position(input, { x, y, w, h })
    this.#closeCompletion()
    this.#selection = null
    this.#passage = null
    this.#markSelection()
    this.#labelTextInput(kind)
    input.value = (heading ? this.#score[heading] : kind === "lyric" ? beat.lyrics?.[0] : beat.text) ?? ""
    this.#textEdit = { point, button, glyph, initialValue: input.value }
    this.#showTextDraft()
    input.hidden = false
    input.focus({ preventScroll: true })
    input.select()
    input.scrollLeft = 0
  }

  #showTextDraft() {
    const { glyph, initialValue } = this.#textEdit ?? {}
    const input = this.#ui.scoreText
    // Keep the original engraving visible until typing changes the text.
    const original = Boolean(glyph && input.value === initialValue)
    input.toggleAttribute("data-original-text", original)
    glyph?.classList.toggle("editing-text", !original)
  }

  #closeText(save, restoreFocus = false) {
    const edit = this.#textEdit
    if (!edit) return
    this.#textEdit = null
    const { point, button, glyph, initialValue } = edit
    const input = this.#ui.scoreText
    const value = input.value
    glyph?.classList.remove("editing-text")
    input.hidden = true
    input.removeAttribute("data-original-text")
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true })
    if (!save || value === initialValue) return
    if (restoreFocus) this.#restoreFocus = point
    this.#commit(score => {
      const heading = headingFields[point.kind]
      if (heading) return setHeading(score, heading, value)
      const beat = findBeat(score, point.address)
      return point.kind === "lyric" ? setLyric(beat, value) : setScoreText(beat, value)
    })
  }

  #openTempo(point, button) {
    const { glyph, prefix, digits, suffix, rect } = point
    if (this.#tempo || !glyph.isConnected) return
    this.#tempo = { point, button }
    const input = this.#ui.tempo
    const { fontFamily, fontSize, fontStyle, fontWeight, fill } = getComputedStyle(glyph)
    Object.assign(input.style, { fontFamily, fontSize, fontStyle, fontWeight, color: fill, lineHeight: rect.h + "px" })
    position(input, { ...rect, w: rect.w + 2 })
    const hiddenDigits = this.ownerDocument.createElementNS(glyph.namespaceURI, "tspan")
    hiddenDigits.classList.add("tempo-digits")
    hiddenDigits.textContent = digits
    glyph.replaceChildren(prefix, hiddenDigits, suffix)
    input.setAttribute("aria-label", messages(this).bpm)
    input.value = digits
    input.hidden = false
    input.focus({ preventScroll: true })
    input.select()
  }

  #closeTempo(save, restoreFocus = false) {
    if (!this.#tempo) return
    const { point: { glyph, prefix, digits, suffix, measure }, button } = this.#tempo
    this.#tempo = null
    const input = this.#ui.tempo
    if (glyph.isConnected) glyph.textContent = prefix + digits + suffix
    input.hidden = true
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true })
    const value = input.value.trim()
    if (!save || !/^\d+$/.test(value)) return
    if (restoreFocus) this.#restoreFocus = { kind: "tempo", measure }
    this.#commit(score => setTempo(score.masterBars[measure], Number(value)))
  }

  #updateControls() {
    const ui = this.#ui
    const t = messages(this)
    const ready = Boolean(this.#score && this.#api?.isReadyForPlayback)
    const playing = this.#playing
    if (playing) {
      this.#completionNext = null
      this.#closeCompletion()
      this.#closeText(false)
    }
    ui.sheet.classList.toggle("playing", playing)
    ui.play.title = playing ? t.pause : t.play
    ui.stop.title = t.stop
    ui.play.setAttribute("aria-label", ui.play.title)
    ui.stop.setAttribute("aria-label", ui.stop.title)
    ui.playIcon.toggleAttribute("hidden", playing)
    ui.pauseIcon.toggleAttribute("hidden", !playing)
    ui.play.disabled = !ready
    ui.stop.disabled = !ready
    ui.points.hidden = !this.#editing
    ui.notice.hidden = !this.#notice
    ui.notice.textContent = this.#notice ? t[this.#notice] : ""
  }

}

customElements.define(tagName, MusicScore)
