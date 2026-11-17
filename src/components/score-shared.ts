import type { AlphaTabApi, model, rendering } from "../assets/alphatab-core"
import type { BeatAddress, NoteAddress } from "../model/score-model"
import type { AppendArea, Position, ScorePoint } from "../model/score-points"
import type { Passage } from "../model/score-passage"
import type { Choice, CompletionContext } from "./score-completion"

export const transportWidth = 36
export const transportButtonHeight = 18
export const transportGap = 8
export const rightGutter = 35
export const maxAppendMeasures = 64

export function position(element: HTMLElement, { x, y, w, h }: { x: number, y: number, w: number, h: number }) {
  Object.assign(element.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" })
}

export type Ui = {
  rowMinimum: HTMLStyleElement
  surface: HTMLElement
  notice: HTMLElement
  sheet: HTMLElement
  transport: HTMLElement
  play: HTMLButtonElement
  playIcon: HTMLElement
  pauseIcon: HTMLElement
  stop: HTMLButtonElement
  score: HTMLElement
  trackLabels: HTMLElement
  appendScore: HTMLElement
  points: HTMLElement
  targets: HTMLElement
  tempo: HTMLInputElement
  scoreText: HTMLInputElement
  completion: HTMLElement
  completionInput: HTMLInputElement
  entryDuration: HTMLElement
  completionList: HTMLUListElement
  completionEmpty: HTMLElement
}

export type PassageSelection = Passage & { annotation?: string }
export type Notice = "importError" | "readError" | "renderError" | "guitar-tab" | "drum-tab" | "jianpu"

type DragState = {
  kind: "pending" | "pitch" | "move" | "select"
  point: ScorePoint
  origin: BeatAddress
  anchor: BeatAddress
  extend: boolean
  priorNote: NoteAddress | null
  priorPassage: PassageSelection | null
  move: Passage | null
  note: model.Note | null
  address: BeatAddress | NoteAddress
  button: HTMLElement
  id: number
  startX: number
  startY: number
  startStep: number
  step: number
  stepHeight: number
  preview: model.Score | null
  previewShift: number
  rendering: boolean
  target?: BeatAddress | null
}

type AppendDrag = {
  button: HTMLElement
  id: number
  start: Position
  count: number
  clickAdds: boolean
  point?: Position
  released?: boolean
  awaitingLayout?: boolean
}

export type AppendPreviewArea = AppendArea & { bars: rendering.MasterBarBounds[], fadeAt?: number }

export type AppendPreview = {
  score: model.Score
  rendering: boolean
  replacementTop?: number
  areas?: AppendPreviewArea[]
}

export type CompletionState = CompletionContext & {
  button: HTMLElement
  entries: Choice[]
  index: number
  listeners: AbortController
}

export type TempoPoint = ScorePoint & { glyph: Element, prefix: string, digits: string, suffix: string, measure: number }
type TextEdit = { point: ScorePoint, button: HTMLElement, glyph?: Element | null, initialValue: string }

// What to focus again after the points are redrawn.
export type FocusTarget = { address?: readonly number[], kind?: string, measure?: number, trackIndex?: number, bar?: readonly number[] }

// The entry the completion continues with after a choice was applied.
type NextEntry = { kind?: string, address: readonly number[], step?: number, duration?: model.Duration, dots?: number }

// State the widget and its controllers share. Controllers read and write it through the session.
export type EditorState = {
  api: AlphaTabApi | null
  appendApi: AlphaTabApi | null
  score: model.Score | null
  selection: NoteAddress | null
  passage: PassageSelection | null
  targets: Map<HTMLElement, ScorePoint>
  drag: DragState | null
  endBarSpan: number
  appendDrag: AppendDrag | null
  tempo: { point: TempoPoint, button: HTMLElement } | null
  textEdit: TextEdit | null
  completion: CompletionState | null
  completionNext: NextEntry | null
  restoreFocus: boolean | FocusTarget
  snapshot: string | null | undefined
  labelsSnapshot: string | null | undefined
  scoreType: string | null
  notice: Notice | null
}
