import { AlphaTabApi, Environment, FontFileFormat, NotationElement, PlayerMode, ScrollMode, Settings } from "../assets/alphatab-core"
import type { model, rendering } from "../assets/alphatab-core"
import { scoreBraces, trackLabelPositions } from "../model/score-points"
import { scoreScales } from "../model/score-notation"
import { language } from "../model/messages"
import { rightGutter, transportButtonHeight, transportGap, transportWidth } from "./score-shared"
import type { ScoreSession } from "./score-session"

const asset = (path: string) => new URL("../vendor/" + path, import.meta.url).href

// Local package requests in WebWriter's editor frame are relayed by the window.
// Read alphaTab's standalone build there so workers need no nested imports.
Environment.initializeMain(
  (settings, name) => new Worker(settings.core.scriptFile!, { name }),
  (context, settings) => context.audioWorklet.addModule(settings.core.scriptFile!),
)
let workerSource: Promise<Blob> | null | undefined
function loadWorkerSource(): Promise<Blob> {
  workerSource ??= fetch(asset("alphaTab.min.js")).then(response => {
    if (!response.ok) throw new Error("Could not load alphaTab worker")
    return response.blob()
  }).catch(error => {
    workerSource = null
    throw error
  })
  return workerSource
}

export class ScoreView {
  constructor(readonly c: ScoreSession) {}

  get el() { return this.c.element }
  get ui() { return this.c.ui }
  get state() { return this.c.state }
  workerURL: string | null = null

  createScoreApi(container: HTMLElement, playerMode: PlayerMode): AlphaTabApi {
    const settings = new Settings()
    settings.core.scriptFile = this.workerURL!
    settings.core.includeNoteBounds = true
    settings.core.enableLazyLoading = false
    settings.core.smuflFontSources = new Map([[FontFileFormat.Woff2, asset("font/Bravura.woff2")]])
    // The shared gutter holds the controls and track names without indenting any system.
    settings.display.padding = [transportGap + transportWidth + 4, 0, rightGutter, 0]
    settings.display.scale = scoreScales[this.c.host.size]
    settings.notation.elements.set(NotationElement.TrackNames, false)
    settings.player.playerMode = playerMode
    if (playerMode === PlayerMode.EnabledSynthesizer) {
      settings.player.enablePlaybackRangeSelection = false
      settings.player.soundFont = asset("soundfont/sonivox.sf2")
      settings.player.scrollMode = ScrollMode.Off
    }
    const api = new AlphaTabApi(container, settings)
    container.style.setProperty("--music-font-size", settings.display.resources.engravingSettings.musicFontSize + "px")
    const fontClass = Array.from((api.canvasElement as unknown as { element: HTMLElement }).element.classList).find(name => /^at\d*$/.test(name))
    container.style.setProperty("--music-font", "alphaTab" + (fontClass?.slice(2) ?? ""))
    return api
  }

  async ensureApi(score: model.Score): Promise<boolean> {
    if (this.state.api) return true
    const source = await loadWorkerSource()
    if (!this.el.isConnected || this.state.score !== score) return false
    this.workerURL = URL.createObjectURL(source)
    this.createApi()
    return true
  }

  createApi() {
    const api = this.createScoreApi(this.ui.score, PlayerMode.EnabledSynthesizer)
    this.state.api = api
    let playingSystem: rendering.StaffSystemBounds | null = null
    const reducedMotion = this.el.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)")
    api.postRenderFinished.on(() => {
      playingSystem = null
      this.placeGutter()
      if (this.state.drag?.kind === "pitch") this.c.drag.updateDragPreview()
      else if (!this.state.drag) this.c.points.drawPoints()
    })
    api.playerReady.on(() => this.c.host.updateControls())
    api.playerStateChanged.on(() => {
      playingSystem = null
      this.c.host.updateControls()
    })
    api.playedBeatChanged.on(beat => {
      if (this.state.api !== api || !this.c.playing) return
      const system = api.boundsLookup?.findMasterBarByIndex(beat.voice.bar.index)?.staffSystemBounds
      if (!system || system === playingSystem) return
      const behavior = playingSystem && !reducedMotion?.matches ? "smooth" : "instant"
      playingSystem = system
      this.ui.score.querySelector(".at-cursor-bar")?.scrollIntoView({
        block: "nearest", inline: "nearest", behavior,
      })
    })
    api.error.on(() => {
      this.state.notice = "renderError"
      this.c.host.updateControls()
    })
  }

  destroyApi() {
    this.state.appendApi?.destroy()
    this.state.appendApi = null
    this.state.api?.destroy()
    this.state.api = null
    this.ui.transport.hidden = true
    this.ui.trackLabels.replaceChildren()
    this.ui.rowMinimum.textContent = ""
    if (this.workerURL) URL.revokeObjectURL(this.workerURL)
    this.workerURL = null
  }

  resizeNotation() {
    const scale = scoreScales[this.c.host.size]
    if (!this.state.score || !this.state.api || this.state.api.settings.display.scale === scale) return
    this.c.points.clearPoints()
    for (const api of [this.state.api, this.state.appendApi]) {
      if (!api) continue
      api.settings.display.scale = scale
      api.updateSettings()
    }
    this.state.api.render()
  }

  // Headings are single lines centred on the sheet. When one is wider than the room beside the transport
  // buttons, it gets a smaller font so that it is not cut off at narrow widths.
  fitHeadings() {
    const room = this.ui.sheet.clientWidth - 2 * (transportWidth + transportGap)
    if (room <= 0) return
    for (const text of this.ui.score.querySelectorAll<SVGTextElement>("svg :is(.ww-heading-title, .ww-heading-subtitle) text")) {
      const width = text.getComputedTextLength?.() ?? 0
      if (width <= room) continue
      const size = parseFloat(getComputedStyle(text).fontSize)
      if (size > 0) text.style.fontSize = Math.max(10, size * room / width) + "px"
    }
  }

  placeGutter() {
    const systems = this.state.api?.boundsLookup?.staffSystems ?? []
    const system = systems[0]
    const firstStaff = system?.bars[0]?.bars[0]
    const { rowMinimum, trackLabels, transport } = this.ui
    if (!firstStaff || firstStaff.bar.staff.track.score !== this.state.score) return
    const { resources, scale } = this.state.api!.settings.display
    trackLabels.style.font = resources.elementFonts.get(NotationElement.TrackNames)!.toCssString(scale)
    trackLabels.style.color = resources.barSeparatorColor.rgba
    const { thinBarlineThickness, thinThickBarlineSeparation, thickBarlineThickness } = resources.engravingSettings
    this.state.endBarSpan = (thinBarlineThickness + thinThickBarlineSeparation + thickBarlineThickness) * scale
    const minimum = `:host { --score-row-height: ${Math.ceil(system!.realBounds.h)}px; }`
    if (rowMinimum.textContent !== minimum) rowMinimum.textContent = minimum
    const { y, h } = firstStaff.realBounds
    transport.style.marginTop = this.state.score!.title?.trim() ? "" : Math.max(4, y + h / 2 - transportButtonHeight) + "px"
    transport.hidden = false
    this.fitHeadings()
    const braces = scoreBraces(this.ui.sheet, this.ui.score)
    const labels = trackLabelPositions(this.state.score!, systems, braces, this.c.editing, language(this.el))
    trackLabels.replaceChildren(...labels.map(({ name, trackIndex, x, y }) => {
      const label = this.el.ownerDocument.createElement("span")
      label.className = "track-label"
      label.dataset.track = String(trackIndex)
      label.textContent = name
      label.style.left = x - 4 + "px"
      label.style.top = y + "px"
      return label
    }))
  }
}
