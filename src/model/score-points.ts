import { beatAddress, canPlaceNote, isLyricBeat, isPitchedStaff, noteAddress } from "./score-model"
import type { BeatAddress, NoteAddress } from "./score-model"
import { playbackInstrumentName } from "./score-instruments"
import { sameVoice } from "./score-passage"
import { model } from "../assets/alphatab-core"
import type { rendering } from "../assets/alphatab-core"

export type Rect = { x: number, y: number, w: number, h: number }
export type Position = { x: number, y: number }

/** An interactive region of the rendered score. Which fields are set depends on `kind`. */
export type ScorePoint = {
  kind: string
  rect: Rect
  address?: BeatAddress | NoteAddress
  onNotesX?: number
  staff?: Rect
  beatBounds?: rendering.BeatBounds
  pitchDrag?: boolean
  trackIndex?: number
  bar?: [track: number, staff: number, bar: number]
  measure?: number
  glyph?: Element
  prefix?: string
  digits?: string
  suffix?: string
  printed?: boolean
  headingAction?: boolean
}

type TrackLabel = { name: string, trackIndex: number, x: number, y: number }
// Measure edges and vertical extent of the rows that an end-bar drag would add.
export type AppendArea = { y: number, h: number, dy: number, edges: number[] }

export function sheetPosition(sheet: HTMLElement, clientX: number, clientY: number): Position {
  const rect = sheet.getBoundingClientRect()
  return {
    x: (clientX - rect.left) * sheet.offsetWidth / rect.width,
    y: (clientY - rect.top) * sheet.offsetHeight / rect.height,
  }
}

export function staffStep(staff: Rect, y: number): number {
  return Math.round((y - staff.y) / (staff.h / 8))
}

export function appendButtonRect(sheetWidth: number, staff: Rect): Rect {
  const x = staff.x + staff.w + 1
  return { x, y: staff.y, w: Math.max(0, Math.min(48, sheetWidth - x)), h: staff.h }
}

function glyphRect(sheet: HTMLElement, glyph: Element): Rect {
  const box = glyph.getBoundingClientRect()
  const start = sheetPosition(sheet, box.left, box.top)
  const end = sheetPosition(sheet, box.right, box.bottom)
  return { ...start, w: end.x - start.x, h: end.y - start.y }
}

export function trackLabelPositions(score: model.Score, systems: rendering.StaffSystemBounds[], braces: Pick<Rect, "x" | "y" | "h">[] = [], editing = false, locale = ""): TrackLabel[] {
  const { tracks, stylesheet } = score
  const { TrackNameMode, TrackNamePolicy } = model
  const policy = tracks.length === 1 ? stylesheet.singleTrackTrackNamePolicy : stylesheet.multiTrackTrackNamePolicy
  const labels: TrackLabel[] = []
  const seen = new Set<number>()
  for (const [index, system] of systems.entries()) {
    const showNames = policy === TrackNamePolicy.AllSystems
      || (index === 0 && policy === TrackNamePolicy.FirstSystem)
    if (!showNames && (!editing || seen.size === tracks.length)) break
    const mode = index === 0 ? stylesheet.firstSystemTrackNameMode : stylesheet.otherSystemsTrackNameMode
    const stavesByTrack = new Map<model.Track, { left: number, top: number, bottom: number }>()
    for (const { bar, realBounds: { x, y, h } } of system.bars[0].bars) {
      const track = bar.staff.track
      const group = stavesByTrack.get(track)
      if (group) {
        group.top = Math.min(group.top, y)
        group.bottom = Math.max(group.bottom, y + h)
      } else stavesByTrack.set(track, { left: x, top: y, bottom: y + h })
    }
    for (const [track, { left, top, bottom }] of stavesByTrack) {
      const name = mode === TrackNameMode.FullName ? track.name : track.shortName
      if (!(showNames && name) && (!editing || seen.has(track.index))) continue
      const y = (top + bottom) / 2
      const brace = braces.find(rect => rect.x < left && y >= rect.y && y <= rect.y + rect.h)
      labels.push({
        name: playbackInstrumentName(track, locale), trackIndex: track.index,
        x: Math.min(system.realBounds.x, brace?.x ?? Infinity), y,
      })
      seen.add(track.index)
    }
  }
  return labels
}

export function trackLabelPoints(sheet: HTMLElement, labels: Iterable<HTMLElement>): ScorePoint[] {
  return Array.from(labels, label => {
    const rect = glyphRect(sheet, label)
    const y = Math.max(0, rect.y)
    return {
      kind: "instrument", trackIndex: Number(label.dataset.track), rect: {
        ...rect, y, h: Math.min(sheet.offsetHeight, rect.y + rect.h) - y,
      },
    }
  }).filter(({ rect }) => rect.w > 0 && rect.h > 0)
}

