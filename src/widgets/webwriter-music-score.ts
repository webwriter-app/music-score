import { PermissionsCore } from "@webwriter/widget/permissions"
import { blankScore, importMusicXML, localizeLabels, readScore, serializeScore } from "../model/score-model"
import { applyScoreType, defaultScoreType, scoreScales, scoreTypes } from "../model/score-notation"
import { languageAncestors, messages, optionFor, sizeOption, typeOption } from "../model/messages"
import { ScoreSession } from "../components/score-session"
import { template } from "../components/score-template"
import type { model } from "../assets/alphatab-core"
import type { Notice, Ui } from "../components/score-shared"

const accept = ".musicxml,.xml,.mxl"
const dataSelector = 'script[type="application/json"][slot="data"]:is([data-music-score], [data-musical-score]):not([src])'
const labelsSelector = 'script[type="application/json"][slot="data"][data-music-score-labels]:not([src])'

// The widget is a plain element without Lit, so the registration decorator is this small one.
function customElement(tag: string) {
  return (target: CustomElementConstructor, context: ClassDecoratorContext) => {
    context.addInitializer(() => customElements.define(tag, target))
  }
}

/**
 * Create, import and play scores. A score is stored as alphaTab JSON in a
 * `<script type="application/json" slot="data" data-music-score>` child; without it the widget starts with a blank score.
 * MusicXML files (`.musicxml`, `.xml`, `.mxl`, up to 8 MiB) are imported through the `importMusicXML` action.
 *
 * Music Score bundles alphaTab 1.9.0 under the Mozilla Public License 2.0 (https://www.mozilla.org/MPL/2.0/).
 * The bundled JavaScript keeps the upstream copyright and license notices. `scripts/alphatab.mjs` reproduces the changes
 * applied to the pinned release (https://github.com/CoderLine/alphaTab/releases/tag/v1.9.0).
 *
 * @attr {string} type - Notation: "standard", "guitar-tab", "drum-tab" or "jianpu".
 * @attr {string} size - Scale of the notation: "compact", "normal" or "spacious".
 * @attr {string} lang - Language of the interface. Defaults to the language of the document.
 */
@customElement("webwriter-music-score")
export class WebwriterMusicScore extends HTMLElement {
  static observedAttributes = ["contenteditable", "lang", "type", "size"]

  #permissions = new PermissionsCore(this)

  get options() {
    return { type: optionFor(this, typeOption), size: optionFor(this, sizeOption) }
  }

  get actions() {
    return { importMusicXML: { label: { _: messages(this).importScore }, input: { type: "file", accept } } }
  }

  get type(): string {
    const type = this.getAttribute("type")
    return type !== null && scoreTypes.includes(type) ? type : defaultScoreType
  }

  get size(): keyof typeof scoreScales {
    const size = this.getAttribute("size")
    return size !== null && Object.hasOwn(scoreScales, size) ? size as keyof typeof scoreScales : "normal"
  }

  #ui: Ui
  #session: ScoreSession
  #focusListeners: AbortController | null = null
  #focusCheck: ReturnType<typeof setTimeout> | undefined
  #importRequest = 0
  #observer = new MutationObserver(() => this.#sync())
  #languageObserver = new MutationObserver(() => this.#refreshLanguage())

