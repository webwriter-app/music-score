import { canChangePitch, changePitch, findNote, pitchAtStep, sameAddress, readScore, serializeScore, writtenPitch } from "../model/score-model"
import type { BeatAddress, NoteAddress } from "../model/score-model"
import { beatPointAt, sheetPosition, staffStep } from "../model/score-points"
import type { Rect, ScorePoint } from "../model/score-points"
import { inPassage, passageBetween, sameVoice } from "../model/score-passage"
import { position } from "./score-shared"
import type { ScoreSession } from "./score-session"

export class ScoreDrag {
  constructor(readonly c: ScoreSession) {}

  get el() { return this.c.element }
  get ui() { return this.c.ui }
  get state() { return this.c.state }

  startDrag(event: PointerEvent) {
    const button = event.target as HTMLElement
    const point = this.state.targets.get(button) as (ScorePoint & { address: BeatAddress | NoteAddress, staff: Rect }) | undefined
    if (event.button === 0 && point?.kind === "lyric" && this.state.textEdit?.point.kind === "lyric") {
      event.preventDefault()
      return
    }
    if (this.state.drag || this.state.appendDrag || !point || !["note", "beat", "insert"].includes(point.kind)
      || event.button !== 0 || !this.c.editing) return
    this.c.completion.closeCompletion()
    this.c.append.closeAppendPreview()
    const origin = point.address.slice(0, 5) as BeatAddress
    const prior = this.c.points.selectedPassage()
    const inside = prior && inPassage(origin, prior)
      && (prior.note === undefined || sameAddress(point.address, this.state.selection))
    const movable = inside && (this.state.selection || Array.from(this.state.targets.values()).some(candidate =>
      candidate.kind === "note" && inPassage(candidate.address!, prior)))
    const note = point.pitchDrag ? findNote(this.state.score, point.address as NoteAddress) ?? null : null
    const { sheet } = this.ui
    const stepHeight = (point.staff.h / 8) * sheet.getBoundingClientRect().height / sheet.offsetHeight
    const startStep = staffStep(point.staff, point.rect.y + point.rect.h / 2)
    const anchor = event.shiftKey && prior && sameVoice(prior.first, origin)
      ? prior.first : origin
    this.state.drag = {
      kind: "pending", point, origin, anchor, extend: event.shiftKey,
      priorNote: this.state.selection, priorPassage: this.state.passage,
      move: !event.shiftKey && movable ? prior : null,
      note, address: point.address, button, id: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      startStep, step: startStep, stepHeight, preview: null, previewShift: 0, rendering: false,
    }
    try { button.setPointerCapture(event.pointerId) } catch { /* the pointer is gone or synthetic */ }
    if (!inside && !event.shiftKey) this.c.points.selectPoint(point)
  }

  moveDrag(event: PointerEvent) {
    const drag = this.state.drag
    if (!drag || drag.id !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.kind === "pending") {
      if (Math.hypot(dx, dy) < 4) return
      if (!drag.extend && (!drag.move || drag.move.note !== undefined)) {
        if (Math.abs(dy) > Math.abs(dx) && drag.stepHeight > 0 && canChangePitch(drag.note, 0)) {
          drag.kind = "pitch"
          this.c.points.selectPoint(drag.point)
        }
      }
      if (drag.kind === "pending") drag.kind = drag.move ? "move" : "select"
    }
    if (drag.kind === "pitch") {
      drag.step = drag.startStep + Math.round(dy / drag.stepHeight)
      this.renderDragPreview()
      return
    }
    const sheet = this.ui.sheet
    const position = sheetPosition(sheet, event.clientX, event.clientY)
    const outside = position.x < 0 || position.x > sheet.offsetWidth || position.y < 0 || position.y > sheet.offsetHeight
    const target = drag.kind === "move" && outside ? null : beatPointAt(this.state.targets.values(), drag.origin, position)?.address
    if (sameAddress(target, drag.target)) return
    drag.target = target as BeatAddress | null | undefined
    if (drag.kind === "select" && target) {
      this.state.selection = null
      this.state.passage = passageBetween(drag.anchor, target as BeatAddress)
    }
    this.c.points.markSelection()
  }

  renderDragPreview() {
    const drag = this.state.drag!
    if (drag.rendering) return
    const { step, startStep } = drag
    const note = drag.note!
    const pitch = writtenPitch(note)
    const shift = step === startStep ? 0 : pitchAtStep(note.beat, step) - pitch
    const previewShift = canChangePitch(note, shift) ? shift : 0
    if (previewShift === drag.previewShift) return

    // Keep the document and the synth on the committed score. Only update the notation.
    drag.preview ??= readScore(serializeScore(this.state.score!))
    const previewNote = findNote(drag.preview, drag.address as NoteAddress)!
    changePitch(previewNote, pitch + previewShift - writtenPitch(previewNote))
    if (!previewShift) previewNote.accidentalMode = note.accidentalMode
    drag.previewShift = previewShift
    drag.rendering = true
    this.state.api!.renderer.renderScore(drag.preview, this.state.api!.tracks.map(track => track.index))
  }

  updateDragPreview() {
    const drag = this.state.drag!
    if (!drag.preview) return
    const note = findNote(drag.preview, drag.address as NoteAddress)!
    const bounds = this.state.api!.boundsLookup?.findBeat(note.beat)
    if (bounds?.beat !== note.beat) return
    const head = bounds.notes?.find(item => item.note === note)
    if (head) {
      position(drag.button, head.noteHeadBounds)
      this.c.points.markSelection(head)
    }
    drag.rendering = false
    this.renderDragPreview()
  }

  endDrag(event: PointerEvent) {
    const drag = this.state.drag
    if (!drag || drag.id !== event.pointerId) return
    this.finishDrag(event.type === "pointerup")
  }

  finishDrag(commit = false) {
    const drag = this.state.drag
    if (!drag) return
    this.state.drag = null
    if (drag.button.hasPointerCapture(drag.id)) drag.button.releasePointerCapture(drag.id)
    const score = this.state.score
    if (!commit) {
      this.state.selection = drag.priorNote
      this.state.passage = drag.priorPassage
    } else if (drag.kind === "pending") {
      if (drag.extend) {
        this.state.selection = null
        this.state.passage = passageBetween(drag.anchor, drag.origin)
      } else this.c.points.selectPoint(drag.point)
    } else if (drag.kind === "pitch" && drag.step !== drag.startStep) {
      this.c.edit.movePitch(drag.address as NoteAddress, drag.step)
    } else if (drag.kind === "move" && drag.target && !sameAddress(drag.origin, drag.target)) {
      this.c.edit.editSelection({ selection: drag.move, target: drag.target, grab: drag.origin })
    }
    if (drag.preview && score === this.state.score) {
      this.state.api!.renderer.renderScore(score!, this.state.api!.tracks.map(track => track.index))
    }
    this.c.points.markSelection()
    if (commit && (drag.kind === "pending" || drag.kind === "select")) {
      const range = this.state.passage && !sameAddress(this.state.passage.first, this.state.passage.last)
      const end = range ? Array.from(this.state.targets).find(([, point]) =>
        point.beatBounds && sameAddress(point.address, drag.target)) : undefined
      const y = drag.point.kind === "note" ? drag.point.rect.y + drag.point.rect.h / 2
        : sheetPosition(this.ui.sheet, drag.startX, drag.startY).y
      this.c.completion.openCompletion(end?.[1] ?? drag.point, end?.[0] ?? drag.button, {
        group: range ? "passage" : undefined, step: staffStep(drag.point.staff!, y),
      })
    }
  }
}