export function scoreBraces(sheet: HTMLElement, notation: Element): Rect[] {
  return Array.from(notation.querySelectorAll("svg text"))
    .filter(glyph => glyph.textContent === "\ue000")
    .map(glyph => glyphRect(sheet, glyph))
}

export function endBarStrokes(sheet: HTMLElement, notation: Element, button: Rect, span: number): SVGRectElement[] {
  const box = sheet.getBoundingClientRect()
  const scaleX = box.width / sheet.offsetWidth
  const scaleY = box.height / sheet.offsetHeight
  const edge = box.left + (button.x - 1) * scaleX
  const middle = box.top + (button.y + button.h / 2) * scaleY
  const strokes: SVGRectElement[] = []
  for (const svg of notation.querySelectorAll("svg")) {
    const { top, bottom } = svg.getBoundingClientRect()
    if (middle < top || middle > bottom) continue
    for (const rect of svg.querySelectorAll("rect")) {
      const bounds = rect.getBoundingClientRect()
      if (bounds.width && bounds.height >= (button.h - 1) * scaleY
        && bounds.top <= middle && bounds.bottom >= middle
        && bounds.left >= edge - (span + 1) * scaleX && bounds.right <= edge + scaleX) {
        strokes.push(rect)
      }
    }
  }
  return strokes
}

function coveredMeasures(areas: AppendArea[], point: Position): number {
  let count = 0
  for (const { y, h, dy, edges } of areas) {
    const top = y + dy
    if (point.y < top) break
    if (point.y >= top + h) {
      count += edges.length
      continue
    }
    count += edges.filter(edge => point.x >= edge).length
    break
  }
  return count
}

export function endBarDragDelta(point: Position, systems: rendering.StaffSystemBounds[], areas: AppendArea[] = []): number {
  const added = coveredMeasures(areas, point)
  if (added) return added
  const lastRow = systems.at(-1)!
  const lastBar = lastRow.bars.at(-1)!
  const count = lastBar.index + 1
  if (point.y >= lastRow.realBounds.y + lastRow.realBounds.h) return 0
  let rowIndex = systems.length - 1
  while (rowIndex > 0) {
    const before = systems[rowIndex - 1].realBounds
    const current = systems[rowIndex].realBounds
    if (point.y >= (before.y + before.h + current.y) / 2) break
    rowIndex--
  }
  const row = systems[rowIndex]

  // Snap to the nearest measure boundary in score order, even for irregular or wrapped bars.
  const next = row.bars.find(({ realBounds: bar }) => point.x < bar.x + bar.w / 2)
  const keep = next?.index ?? row.bars.at(-1)!.index + 1
  return Math.max(1, keep) - count
}

export function beatPointAt(points: Iterable<ScorePoint>, origin: BeatAddress, { x, y }: Position): ScorePoint | undefined {
  let best: ScorePoint | undefined
  let rowDistance = Infinity
  let beatDistance = Infinity
  for (const point of points) {
    if (!point.beatBounds || !sameVoice(point.address!, origin)) continue
    const { rect, staff } = point as ScorePoint & { staff: Rect }
    const row = Math.max(staff.y - y, y - staff.y - staff.h, 0)
    const beat = Math.max(rect.x - x, x - rect.x - rect.w, 0)
    if (row > rowDistance || (row === rowDistance && beat >= beatDistance)) continue
    best = point
    rowDistance = row
    beatDistance = beat
  }
  return best
}

export function colorNote(sheet: HTMLElement, groups: Iterable<Element>, rect: Rect): void {
  let best: SVGTextElement | undefined
  let distance = Infinity
  for (const group of groups) {
    for (const glyph of group.querySelectorAll<SVGTextElement>("text")) {
      const matrix = glyph.getScreenCTM()
      if (!matrix) continue
      const x = glyph.x.baseVal[0]?.value ?? 0
      const y = glyph.y.baseVal[0]?.value ?? 0
      const origin = new DOMPoint(x, y).matrixTransform(matrix)
      const center = glyph.getBoundingClientRect()
      const point = sheetPosition(sheet, center.x + center.width / 2, origin.y)
      const delta = Math.hypot(point.x - rect.x - rect.w / 2, point.y - rect.y - rect.h / 2)
      if (delta < distance) {
        best = glyph
        distance = delta
      }
    }
  }
  best?.classList.add("selected-ink")
}

