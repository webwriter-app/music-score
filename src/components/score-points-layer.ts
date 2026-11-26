import type { rendering } from "../assets/alphatab-core"
import { findNote, sameAddress } from "../model/score-model"
import type { BeatAddress, NoteAddress } from "../model/score-model"
import { colorNote, endBarStrokes, scorePoints, trackLabelPoints } from "../model/score-points"
import type { ScorePoint } from "../model/score-points"
import { playbackInstrumentName } from "../model/score-instruments"
import { inPassage, passageBetween } from "../model/score-passage"
import { language, messages } from "../model/messages"
import type { Messages } from "../model/messages"
import { position } from "./score-shared"
import type { FocusTarget, PassageSelection } from "./score-shared"
import type { ScoreSession } from "./score-session"

export class ScorePointLayer {
  constructor(readonly c: ScoreSession) {}

  get el() { return this.c.element }
  get ui() { return this.c.ui }
  get state() { return this.c.state }
  ink: Element[] = []

  clearPoints() {
    const focused = this.el.shadowRoot!.activeElement
    const { targets, tempo, scoreText, completion } = this.ui
    this.state.drag = null
    this.c.text.closeTempo(false)
    this.c.text.closeText(false)
    this.c.completion.closeCompletion()
    this.c.append.releaseAppendDrag()
    this.c.append.closeAppendPreview()
    for (const glyph of this.ink) glyph.classList.remove("selected-ink")
    for (const stroke of this.ui.score.querySelectorAll("[data-end-barline]")) stroke.removeAttribute("data-end-barline")
    this.ink = []
    this.state.targets.clear()
    if (this.c.editing && (targets.contains(focused) || completion.contains(focused) || focused === tempo || focused === scoreText)) {
      targets.focus({ preventScroll: true })
    }
    targets.replaceChildren()
  }

