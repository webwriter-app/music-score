import type { model } from "../assets/alphatab-core"
import { findBeat, sameAddress } from "../model/score-model"
import type { BeatAddress } from "../model/score-model"
import { staffStep } from "../model/score-points"
import type { ScorePoint } from "../model/score-points"
import { sameVoice } from "../model/score-passage"
import { language, messages } from "../model/messages"
import { completionPreview, entryRhythm, rhythmShortcut, scoreCompletions } from "./score-completion"
import type { Rhythm } from "./score-completion"
import type { CompletionState } from "./score-shared"
import type { ScoreSession } from "./score-session"

export class ScoreEntry {
  constructor(readonly c: ScoreSession) {}

  get el() { return this.c.element }
  get ui() { return this.c.ui }
  get state() { return this.c.state }

  openCompletion(point: ScorePoint, button: HTMLElement, { group, step, duration, dots }: { group?: string, step?: number, duration?: model.Duration, dots?: number } = {}) {
    this.closeCompletion()
    if (!this.state.score || !button.isConnected || !this.c.editing || this.c.playing) return
    const { completion, completionInput, score } = this.ui
    if (step === undefined && point.kind === "note") step = staffStep(point.staff!, point.rect.y + point.rect.h / 2)
    const passage = group === "passage" ? this.state.passage : null
    const state: CompletionState = { point, button, group, passage, step, duration, dots, entries: [], index: -1, listeners: new AbortController() }
    this.state.completion = state
    completionInput.value = ""
    this.refreshCompletion()
    if (!state.entries.length) {
      this.state.completion = null
      return
    }
    completionInput.setAttribute("aria-expanded", "true")
    completion.style.setProperty("--music-font", score.style.getPropertyValue("--music-font"))
    completion.showPopover()
    this.positionCompletion()
    const { ownerDocument: document } = this.el
    const { signal } = state.listeners
    document.addEventListener("pointerdown", event => {
      if (!event.composedPath().includes(completion) && !event.composedPath().includes(button)) this.closeCompletion()
    }, { capture: true, signal })
    document.addEventListener("scroll", event => {
      if (event.target !== this.ui.completionList) this.positionCompletion()
    }, { capture: true, signal })
    document.defaultView!.addEventListener("resize", () => this.positionCompletion(), { signal })
    completionInput.focus({ preventScroll: true })
  }

