import { NotationElement } from "../assets/alphatab-core"
import { findBeat, sameAddress, setHeading, setLyric, setScoreText, setTempo } from "../model/score-model"
import { sheetPosition } from "../model/score-points"
import type { ScorePoint } from "../model/score-points"
import { messages } from "../model/messages"
import type { Messages } from "../model/messages"
import { position } from "./score-shared"
import type { TempoPoint } from "./score-shared"
import type { ScoreSession } from "./score-session"

const headingFields: Record<string, "title" | "subTitle"> = { title: "title", subtitle: "subTitle" }
const textFonts: Record<string, NotationElement> = {
  text: NotationElement.EffectText, lyric: NotationElement.EffectLyrics,
  title: NotationElement.ScoreTitle, subtitle: NotationElement.ScoreSubTitle,
}

export class ScoreText {
  constructor(readonly c: ScoreSession) {}

  get el() { return this.c.element }
  get ui() { return this.c.ui }
  get state() { return this.c.state }

  labelTextInput(kind: string, t: Messages = messages(this.el)) {
    const input = this.ui.scoreText
    input.setAttribute("aria-label", t[kind])
    input.placeholder = kind === "lyric" ? t.addLyric : kind === "title" ? t.addTitle
      : kind === "subtitle" ? t.addSubtitle : t.addText
  }

  openText(point: ScorePoint, button: HTMLElement) {
    if (this.state.textEdit || this.c.playing) return
    const { kind } = point
    const heading = headingFields[kind]
    const beat = point.address && findBeat(this.state.score, point.address)
    if (!heading && !beat) return
    const printed = !heading && !point.glyph ? Array.from(this.state.targets.values()).find(target =>
      target.kind === kind && target.printed && sameAddress(target.address, point.address)) : undefined
    const glyph = point.glyph ?? printed?.glyph
    const { sheet, scoreText: input } = this.ui
    const minWidth = 96
    const { resources, scale } = this.state.api!.settings.display
    input.style.font = resources.elementFonts.get(textFonts[kind])!.toCssString(scale)
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
      const title = kind === "subtitle" && Array.from(this.state.targets.values()).find(target => target.kind === "title" && target.glyph)
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
      const tempo = Array.from(this.state.targets.values()).find(({ kind, rect }) =>
        kind === "tempo" && y < rect.y + rect.h && y + h > rect.y
        && x < rect.x + rect.w && x + minWidth > rect.x)
      if (tempo) {
        const afterTempo = tempo.rect.x + tempo.rect.w + 3
        if (afterTempo + minWidth <= sheet.offsetWidth) x = afterTempo
      }
    }
    w = Math.min(sheet.offsetWidth - x, Math.max(minWidth, w + 2))
    position(input, { x, y, w, h })
    this.c.completion.closeCompletion()
    this.state.selection = null
    this.state.passage = null
    this.c.points.markSelection()
    this.labelTextInput(kind)
    input.value = (heading ? this.state.score![heading] : kind === "lyric" ? beat!.lyrics?.[0] : beat!.text) ?? ""
    this.state.textEdit = { point, button, glyph, initialValue: input.value }
    this.showTextDraft()
    input.hidden = false
    input.focus({ preventScroll: true })
    input.select()
    input.scrollLeft = 0
  }

  showTextDraft() {
    const { glyph, initialValue } = this.state.textEdit ?? {}
    const input = this.ui.scoreText
    // Keep the original engraving visible until typing changes the text.
    const original = Boolean(glyph && input.value === initialValue)
    input.toggleAttribute("data-original-text", original)
    glyph?.classList.toggle("editing-text", !original)
  }

  closeText(save: boolean, restoreFocus = false) {
    const edit = this.state.textEdit
    if (!edit) return
    this.state.textEdit = null
    const { point, button, glyph, initialValue } = edit
    const input = this.ui.scoreText
    const value = input.value
    glyph?.classList.remove("editing-text")
    input.hidden = true
    input.removeAttribute("data-original-text")
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true })
    if (!save || value === initialValue) return
    if (restoreFocus) this.state.restoreFocus = point
    this.c.edit.commit(score => {
      const heading = headingFields[point.kind]
      if (heading) return setHeading(score, heading, value)
      const beat = findBeat(score, point.address!)
      return point.kind === "lyric" ? setLyric(beat, value) : setScoreText(beat, value)
    })
  }

  openTempo(tempoPoint: ScorePoint, button: HTMLElement) {
    const point = tempoPoint as TempoPoint
    const { glyph, prefix, digits, suffix, rect } = point
    if (this.state.tempo || !glyph.isConnected) return
    this.state.tempo = { point, button }
    const input = this.ui.tempo
    const { fontFamily, fontSize, fontStyle, fontWeight, fill } = getComputedStyle(glyph)
    Object.assign(input.style, { fontFamily, fontSize, fontStyle, fontWeight, color: fill, lineHeight: rect.h + "px" })
    position(input, { ...rect, w: rect.w + 2 })
    const hiddenDigits = this.el.ownerDocument.createElementNS(glyph.namespaceURI, "tspan")
    hiddenDigits.classList.add("tempo-digits")
    hiddenDigits.textContent = digits
    glyph.replaceChildren(prefix, hiddenDigits, suffix)
    input.setAttribute("aria-label", messages(this.el).bpm)
    input.value = digits
    input.hidden = false
    input.focus({ preventScroll: true })
    input.select()
  }

  closeTempo(save: boolean, restoreFocus = false) {
    if (!this.state.tempo) return
    const { point: { glyph, prefix, digits, suffix, measure }, button } = this.state.tempo
    this.state.tempo = null
    const input = this.ui.tempo
    if (glyph.isConnected) glyph.textContent = prefix + digits + suffix
    input.hidden = true
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true })
    const value = input.value.trim()
    if (!save || !/^\d+$/.test(value)) return
    if (restoreFocus) this.state.restoreFocus = { kind: "tempo", measure }
    this.c.edit.commit(score => setTempo(score.masterBars[measure], Number(value)))
  }
}