export function scorePoints(sheet: HTMLElement, bounds: rendering.BoundsLookup, notation: Element): ScorePoint[] {
  const systems = bounds.staffSystems
  const measures = systems.flatMap(system => system.bars)
  const staves = measures.flatMap(measure => measure.bars)
  const points: ScorePoint[] = []
  const directions = new Map<number, { beat: model.Beat, staff: Rect, top: number, bottom: number }>()
  for (const system of systems) {
    const { y, h } = system.realBounds
    const firstMeasure = system.bars[0]?.bars ?? []
    const lyricStaves = firstMeasure.map((_, index) =>
      system.bars.some(measure => measure.bars[index]?.beats.some(({ beat }) => isLyricBeat(beat))))
    for (const measure of system.bars) {
      for (const [index, { beats, realBounds: staff }] of measure.bars.entries()) {
        const previous = firstMeasure[index - 1]?.realBounds
        const next = firstMeasure[index + 1]?.realBounds
        const top = Math.max(0, previous ? (previous.y + previous.h + staff.y) / 2 : y)
        const bottom = Math.min(sheet.offsetHeight, next ? (staff.y + staff.h + next.y) / 2 : y + h)
        const below = staff.y + staff.h + 8
        const lyricTop = lyricStaves[index] ? bottom - Math.min(20, Math.max(0, bottom - below) / 2) : bottom
        const lanes: [string, number, number][] = [["text", top, staff.y - 8], ["dynamics", below, lyricTop]]
        for (const { beat, onNotesX, realBounds: { x, w } } of beats) {
          if (beat.isEmpty || beat.graceType || w <= 0) continue
          const address = beatAddress(beat)
          if (beat.text || !beat.isRest || beat.showDynamics || beat.lyrics?.[0]) directions.set(beat.id, { beat, staff, top, bottom })
          if (lyricTop < bottom && isLyricBeat(beat)) points.push({
            kind: "lyric", address, onNotesX, rect: { x, y: lyricTop, w, h: bottom - lyricTop },
          })
          if (beat.voice.index !== 0) continue
          for (const [kind, start, end] of lanes) {
            if (end > start) points.push({
              kind, address, onNotesX, rect: { x, y: start, w, h: end - start },
            })
          }
        }
      }
    }
  }
  for (const { bar, beats, realBounds: staff } of staves) {
    const pitchedStaff = isPitchedStaff(bar)
    for (const item of beats) {
      const { beat, realBounds } = item
      // The first voice provides note-entry slots. Noteheads in other voices remain editable.
      if (!beat.isEmpty && realBounds.w > 0) {
        const insert = pitchedStaff && beat.voice.index === 0 && canPlaceNote(beat)
        points.push({
          kind: insert ? "insert" : "beat", address: beatAddress(beat), staff, beatBounds: item,
          rect: { x: realBounds.x, y: staff.y - 8, w: realBounds.w, h: staff.h + 16 },
        })
      }
      for (const { note, noteHeadBounds } of item.notes ?? []) {
        points.push({
          kind: "note", address: noteAddress(note), staff, rect: noteHeadBounds,
          pitchDrag: pitchedStaff && note.isPiano,
        })
      }
    }
    if (bar.index === bar.staff.bars.length - 1 && bar.staff.index === 0 && bar.staff.track.index === 0) {
      points.push({
        kind: "append",
        rect: appendButtonRect(sheet.offsetWidth, staff),
      })
    }
  }

  const signatures = new Map<rendering.BarBounds, Rect>()
  const keys = new Map<rendering.BarBounds, Rect>()
  for (const glyph of notation.querySelectorAll<SVGTextElement>("svg text")) {
    if (glyph.parentElement?.matches("g:is(.ww-direction-text, .ww-direction-dynamics, .ww-direction-lyric, .ww-heading-title, .ww-heading-subtitle)")) continue
    const text = glyph.textContent ?? ""
    const symbol = text.trim().codePointAt(0)!
    const clef = symbol >= 0xe050 && symbol <= 0xe067
    const meter = symbol >= 0xe080 && symbol <= 0xe08b
    const key = symbol >= 0xe260 && symbol <= 0xe262
      && !/\bb\d+\b/.test(glyph.closest("g[class]")?.getAttribute("class") ?? "")
    const tempo = /^(\s*=\s*)(\d+(?:\.\d+)?)(\s*)$/.exec(text)
    if (!clef && !meter && !key && !tempo) continue
    const screen = glyph.getBoundingClientRect()
    if (!screen.width || !screen.height) continue
    const start = sheetPosition(sheet, screen.left, screen.top)
    const end = sheetPosition(sheet, screen.right, screen.bottom)
    const rect = { ...start, w: end.x - start.x, h: end.y - start.y }
    if (rect.y < 0) {
      rect.h += rect.y
      rect.y = 0
    }
    const x = start.x + rect.w / 2
    const y = rect.y + rect.h / 2
    if (tempo) {
      const measure = measures.find(({ staffSystemBounds, realBounds }) =>
        x >= realBounds.x && x <= realBounds.x + realBounds.w
        && y >= staffSystemBounds!.realBounds.y - 8 && y <= realBounds.y + realBounds.h)
      const [, prefix, digits, suffix] = tempo
      const master = measure?.bars[0]?.bar.masterBar
      if (!measure || !master?.tempoAutomations.some(marking => marking.ratioPosition === 0 && marking.value === Number(digits))) continue
      const matrix = glyph.getScreenCTM()
      if (!matrix) continue
      const left = glyph.getStartPositionOfChar(prefix.length).matrixTransform(matrix)
      const right = glyph.getEndPositionOfChar(prefix.length + digits.length - 1).matrixTransform(matrix)
      const numberX = sheetPosition(sheet, left.x, left.y).x
      const numberEnd = sheetPosition(sheet, right.x, right.y).x
      points.push({
        kind: "tempo", measure: measure.index, glyph, prefix, digits, suffix,
        rect: { ...rect, x: numberX, w: numberEnd - numberX },
      })
      continue
    }
    const staff = staves.find(({ realBounds: b }) =>
      x >= b.x && x <= b.x + b.w && y >= b.y - 10 && y <= b.y + b.h + 10)
    if (!staff) continue
    const { bar } = staff
    const address: [number, number, number] = [bar.staff.track.index, bar.staff.index, bar.index]
    if (clef && isPitchedStaff(bar)) {
      // The SVG font box can extend into the adjacent staff, especially on a grand staff.
      const top = Math.max(rect.y, staff.realBounds.y)
      const bottom = Math.min(rect.y + rect.h, staff.realBounds.y + staff.realBounds.h)
      if (bottom > top) {
        points.push({
          kind: "clef", bar: address,
          rect: { ...rect, y: top, h: bottom - top },
        })
      }
    } else if (meter || (key && isPitchedStaff(bar) && x < (staff.beats[0]?.realBounds.x ?? Infinity))) {
      const regions = key ? keys : signatures
      if (key) Object.assign(rect, { y: staff.realBounds.y, h: staff.realBounds.h })
      if (meter) {
        const top = Math.max(rect.y, staff.realBounds.y)
        const bottom = Math.min(rect.y + rect.h, staff.realBounds.y + staff.realBounds.h)
        if (bottom <= top) continue
        Object.assign(rect, { y: top, h: bottom - top })
      }
      const current = regions.get(staff)
      if (current) {
        const left = Math.min(current.x, rect.x)
        const top = Math.min(current.y, rect.y)
        current.w = Math.max(current.x + current.w, rect.x + rect.w) - left
        current.h = Math.max(current.y + current.h, rect.y + rect.h) - top
        current.x = left
        current.y = top
      } else {
        regions.set(staff, rect)
        points.push({ kind: key ? "key" : "meter", bar: address, measure: bar.index, rect })
      }
    }
  }
  for (const group of notation.querySelectorAll<SVGGElement>("svg :is(.ww-direction-text, .ww-direction-dynamics, .ww-direction-lyric)")) {
    const id = Number([...group.classList].find(name => name.startsWith("ww-beat-"))?.slice(8))
    const anchor = directions.get(id)
    if (!anchor) continue
    const { beat, staff, top, bottom } = anchor
    const kind = group.classList.contains("ww-direction-text") ? "text"
      : group.classList.contains("ww-direction-lyric") ? "lyric" : "dynamics"
    // AlphaTab emits only nonempty verses. The first verse is editable.
    const glyph = kind === "lyric" ? beat.lyrics?.[0] && group.querySelector("text") : group
    if (!glyph) continue
    const rect = glyphRect(sheet, glyph)
    const y = Math.max(rect.y, kind === "text" ? top : staff.y + staff.h)
    const endY = Math.min(rect.y + rect.h, kind === "text" ? staff.y : bottom)
    if (rect.w > 0 && endY > y) points.push({
      kind, address: beatAddress(beat), printed: true, glyph,
      rect: { ...rect, y, h: endY - y },
    })
  }
  const headingActions: string[] = []
  let headingY = 0
  for (const kind of ["title", "subtitle"]) {
    const glyph = notation.querySelector?.(`svg .ww-heading-${kind}`)
    const rect = glyph && glyphRect(sheet, glyph)
    if (glyph && rect && rect.w > 0 && rect.h > 0) {
      headingY = Math.max(headingY, rect.y + rect.h + 2)
      points.push({ kind, glyph, rect })
    } else if (staves.length) {
      headingActions.push(kind)
    }
  }
  for (const [index, kind] of headingActions.entries()) {
    const x = sheet.offsetWidth - 4 - (headingActions.length - index) * 96
    points.push({ kind, headingAction: true, rect: { x, y: headingY, w: 94, h: 20 } })
  }
  return points
}
