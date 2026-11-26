import { synth } from "../assets/alphatab-core"
import type { scoreScales } from "../model/score-notation"
import { ScoreAppend } from "./score-append"
import { ScoreDrag } from "./score-drag"
import { ScoreEditing } from "./score-editing"
import { ScoreEntry } from "./score-entry"
import { ScorePointLayer } from "./score-points-layer"
import type { EditorState, Ui } from "./score-shared"
import { ScoreText } from "./score-text"
import { ScoreView } from "./score-view"

// What the controllers need from the widget element.
type ScoreHost = {
  readonly type: string
  readonly size: keyof typeof scoreScales
  readonly editing: boolean
  updateControls(): void
  sync(keepSelection?: boolean): void
  writeScore(text: string, keepSelection?: boolean): void
  dataBlock(): Element | undefined
  labelsBlock(): Element | undefined
}

// Owns the state of one widget instance and the controllers that act on it.
export class ScoreSession {
  state: EditorState = {
    api: null, appendApi: null, score: null, selection: null, passage: null, targets: new Map(), drag: null,
    endBarSpan: 0, appendDrag: null, tempo: null, textEdit: null, completion: null, completionNext: null,
    restoreFocus: false, snapshot: undefined, labelsSnapshot: undefined, scoreType: null, notice: null,
  }
  view = new ScoreView(this)
  points = new ScorePointLayer(this)
  edit = new ScoreEditing(this)
  drag = new ScoreDrag(this)
  completion = new ScoreEntry(this)
  append = new ScoreAppend(this)
  text = new ScoreText(this)

  constructor(readonly element: HTMLElement, readonly ui: Ui, readonly host: ScoreHost) {}

  get editing() {
    return this.host.editing
  }

  get playing() {
    return this.state.api?.playerState === synth.PlayerState.Playing
  }
}