  #refreshLanguage() {
    this.#session.view.placeGutter()
    this.#session.points.labelPoints()
    this.#session.completion.refreshCompletion()
    this.#updateControls()
    this.dispatchEvent(new Event("optionschange", { bubbles: true }))
  }

  constructor() {
    super()
    const element = this
    const permissions = this.#permissions
    const shadow = this.attachShadow({ mode: "open" })
    shadow.innerHTML = template
    this.#ui = Object.fromEntries(Array.from(shadow.querySelectorAll("[id]"), node => [node.id, node])) as unknown as Ui
    const ui = this.#ui
    this.#session = new ScoreSession(this, ui, {
      get type() { return element.type },
      get size() { return element.size },
      get editing() { return permissions.editing },
      updateControls: () => this.#updateControls(),
      sync: keepSelection => this.#sync(keepSelection),
      writeScore: (text, keepSelection) => this.#writeScore(text, keepSelection),
      dataBlock: () => this.#dataBlock(),
      labelsBlock: () => this.#labelsBlock(),
    })
    this.addEventListener("focusin", () => this.#updateFocus())
    this.addEventListener("focusout", () => {
      // Let focus settle when the popover closes or a score control is rebuilt.
      clearTimeout(this.#focusCheck)
      this.#focusCheck = setTimeout(() => this.#updateFocus(), 0)
    })
    ui.surface.addEventListener("click", event => {
      if (!this.#session.editing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target as Node | null
      if (target === ui.surface || target === ui.sheet || ui.score.contains(target)) {
        ui.surface.focus({ preventScroll: true })
      }
    })
    ui.play.addEventListener("click", () => this.#session.state.api?.playPause())
    ui.stop.addEventListener("click", () => this.#session.state.api?.stop())
    ui.targets.addEventListener("click", event => this.#session.edit.activate(event))
    ui.targets.addEventListener("dblclick", event => this.#session.edit.activate(event))
    ui.targets.addEventListener("pointerdown", event => this.#session.drag.startDrag(event))
    ui.targets.addEventListener("pointermove", event => this.#session.drag.moveDrag(event))
    ui.targets.addEventListener("pointerup", event => this.#session.drag.endDrag(event))
    ui.targets.addEventListener("pointercancel", event => this.#session.drag.endDrag(event))
    ui.targets.addEventListener("lostpointercapture", event => this.#session.drag.endDrag(event))
    ui.points.addEventListener("keydown", event => this.#session.edit.noteKey(event))
    for (const type of ["copy", "cut", "paste"]) {
      ui.points.addEventListener(type, event => {
        if (event.target === ui.tempo || event.target === ui.scoreText) event.stopPropagation()
        else this.#session.edit.clipboard(event as ClipboardEvent)
      })
    }
    ui.completionInput.addEventListener("input", () => this.#session.completion.refreshCompletion())
    ui.scoreText.addEventListener("input", () => this.#session.text.showTextDraft())
    ui.completionInput.addEventListener("keydown", event => this.#session.completion.completionKey(event))
    ui.completionList.addEventListener("pointerdown", event => {
      if ((event.target as Element).closest("[role=option]")) event.preventDefault()
    })
    ui.completionList.addEventListener("click", event => {
      const option = (event.target as Element).closest<HTMLElement>("[role=option]")
      if (option) this.#session.completion.acceptCompletion(Number(option.dataset.index))
    })
    ui.completion.addEventListener("focusout", event => {
      if (event.relatedTarget && !ui.completion.contains(event.relatedTarget as Node)) this.#session.completion.closeCompletion()
    })
    for (const type of ["copy", "cut", "paste"]) {
      ui.completionInput.addEventListener(type, event => {
        event.stopPropagation()
        if (this.#session.state.completion?.point.address && !ui.completionInput.value) this.#session.edit.clipboard(event as ClipboardEvent)
      })
    }
    const closers: [HTMLInputElement, (save: boolean, focus?: boolean) => void][] = [
      [ui.tempo, (save, focus) => this.#session.text.closeTempo(save, focus)],
      [ui.scoreText, (save, focus) => this.#session.text.closeText(save, focus)],
    ]
    for (const [input, close] of closers) {
      input.addEventListener("blur", () => close(true))
      input.addEventListener("keydown", event => {
        event.stopPropagation()
        if (event.isComposing) return
        if (event.key === "Tab" && input === ui.tempo) {
          close(true)
          return
        }
        if (event.key === "Tab" && input === ui.scoreText && this.#session.state.textEdit?.point.kind === "lyric") {
          this.#session.completion.tabLyric(event)
          return
        }
        if (event.key !== "Escape" && event.key !== "Enter") return
        event.preventDefault()
        close(event.key === "Enter", true)
      })
    }
  }

  connectedCallback() {
    this.#permissions.connect()
    this.#focusListeners = new AbortController()
    const { signal } = this.#focusListeners
    const view = this.ownerDocument.defaultView
    view?.addEventListener("focus", () => this.#updateFocus(), { signal })
    view?.addEventListener("blur", () => this.#updateFocus(false), { signal })
    this.#observer.observe(this, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["slot", "type", "src", "data-music-score", "data-musical-score", "data-music-score-labels"],
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
    this.#permissions.disconnect()
    this.#session.view.destroyApi()
    this.#ui.sheet.hidden = true
    this.#session.state.score = null
    this.#session.state.snapshot = undefined
    this.#session.state.labelsSnapshot = undefined
    this.#session.state.selection = null
    this.#session.state.passage = null
    this.#session.points.clearPoints()
    this.#session.state.notice = null
  }

  attributeChangedCallback(name: string) {
    if (!this.isConnected) return
    if (name === "type") {
      this.#sync()
      return
    }
    if (name === "size") {
      this.#session.view.resizeNotation()
      return
    }
    if (name === "lang") {
      this.#refreshLanguage()
    } else {
      this.#session.view.placeGutter()
      if (this.#session.editing) this.#session.points.drawPoints()
      else {
        this.#session.drag.finishDrag()
        this.#session.append.releaseAppendDrag()
        this.#session.append.closeAppendPreview()
        this.#session.state.selection = null
        this.#session.state.passage = null
        this.#session.points.clearPoints()
      }
    }
    this.#updateControls()
  }

  async importMusicXML([file]: File[]) {
    if (!file || !this.isConnected || !this.#session.editing) return
    const request = ++this.#importRequest
    const block = this.#dataBlock()
    const original = block?.textContent
    const canCommit = () => this.isConnected && this.#session.editing && request === this.#importRequest
      && block === this.#dataBlock() && original === block?.textContent

    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("MusicXML exceeds 8 MiB")
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!canCommit()) return
      const text = serializeScore(importMusicXML(bytes))
      this.#writeScore(text)
    } catch {
      if (!canCommit()) return
      this.#session.state.notice = "importError"
      this.#updateControls()
      throw new Error(messages(this).importError)
    }
  }

  #updateFocus(focused = this.matches(":focus-within") && this.ownerDocument.hasFocus()) {
    const { sheet } = this.#ui
    const wasFocused = sheet.classList.contains("focused")
    sheet.classList.toggle("focused", focused)
    if (focused || !wasFocused) return
    this.#session.text.closeText(true)
    this.#session.completion.closeCompletion()
    this.#session.state.restoreFocus = false
    this.#session.state.completionNext = null
    this.#session.drag.finishDrag()
    this.#session.append.releaseAppendDrag()
    this.#session.append.closeAppendPreview()
    this.#session.state.selection = null
    this.#session.state.passage = null
    this.#session.points.markSelection()
  }

  #dataBlock(): Element | undefined {
    return Array.from(this.children).find(child => child.matches(dataSelector))
  }

  #labelsBlock(): Element | undefined {
    return Array.from(this.children).find(child => child.matches(labelsSelector))
  }

  #writeScore(text: string, keepSelection = false) {
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
    // Once an author changes a localized example, persist its visible labels
    // in the score itself and discard the insertion-only translation seed.
    this.#labelsBlock()?.remove()
    this.#sync(keepSelection)
  }

  #sync(keepSelection = false) {
    const text = this.#dataBlock()?.textContent ?? null
    const labelsText = this.#labelsBlock()?.textContent ?? null
    const type = this.type
    if (text === this.#session.state.snapshot && labelsText === this.#session.state.labelsSnapshot && type === this.#session.state.scoreType) {
      this.#updateControls()
      return
    }
    this.#session.state.snapshot = text
    this.#session.state.labelsSnapshot = labelsText
    this.#session.state.scoreType = type
    if (!keepSelection) {
      this.#session.state.selection = null
      this.#session.state.passage = null
      this.#session.state.restoreFocus = false
      this.#session.state.completionNext = null
    }
    this.#session.state.score = null
    this.#session.points.clearPoints()
    this.#session.state.notice = null
    try {
      const score = text === null ? blankScore(type) : readScore(text)
      localizeLabels(score, labelsText)
      if (applyScoreType(score, type)) this.#session.state.notice = type as Notice
      this.#session.state.score = score
    } catch {
      this.#session.state.notice = "readError"
    }
    this.#ui.sheet.hidden = !this.#session.state.score
    if (this.#session.state.score) void this.#renderScore(this.#session.state.score)
    else this.#session.view.destroyApi()
    this.#updateControls()
  }

  async #renderScore(score: model.Score) {
    try {
      if (!await this.#session.view.ensureApi(score)) return
      this.#session.state.api!.stop()
      this.#session.state.api!.renderScore(score, score.tracks.map(track => track.index))
    } catch {
      if (this.#session.state.score !== score) return
      this.#session.view.destroyApi()
      this.#session.state.notice = "renderError"
    }
    this.#updateControls()
  }

  #updateControls() {
    const ui = this.#ui
    const t = messages(this)
    const ready = Boolean(this.#session.state.score && this.#session.state.api?.isReadyForPlayback)
    const playing = this.#session.playing
    if (playing) {
      this.#session.state.completionNext = null
      this.#session.completion.closeCompletion()
      this.#session.text.closeText(false)
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
    ui.notice.hidden = !this.#session.state.notice
    ui.notice.textContent = this.#session.state.notice ? t[this.#session.state.notice] : ""
  }
}