  drawPoints() {
    const bounds = this.state.api?.boundsLookup
    if (this.state.drag || !this.c.editing || !bounds?.isFinished) return
    const firstBar = bounds.staffSystems[0]?.bars[0]?.bars[0]?.bar
    if (firstBar?.staff.track.score !== this.state.score) return
    const active = this.state.targets.get(this.el.shadowRoot!.activeElement as HTMLElement)
    this.clearPoints()
    const fragment = this.el.ownerDocument.createDocumentFragment()
    const { sheet, score, trackLabels } = this.ui
    const points = scorePoints(sheet, bounds, score).concat(trackLabelPoints(sheet, trackLabels.children as HTMLCollectionOf<HTMLElement>))
    for (const point of points) {
      const button = this.el.ownerDocument.createElement("button")
      button.type = "button"
      button.className = "point"
      button.dataset.kind = point.kind
      if (point.printed) button.tabIndex = -1
      button.toggleAttribute("data-heading-action", point.headingAction === true)
      button.toggleAttribute("data-pitch-drag", point.pitchDrag === true)
      if (point.kind === "append") {
        button.textContent = "+"
        button.style.setProperty("--end-bar-span", this.state.endBarSpan + "px")
        for (const stroke of endBarStrokes(this.ui.sheet, this.ui.score, point.rect, this.state.endBarSpan)) {
          stroke.setAttribute("data-end-barline", "")
        }
        button.addEventListener("pointerdown", event => this.c.append.startAppendDrag(event))
        button.addEventListener("pointermove", event => this.c.append.moveAppendDrag(event))
        for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
          button.addEventListener(type, event => this.c.append.endAppendDrag(event as PointerEvent))
        }
        button.addEventListener("keydown", event => {
          if (event.key !== "Escape" || !this.state.appendDrag) return
          event.preventDefault()
          this.c.append.releaseAppendDrag()
          this.c.append.closeAppendPreview()
        })
      }
      position(button, point.rect)
      this.state.targets.set(button, point)
      fragment.append(button)
    }
    this.ui.targets.replaceChildren(fragment)
    this.labelPoints()
    const focus: FocusTarget | false | undefined = this.state.restoreFocus === true ? { address: this.state.selection ?? this.state.passage?.first } : this.state.restoreFocus || active
    if (this.el.matches(":focus-within") && (focus?.address || focus?.kind)) {
      for (const [button, point] of this.state.targets) {
        if ((!focus.kind || point.kind === focus.kind) && sameAddress(point.address, focus.address)
          && (focus.measure === undefined || point.measure === focus.measure)
          && (focus.trackIndex === undefined || point.trackIndex === focus.trackIndex)
          && (!focus.bar || sameAddress(point.bar, focus.bar))) {
          button.focus({ preventScroll: true })
          break
        }
      }
    }
    this.state.restoreFocus = false
    this.c.completion.resumeEditor()
  }

  labelPoints() {
    const t = messages(this.el)
    const kind = this.state.textEdit?.point.kind
    if (kind) this.c.text.labelTextInput(kind, t)
    for (const [button, point] of this.state.targets) {
      const label = point.kind === "instrument" ? this.instrumentLabel(point.trackIndex!, t)
        : point.headingAction ? this.headingActionLabel(point.kind, t)
        : point.kind === "note" && !point.pitchDrag ? t.selectNote : t[point.kind]
      if (point.headingAction) button.textContent = label
      button.title = point.kind === "append" ? t.appendDrag : label
      button.setAttribute("aria-label", label)
    }
    this.markSelection()
  }

  instrumentLabel(trackIndex: number, t: Messages): string {
    const track = this.state.score!.tracks[trackIndex]
    const part = track.name ? t.instrumentFor.replace("{part}", track.name) : t.instrument
    return part + " (" + playbackInstrumentName(track, language(this.el)) + ")"
  }

  headingActionLabel(kind: string, t: Messages): string {
    if (kind === "title") return this.state.score!.title ? t.title : t.addTitle
    return this.state.score!.subTitle ? t.subtitle : t.addSubtitle
  }

  markSelection(previewHead?: rendering.NoteBounds) {
    const beats = new Set<number>()
    const { annotation, first } = this.state.passage ?? {}
    const passage = annotation ? null : this.state.passage
    let selected: ScorePoint | undefined
    for (const [button, point] of this.state.targets) {
      if (point.kind === "note") {
        const active = sameAddress(point.address, this.state.selection)
        const inRange = Boolean(passage && inPassage(point.address!, passage))
        button.setAttribute("aria-pressed", String(active || inRange))
        button.toggleAttribute("data-move", inRange)
        if (active) selected = point
      } else if (point.beatBounds) {
        const active = Boolean(passage && inPassage(point.address!, passage))
        button.setAttribute("aria-pressed", String(active))
        button.toggleAttribute("data-selected", active)
        button.toggleAttribute("data-move", active)
        button.toggleAttribute("data-drop", this.state.drag?.kind === "move" && sameAddress(point.address, this.state.drag.target))
        if (active) beats.add(point.beatBounds.beat.id)
      } else if (point.kind === "dynamics") {
        const active = point.kind === annotation && sameAddress(point.address, first)
        button.setAttribute("aria-pressed", String(active))
        button.toggleAttribute("data-selected", active && !point.printed)
      }
    }
    const note = selected && findNote(this.state.score, selected.address as NoteAddress)
    const { sheet, score } = this.ui
    for (const glyph of this.ink) glyph.classList.remove("selected-ink")
    for (const beat of beats) {
      for (const group of score.querySelectorAll(`svg g.b${beat}`)) group.classList.add("selected-ink")
    }
    if (note) {
      const groups = score.querySelectorAll(`svg g.b${previewHead?.note.beat.id ?? note.beat.id}`)
      colorNote(sheet, groups, previewHead?.noteHeadBounds ?? selected!.rect)
    }
    this.ink = Array.from(score.querySelectorAll(".selected-ink"))
  }

  selectPoint(point: ScorePoint) {
    const address = point.address!
    this.state.selection = point.kind === "note" ? address as NoteAddress : null
    this.state.passage = this.state.selection ? null : passageBetween(address as BeatAddress, address as BeatAddress)
    if (point.kind === "dynamics") this.state.passage!.annotation = point.kind
    this.markSelection()
  }

  selectedPassage(): PassageSelection | null {
    if (!this.state.selection) return this.state.passage?.annotation ? null : this.state.passage
    const first = this.state.selection.slice(0, 5) as BeatAddress
    return { first, last: first, note: this.state.selection[5] }
  }
}