  positionCompletion() {
    const state = this.state.completion
    if (!state) return
    const { completion, completionList, completionInput } = this.ui
    const viewport = this.el.ownerDocument.documentElement
    const anchor = state.button.getBoundingClientRect()
    const gap = 6
    if (anchor.bottom < 0 || anchor.top > viewport.clientHeight) {
      this.closeCompletion()
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

  refreshCompletion() {
    const state = this.state.completion
    if (!state) return
    const { completionInput, completionList, completionEmpty, entryDuration: badge } = this.ui
    const t = messages(this.el)
    const search = state.point.kind === "instrument" ? t.searchInstruments : t.searchScore
    completionInput.placeholder = search
    completionInput.setAttribute("aria-label", search)
    completionList.setAttribute("aria-label", t.scoreChoices)
    const beat = state.point.address && findBeat(this.state.score, state.point.address)
    const editingKey = state.keyMenu || /^key(?: |$)/i.test(completionInput.value.trim())
    const rhythm = !editingKey && state.point.kind !== "dynamics" && state.group !== "passage"
      && entryRhythm(beat, state.duration, state.dots)
    badge.hidden = !rhythm
    if (!badge.hidden) {
      badge.textContent = rhythmShortcut(rhythm as Rhythm)
      badge.setAttribute("aria-label", t.duration + " " + badge.textContent)
      completionInput.setAttribute("aria-describedby", badge.id)
    } else completionInput.removeAttribute("aria-describedby")
    state.entries = scoreCompletions(this.state.score!, state, completionInput.value, t, language(this.el))
    completionList.replaceChildren(...state.entries.map((entry, index) => {
      const document = this.el.ownerDocument
      const row = document.createElement("li")
      row.id = "score-choice-" + index
      row.dataset.index = String(index)
      row.setAttribute("role", "option")
      if (entry.current) row.setAttribute("aria-current", "true")
      const label = document.createElement("span")
      label.textContent = entry.label
      const key = document.createElement("kbd")
      key.textContent = entry.shortcut ?? ""
      row.append(completionPreview(document, entry), label, key)
      return row
    }))
    completionEmpty.hidden = state.entries.length > 0
    completionEmpty.textContent = t.noScoreChoices
    this.selectCompletion(state.entries.length ? 0 : -1)
    completionList.scrollTop = 0
    if (this.ui.completion.matches(":popover-open")) this.positionCompletion()
  }

  selectCompletion(index: number, scroll = false) {
    const { completionInput, completionList } = this.ui
    this.state.completion!.index = index
    const selected = completionList.children[index] as HTMLElement | undefined
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

  completionKey(event: KeyboardEvent) {
    const state = this.state.completion
    if (!state) return
    event.stopPropagation()
    if (event.isComposing) return
    const { key } = event
    if (key === "Escape") {
      event.preventDefault()
      this.closeCompletion(true)
    } else if (key === "Tab" && state.point.address) {
      const address = state.group === "passage" && this.state.passage
        ? (event.shiftKey ? this.state.passage.first : this.state.passage.last) : state.point.address
      this.tabPosition(event, address, state)
    } else if (key === "Delete" && !event.repeat && !(event.target as HTMLInputElement).value && state.point.address) {
      const selection = this.c.points.selectedPassage()
      if (selection) {
        event.preventDefault()
        this.c.edit.editSelection({ selection })
      }
    } else if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault()
      const length = state.entries.length
      if (length) this.selectCompletion((state.index + (key === "ArrowUp" ? -1 : 1) + length) % length, true)
    } else if (key === "Enter") {
      event.preventDefault()
      this.acceptCompletion(state.index)
    }
  }

  acceptCompletion(index: number) {
    const state = this.state.completion
    const choice = state?.entries[index]
    if (!choice || this.c.playing) return
    const input = this.ui.completionInput
    const value = input.value
    if (choice.openKey || choice.openGrace || choice.openMarks) {
      state.keyMenu = choice.openKey
      state.graceMenu = choice.openGrace
      state.marksMenu = choice.openMarks
      input.value = ""
      this.refreshCompletion()
      return
    }
    if (choice.setEntryDuration) {
      state.duration = choice.duration
      state.dots = choice.dots
      input.value = ""
      this.refreshCompletion()
      input.focus({ preventScroll: true })
      return
    }
    this.closeCompletion(true)
    if (choice.id === "clear") {
      if (this.state.passage) this.c.edit.editSelection({ selection: this.state.passage })
      return
    }
    const point = state.point
    this.state.restoreFocus = point
    this.c.edit.commit((score: model.Score) => {
      const entry = scoreCompletions(score, state, value, messages(this.el), language(this.el)).find(entry => entry.id === choice.id)
      if (!entry) return false
      const result = entry.apply?.()
      if (entry.advance) {
        const address = point.address!.slice() as BeatAddress
        const voice = findBeat(score, address)!.voice
        address[4]++
        if (address[4] >= voice.beats.length) {
          address[2]++
          address[4] = 0
        }
        const rhythm = entry.explicit || state.duration === undefined ? entry : state
        this.state.completionNext = { address, step: state.step, duration: rhythm.duration, dots: rhythm.dots }
      }
      if (Array.isArray(result)) this.state.restoreFocus = { address: result }
      if (entry.clearsNote) this.state.restoreFocus = { address: point.address!.slice(0, 5) }
      return result
    }, choice.clearsNote ? null : this.state.selection)
    if (this.state.completionNext && this.state.targets.has(state.button)) this.resumeEditor()
  }

  resumeEditor() {
    const next = this.state.completionNext
    if (!next) return
    this.state.completionNext = null
    if (!this.el.matches(":focus-within")) return
    if (next.kind === "lyric") {
      for (const [button, point] of this.state.targets) {
        if (point.kind !== "lyric" || point.printed || !sameAddress(point.address, next.address)) continue
        button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
        this.c.text.openText(point, button)
        break
      }
      return
    }
    if (!entryRhythm(findBeat(this.state.score, next.address), next.duration, next.dots)) return
    for (const [button, point] of this.state.targets) {
      if (!point.beatBounds || !sameAddress(point.address, next.address)) continue
      this.c.points.selectPoint(point)
      this.openCompletion(point, button, next)
      break
    }
  }

  closeCompletion(restoreFocus = false) {
    const state = this.state.completion
    if (!state) return
    this.state.completion = null
    state.listeners.abort()
    const { completion, completionInput } = this.ui
    completion.hidePopover()
    completionInput.setAttribute("aria-expanded", "false")
    completionInput.removeAttribute("aria-activedescendant")
    if (restoreFocus && state.button.isConnected) state.button.focus({ preventScroll: true })
  }

  adjacentPoint(address: readonly number[], backwards: boolean, matches: (point: ScorePoint) => unknown): [HTMLElement, ScorePoint] | undefined {
    const direction = backwards ? -1 : 1
    const compare = (a: readonly number[], b: readonly number[]) => direction * (a[2] - b[2] || a[4] - b[4])
    let next: [HTMLElement, ScorePoint] | undefined
    for (const target of this.state.targets) {
      const point = target[1]
      if (!matches(point) || !sameVoice(point.address!, address) || compare(point.address!, address) <= 0) continue
      if (!next || compare(point.address!, next[1].address!) < 0) next = target
    }
    return next
  }

  tabPosition(event: KeyboardEvent, address: readonly number[], state?: CompletionState) {
    if (event.altKey || event.ctrlKey || event.metaKey || !this.c.editing || this.c.playing) return
    const next = this.adjacentPoint(address, event.shiftKey, point => point.beatBounds)
    if (!next) {
      this.closeCompletion(true)
      return
    }
    const [, beat] = next
    const [button, point] = Array.from(this.state.targets).find(([, point]) =>
      point.kind === "note" && sameAddress(point.address!.slice(0, 5), beat.address)) ?? next
    event.preventDefault()
    event.stopPropagation()
    this.closeCompletion()
    button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
    button.focus({ preventScroll: true })
    this.c.points.selectPoint(point)
    this.openCompletion(point, button, {
      duration: state?.duration, dots: state?.dots, step: point.kind === "note" ? undefined : state?.step,
    })
  }

  tabLyric(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const next = this.adjacentPoint(this.state.textEdit!.point.address!, event.shiftKey,
      point => point.kind === "lyric" && !point.printed)
    if (!next) return
    event.preventDefault()
    this.moveLyricEditor(...next)
  }

  moveLyricEditor(button: HTMLElement, point: ScorePoint) {
    this.state.completionNext = { kind: "lyric", address: point.address! }
    this.c.text.closeText(true, true)
    if (this.state.targets.has(button)) this.resumeEditor()
  }
}
