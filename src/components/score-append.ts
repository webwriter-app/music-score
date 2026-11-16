import { PlayerMode } from "../assets/alphatab-core"
import type { rendering } from "../assets/alphatab-core"
import { appendMeasure, readScore, serializeScore, trimMeasures } from "../model/score-model"
import { appendButtonRect, endBarDragDelta, sheetPosition } from "../model/score-points"
import { maxAppendMeasures, position } from "./score-shared"
import type { AppendPreview, AppendPreviewArea } from "./score-shared"
import type { ScoreSession } from "./score-session"

export class ScoreAppend {
  constructor(readonly c: ScoreSession) {}

  get el() { return this.c.element }
  get ui() { return this.c.ui }
  get state() { return this.c.state }
  appendPreview: AppendPreview | null = null
  previewInk: SVGElement[] = []
  trimInk: SVGElement[] = []

  addMeasures(count = 1, restoreFocus = false) {
    this.state.restoreFocus = restoreFocus ? { kind: "append" } : false
    this.c.edit.commit(score => appendMeasure(score, count))
  }

  removeMeasures(count: number) {
    const remaining = this.state.score!.masterBars.length - count
    const selection = (this.state.selection?.[2] ?? -1) >= remaining ? null : this.state.selection
    this.c.edit.commit(score => {
      if (!trimMeasures(score, remaining)) return false
      if ((this.state.passage?.last[2] ?? -1) >= remaining) this.state.passage = null
      return true
    }, selection)
  }

  startAppendDrag(event: PointerEvent) {
    if (event.button !== 0 || this.state.appendDrag || this.state.drag || !this.c.editing) return
    const button = event.currentTarget as HTMLElement
    const start = sheetPosition(this.ui.sheet, event.clientX, event.clientY)
    this.state.appendDrag = { button, id: event.pointerId, start, count: 0, clickAdds: start.x >= this.state.targets.get(button)!.rect.x }
    button.setPointerCapture(event.pointerId)
  }

