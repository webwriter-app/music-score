import type { model } from "../assets/alphatab-core"
import { blankScore, changePitch, findBeat, findNote, localizeLabels, pitchAtStep, placeNote, sameAddress, readScore, serializeScore, writtenPitch } from "../model/score-model"
import type { BeatAddress, NoteAddress } from "../model/score-model"
import { sheetPosition, staffStep } from "../model/score-points"
import type { Rect, ScorePoint } from "../model/score-points"
import { copyPassage, editPassage, passageBetween, readPassage } from "../model/score-passage"
import type { PassageEdit } from "../model/score-passage"
import type { ScoreSession } from "./score-session"

const clipboardType = "application/x-webwriter-score-passage"

export class ScoreEditing {
  constructor(readonly c: ScoreSession) {}

  get el() { return this.c.element }
  get ui() { return this.c.ui }
  get state() { return this.c.state }

  currentScore() {
    if (!this.el.isConnected || !this.c.editing) return null
    const current = this.c.host.dataBlock()?.textContent ?? null
    const labelsText = this.c.host.labelsBlock()?.textContent ?? null
    if (current !== this.state.snapshot || labelsText !== this.state.labelsSnapshot || this.c.host.type !== this.state.scoreType) {
      this.c.host.sync()
      return null
    }
    const score = current === null ? blankScore(this.state.scoreType!) : readScore(current)
    localizeLabels(score, labelsText)
    return score
  }

  commit(change: (score: model.Score) => unknown, selection: NoteAddress | BeatAddress | null = this.state.selection) {
    const score = this.currentScore()
    if (!score) return
    const result = change(score)
    if (!result) {
      this.state.restoreFocus = false
      return
    }
    this.state.selection = (Array.isArray(result) ? result : selection) as NoteAddress | null
    if (this.state.selection) this.state.passage = null
    this.c.host.writeScore(serializeScore(score), true)
  }

  activate(event: MouseEvent) {
    const target = event.target as HTMLElement
    const point = this.state.targets.get(target)
    if (!point || this.state.drag || this.state.appendDrag || !this.c.editing) return
    if (event.type === "dblclick" && point.kind !== "insert") return
    if (["clef", "key", "meter", "tempo", "append"].includes(point.kind)) this.c.completion.closeCompletion()
    switch (point.kind) {
      case "note":
      case "beat":
        if (event.detail === 0) {
          this.c.points.selectPoint(point)
          this.c.completion.openCompletion(point, target)
        }
        break
      case "insert": {
        if (event.type === "click") {
          if (event.detail === 0) {
            this.c.points.selectPoint(point)
            this.c.completion.openCompletion(point, target)
          }
          break
        }
        const { rect, staff, address } = point as ScorePoint & { staff: Rect, address: BeatAddress }
        const { x, y } = sheetPosition(this.ui.sheet, event.clientX, event.clientY)
        this.commit(score => placeNote(findBeat(score, address), staffStep(staff, y), (x - rect.x) / rect.w))
        break
      }
      case "clef":
      case "key":
      case "meter":
      case "instrument":
        this.c.completion.openCompletion(point, target)
        break
      case "text":
      case "title":
      case "subtitle":
        this.c.text.openText(point, target)
        break
      case "lyric":
        if (this.state.textEdit?.point.kind === "lyric") {
          if (!sameAddress(this.state.textEdit.point.address, point.address)) this.c.completion.moveLyricEditor(target, point)
        } else this.c.text.openText(point, target)
        break
      case "dynamics":
        this.c.points.selectPoint(point)
        this.c.completion.openCompletion(point, target)
        break
      case "tempo":
        this.c.text.openTempo(point, target)
        break
      case "append":
        if (event.detail === 0) this.c.append.addMeasures(1, true)
        break
    }
  }

  clipboard(event: ClipboardEvent) {
    const selection = this.c.points.selectedPassage()
    const clipboard = event.clipboardData
    if (!selection || !clipboard || this.state.drag || this.state.appendDrag || !this.c.editing) return
    if (event.type === "paste") {
      const source = readPassage(clipboard.getData(clipboardType) || clipboard.getData("text/plain"))
      if (!source) return
      event.preventDefault()
      this.editSelection({ source, target: selection.first })
      return
    }
    const score = this.currentScore()
    const source = score && copyPassage(score, selection)
    if (!source) {
      event.preventDefault()
      return
    }
    const text = JSON.stringify(source)
    event.preventDefault()
    if (event.type === "cut" && !this.editSelection({ selection })) return
    clipboard.setData("text/plain", text)
    clipboard.setData(clipboardType, text)
  }

  movePitch(address: NoteAddress, step: number) {
    this.commit(score => {
      const note = findNote(score, address)
      return note && changePitch(note, pitchAtStep(note.beat, step) - writtenPitch(note))
    }, address)
  }

  noteKey(event: KeyboardEvent) {
    const button = event.target as HTMLElement
    const point = this.state.targets.get(button)
    if (!point?.address && button !== this.ui.targets) return
    if (this.state.drag) {
      if (event.key === "Escape") {
        event.preventDefault()
        this.c.drag.finishDrag()
      }
      return
    }
    if (event.key === "Tab" && point?.address) {
      this.c.completion.tabPosition(event, point.address)
    } else if (point?.pitchDrag && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const { staff, rect, address } = point as ScorePoint & { staff: Rect, address: NoteAddress }
      event.preventDefault()
      this.state.restoreFocus = true
      const step = staffStep(staff, rect.y + rect.h / 2) + (event.key === "ArrowUp" ? -1 : 1)
      this.movePitch(address, step)
    } else if (event.key === " " && point?.address) {
      event.preventDefault()
      if (point.kind === "text" || point.kind === "lyric") this.c.text.openText(point, button)
      else {
        this.c.points.selectPoint(point)
        this.c.completion.openCompletion(point, button)
      }
    } else if (event.key === "Escape") {
      this.state.selection = null
      this.state.passage = null
      this.c.points.markSelection()
    } else if (event.key === "Delete" || event.key === "Backspace") {
      const selection = this.c.points.selectedPassage() ?? (point?.kind === "note" ? {
        first: point.address!.slice(0, 5) as BeatAddress, last: point.address!.slice(0, 5) as BeatAddress, note: point.address![5],
      } : null)
      if (selection) {
        event.preventDefault()
        this.editSelection({ selection })
      }
    }
  }

  editSelection(options: PassageEdit): boolean {
    const score = this.currentScore()
    if (!score) return false
    const result = editPassage(score, options)
    if (!result) return false
    const first = options.selection?.first
    this.state.selection = null
    this.state.passage = result.passage ?? passageBetween(first!, first!)
    this.state.restoreFocus = true
    this.c.host.writeScore(result.text, true)
    return true
  }
}