  moveAppendDrag(event: PointerEvent) {
    const drag = this.state.appendDrag
    if (!drag || drag.id !== event.pointerId || drag.released) return
    const { sheet } = this.ui
    const point = sheetPosition(sheet, event.clientX, event.clientY)
    if (!drag.point) {
      if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 4) return
      sheet.classList.add("resizing-end-bar")
    }
    drag.point = point
    this.updateEndBarDrag()
  }

  updateEndBarDrag(redraw = false) {
    const drag = this.state.appendDrag!
    const point = drag.point!
    const systems = this.state.api!.boundsLookup!.staffSystems
    const row = systems.at(-1)!
    const end = row.bars.at(-1)!.realBounds
    const forward = point.y >= row.realBounds.y
      && (point.x > end.x + end.w || point.y >= row.realBounds.y + row.realBounds.h)
    if (forward) this.prepareAppendPreview()
    drag.awaitingLayout = forward && this.appendPreview?.rendering
    const count = endBarDragDelta(point, systems, forward ? this.appendPreview?.areas : undefined)
    if (count === drag.count && !redraw) return
    this.clearEndBarInk()
    drag.count = count
    if (count < 0) this.showTrimPreview(this.state.score!.masterBars.length + count)
    else if (count > 0) this.showAppendPreview(count)
  }

  endAppendDrag(event: PointerEvent) {
    const drag = this.state.appendDrag
    if (!drag || drag.id !== event.pointerId || drag.released) return
    if (event.type === "pointerup" && drag.awaitingLayout) {
      drag.released = true
      return
    }
    this.finishAppendDrag(event.type === "pointerup")
  }

  finishAppendDrag(commit: boolean) {
    const drag = this.state.appendDrag!
    this.releaseAppendDrag()
    if (commit) {
      if (!drag.point && drag.clickAdds) this.addMeasures()
      else if (drag.count > 0) this.addMeasures(drag.count)
      else if (drag.count < 0) this.removeMeasures(-drag.count)
    }
    this.closeAppendPreview()
  }

  releaseAppendDrag() {
    const drag = this.state.appendDrag
    this.state.appendDrag = null
    this.ui.sheet.classList.remove("resizing-end-bar")
    if (drag?.button.hasPointerCapture(drag.id)) drag.button.releasePointerCapture(drag.id)
  }

  prepareAppendPreview() {
    if (this.appendPreview) return
    const score = readScore(serializeScore(this.state.score!))
    // Measure one stable projection. Each gesture reveals only the measures it has covered.
    if (!appendMeasure(score, maxAppendMeasures)) return
    if (!this.state.appendApi) {
      this.state.appendApi = this.c.view.createScoreApi(this.ui.appendScore, PlayerMode.Disabled)
      this.state.appendApi.postRenderFinished.on(() => this.measureAppendPreview())
      this.state.appendApi.error.on(() => {
        if (this.state.appendDrag) this.finishAppendDrag(false)
      })
    }
    this.appendPreview = { score, rendering: true }
    this.state.appendApi!.renderScore(score, score.tracks.map(track => track.index))
  }

  measureAppendPreview() {
    const preview = this.appendPreview
    const drag = this.state.appendDrag
    if (!preview || !drag) return
    const bounds = this.state.appendApi!.boundsLookup!
    const count = this.state.score!.masterBars.length
    const last = bounds?.findMasterBarByIndex(preview.score.masterBars.length - 1)
    if (last?.bars[0]?.bar.staff.track.score !== preview.score) return
    preview.rendering = false

    // Replace the final line with the renderer's layout. Start earlier if a bar wraps differently.
    const liveSystems = this.state.api!.boundsLookup!.staffSystems
    const projectedSystems = bounds.staffSystems
    const firstChanged = liveSystems.findIndex((system, index) =>
      system.bars.at(-1)!.index !== projectedSystems[index]?.bars.at(-1)!.index)
    const start = firstChanged < 0 ? liveSystems.length - 1 : firstChanged
    preview.replacementTop = liveSystems[start].realBounds.y
    const dy = preview.replacementTop - projectedSystems[start].realBounds.y
    preview.areas = projectedSystems.slice(start).map(({ realBounds: { y, h }, bars }) => {
      const added = bars.filter(bar => bar.index >= count)
      const edges = added.map(({ realBounds: bar }) => bar.x + bar.w)
      return { y, h, dy, bars, edges, fadeAt: added[0]?.realBounds.x }
    })
    this.updateEndBarDrag(true)
    if (drag.released) this.finishAppendDrag(true)
  }

  showAppendPreview(count: number) {
    const { sheet, score, appendScore } = this.ui
    const existing = this.state.score!.masterBars.length
    const endIndex = existing + count - 1
    const areas: (AppendPreviewArea & { right: number })[] = []
    let last: rendering.MasterBarBounds | undefined
    for (const area of this.appendPreview!.areas!) {
      if (area.bars[0].index > endIndex) break
      last = area.bars[Math.min(area.bars.length - 1, endIndex - area.bars[0].index)]
      const { x, w } = last.realBounds
      areas.push({ ...area, right: x + w })
    }
    sheet.style.minHeight = Math.ceil(Math.max(...areas.map(({ y, h, dy }) => y + h + dy))) + "px"
    for (const svg of appendScore.querySelectorAll<SVGSVGElement>(".at-surface-svg")) {
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
      this.previewInk.push(svg)
    }
    for (const svg of score.querySelectorAll(".at-surface-svg")) {
      const box = svg.getBoundingClientRect()
      const { y } = sheetPosition(sheet, box.left, (box.top + box.bottom) / 2)
      if (y >= this.appendPreview!.replacementTop!) svg.setAttribute("data-append-replaced", "")
    }
    const area = areas.at(-1)!
    const staff = last!.bars[0].realBounds
    position(this.state.appendDrag!.button, appendButtonRect(sheet.offsetWidth, { ...staff, y: staff.y + area.dy }))
  }

  clearAppendInk() {
    for (const svg of this.previewInk) {
      svg.removeAttribute("data-append-ghost")
      svg.style.clipPath = ""
      svg.style.maskImage = ""
      svg.style.transform = ""
    }
    this.previewInk = []
    for (const svg of this.ui.score.querySelectorAll("[data-append-replaced]")) svg.removeAttribute("data-append-replaced")
  }

  showTrimPreview(remaining: number) {
    const { sheet, score } = this.ui
    const bounds = this.state.api!.boundsLookup!
    const last = bounds.findMasterBarByIndex(remaining - 1)
    const firstRemoved = bounds.findMasterBarByIndex(remaining)
    if (!last || !firstRemoved) return
    const rows = bounds.staffSystems.slice(firstRemoved.staffSystemBounds!.index)
    const edge = last.realBounds.x + last.realBounds.w
    for (const svg of score.querySelectorAll<SVGSVGElement>(".at-surface-svg")) {
      const box = svg.getBoundingClientRect()
      const { x, y } = sheetPosition(sheet, box.left, (box.top + box.bottom) / 2)
      const row = rows.find(({ realBounds: bounds }) => y >= bounds.y && y < bounds.y + bounds.h)
      if (!row) continue
      if (row !== last.staffSystemBounds || x >= edge) {
        svg.setAttribute("data-trim-ghost", "row")
      } else {
        const right = sheetPosition(sheet, box.right, box.top).x
        if (right <= edge) continue
        const ghost = svg.cloneNode(true) as SVGSVGElement
        ghost.classList.remove("at-surface-svg")
        ghost.setAttribute("data-trim-ghost", "copy")
        ghost.setAttribute("aria-hidden", "true")
        ghost.style.clipPath = `inset(0 0 0 ${edge - x}px)`
        svg.after(ghost)
        this.trimInk.push(ghost)
        svg.style.clipPath = `inset(0 ${right - edge}px 0 0)`
        svg.setAttribute("data-trim-ghost", "suffix")
      }
      this.trimInk.push(svg)
    }
    if (this.trimInk.length) this.state.appendDrag!.button.setAttribute("data-trimming", "")
  }

  closeAppendPreview() {
    this.appendPreview = null
    this.clearEndBarInk()
  }

  clearEndBarInk() {
    this.clearAppendInk()
    for (const svg of this.trimInk) {
      if (svg.dataset.trimGhost === "copy") svg.remove()
      else {
        svg.style.clipPath = ""
        svg.removeAttribute("data-trim-ghost")
      }
    }
    this.trimInk = []
    this.ui.sheet.style.minHeight = ""
    const button = this.ui.targets.querySelector<HTMLElement>('[data-kind="append"]')
    if (button) {
      button.removeAttribute("data-trimming")
      position(button, this.state.targets.get(button)!.rect)
    }
  }
}
