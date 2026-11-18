import { Environment, Settings, exporter, io, midi, model } from "../assets/alphatab-core"
import { configureBlankInstrument } from "./score-notation"

const { Automation, Bar, Beat, Clef, Duration, DynamicValue, GraceType, JsonConverter, KeySignatureType, MasterBar,
  Note, NoteAccidentalMode, Score, SlideOutType, Staff, Track, TupletGroup, Voice } = model
const maxFileBytes = 8 * 1024 * 1024
const format = "alphatab-1"

export type BeatAddress = [track: number, staff: number, bar: number, voice: number, beat: number]
export type NoteAddress = [...BeatAddress, note: number]

export const durations: [string, model.Duration][] = [
  ["whole", Duration.Whole],
  ["half", Duration.Half],
  ["quarter", Duration.Quarter],
  ["eighth", Duration.Eighth],
  ["sixteenth", Duration.Sixteenth],
  ["thirtySecond", Duration.ThirtySecond],
  ["sixtyFourth", Duration.SixtyFourth],
]
export const clefs: model.Clef[] = [Clef.G2, Clef.F4, Clef.C3, Clef.C4]
const topLine: Partial<Record<model.Clef, number>> = { [Clef.G2]: 38, [Clef.F4]: 26, [Clef.C3]: 32, [Clef.C4]: 30 }
const naturalPitches = [0, 2, 4, 5, 7, 9, 11]
const sharps = [3, 0, 4, 1, 5, 2, 6]
const flats = [6, 2, 5, 1, 4, 0, 3]
export const meters: [number, number][] = [[4, 4], [3, 4], [2, 4], [6, 8]]

const durationValues = durations.map(([, value]) => value)
export const restDurations = [...durationValues, Duration.OneHundredTwentyEighth, Duration.TwoHundredFiftySixth]
const wholeNoteTicks = new midi.MidiFile().division * 4
const smallestRest = wholeNoteTicks / restDurations.at(-1)!

function durationTicks(duration: model.Duration, dots = 0): number {
  return wholeNoteTicks / duration * (2 - 1 / 2 ** dots)
}

function supportedRhythm(duration: model.Duration, dots: number): boolean {
  return restDurations.includes(duration) && Number.isInteger(dots) && dots >= 0 && dots <= 2
    && durationTicks(duration, dots) % smallestRest === 0
}

export function importMusicXML(bytes: Uint8Array): model.Score {
  if (bytes.length === 0 || bytes.length > maxFileBytes) throw new Error("Invalid MusicXML file size")
  const settings = new Settings()
  settings.importer.maxDecodingBufferSize = maxFileBytes
  const importer = Environment.buildImporters().find(candidate => candidate.name === "MusicXML")
  importer!.init(io.ByteBuffer.fromBuffer(bytes), settings)
  const score = importer!.readScore()
  if (!score.tracks.length || !score.masterBars.length) throw new Error("The MusicXML file has no score")
  return score
}

/** Standard MIDI file (format 1) of the score, with its tempo, instruments and repeats as played. Notation details are lost. */
export function exportMidi(score: model.Score): Uint8Array {
  const file = new midi.MidiFile()
  new midi.MidiFileGenerator(score, new Settings(), new midi.AlphaSynthMidiFileHandler(file, true)).generate()
  return file.toBinary()
}

/** Guitar Pro 7 file (`.gp`) of the score. */
export function exportGuitarPro(score: model.Score): Uint8Array {
  return new exporter.Gp7Exporter().export(score, new Settings())
}

export function serializeScore(score: model.Score): string {
  // Script contents are raw text in HTML. Escape markup without altering the parsed JSON.
  return ('{"format":"' + format + '","score":' + JsonConverter.scoreToJson(score) + '}')
    .replaceAll("<", "\\u003c")
}

// Stored data is untyped JSON until alphaTab converts it.
type StoredScore = { tracks?: { staves?: { bars?: { voices: { id?: number, beats: { id?: number }[] }[] }[] }[] }[] }

function restoreMissingVoices(score: StoredScore) {
  const staves = score.tracks?.flatMap(track => track.staves ?? []) ?? []
  const missing: { voices: { id?: number, beats: object[] }[], count: number }[] = []
  for (const staff of staves) {
    let count = 0
    for (const bar of staff.bars ?? []) {
      if (bar.voices.length < count) missing.push({ voices: bar.voices, count })
      else count = bar.voices.length
    }
  }
  if (!missing.length) return

  // Older appends dropped secondary voices. alphaTab needs a beat to link to
  // in the next bar even when that voice is silent.
  let voiceId = -1
  let beatId = -1
  for (const staff of staves) for (const bar of staff.bars ?? []) for (const voice of bar.voices) {
    voiceId = Math.max(voiceId, voice.id ?? -1)
    for (const beat of voice.beats) beatId = Math.max(beatId, beat.id ?? -1)
  }
  for (const { voices, count } of missing) {
    while (voices.length < count) {
      voices.push({ id: ++voiceId, beats: [{ id: ++beatId, isempty: true, duration: Duration.Quarter }] })
    }
  }
}

export function readScore(text: string): model.Score {
  const data = JSON.parse(text)
  if (data?.format !== format || !data.score) throw new Error("Unsupported score data")
  restoreMissingVoices(data.score)
  const score = JsonConverter.jsObjectToScore(data.score)
  if (!score.tracks.length || !score.masterBars.length) throw new Error("The document has no score")
  score.rebuildRepeatGroups()
  return score
}

export function beatAddress(beat: model.Beat): BeatAddress {
  const { voice } = beat
  const { bar } = voice
  const { staff } = bar
  return [staff.track.index, staff.index, bar.index, voice.index, beat.index]
}

export function noteAddress(note: model.Note): NoteAddress {
  return [...beatAddress(note.beat), note.index]
}

export function findBeat(score: model.Score | null | undefined, address: readonly number[] | null | undefined): model.Beat | undefined {
  if (!address) return undefined
  const [track, staff, bar, voice, beat] = address
  return score?.tracks[track]?.staves[staff]?.bars[bar]?.voices[voice]?.beats[beat]
}

export function findNote(score: model.Score | null | undefined, address: readonly number[] | null | undefined): model.Note | undefined {
  return findBeat(score, address)?.notes[address![5]]
}

export function writtenPitch(note: model.Note): number {
  return note.octave * 12 + note.tone
}

export function canChangePitch(note: model.Note | null | undefined, semitones: number): boolean {
  if (!note?.isPiano || note.isTieOrigin || note.isTieDestination || note.harmonicPitch
    || note.hasBend || note.beat.graceType !== GraceType.None) return false
  if (note.isTrill && (note.trillValue + semitones < 0 || note.trillValue + semitones > 127)) return false
  const pitch = writtenPitch(note) + semitones
  return pitch >= 0 && pitch <= 127 && !note.beat.notes.some(other => other !== note && writtenPitch(other) === pitch)
}

export function changePitch(note: model.Note, semitones: number, accidental: model.NoteAccidentalMode = NoteAccidentalMode.Default) {
  if (!canChangePitch(note, semitones)) return false
  const pitch = writtenPitch(note) + semitones
  note.octave = Math.floor(pitch / 12)
  note.tone = pitch % 12
  note.accidentalMode = accidental
  if (note.isTrill) note.trillValue += semitones
  return true
}

function isSimpleBeat(beat: model.Beat): boolean {
  return supportedRhythm(beat.duration, beat.dots) && !beat.hasTuplet
    && beat.graceType === GraceType.None && !beat.graceGroup
    && beat.displayDuration === durationTicks(beat.duration, beat.dots)
    && beat.playbackDuration === beat.displayDuration
}

function isEntryRest(beat: model.Beat | null | undefined): boolean {
  if (!beat?.isRest || beat.isEmpty || beat.hasTuplet || beat.graceType !== GraceType.None
    || beat.graceGroup || beat.playbackDuration !== beat.displayDuration) return false
  return beat.displayDuration >= smallestRest && beat.displayDuration % smallestRest === 0
}

export function isAvailableRest(beat: model.Beat | null | undefined): boolean {
  return !!beat?.isRest && !beat.isEmpty && isSimpleBeat(beat) && !beat.text && !beat.lyrics?.length
    && !beat.chordId && !beat.fermata && !beat.showDynamics && !beat.crescendo && !beat.automations.length && !beat.style
}

export function hasDynamic(beat: model.Beat): boolean {
  if (beat.voice.bar.staff.track.score.stylesheet.hideDynamics || beat.isEmpty || beat.voice.isEmpty) return false
  if (beat.showDynamics !== undefined) return beat.showDynamics
  if (beat.isRest) return false
  let previous = beat.previousBeat
  while (previous?.isRest) previous = previous.previousBeat
  return !previous || beat.dynamics !== previous.dynamics
}

export function setDynamic(beat: model.Beat, dynamic?: model.DynamicValue): boolean {
  const { staff } = beat.voice.bar
  const { stylesheet, tracks } = staff.track.score
  const remove = dynamic === undefined
  if (remove ? !hasDynamic(beat) : beat.showDynamics === true && !stylesheet.hideDynamics && beat.dynamics === dynamic) return false

  const beats = staff.bars.flatMap(bar => bar.voices[beat.voice.index]?.beats ?? [])
  const index = beats.indexOf(beat)
  const following: model.Beat[] = []
  for (let i = index + 1; i < beats.length && !hasDynamic(beats[i]); i++) following.push(beats[i])
  if (remove) {
    let i = index - 1
    while (i >= 0 && !hasDynamic(beats[i])) i--
    dynamic = beats[i]?.dynamics ?? DynamicValue.F
  }
  if (stylesheet.hideDynamics) {
    // Enabling one authored marking should leave the rest of a hidden score quiet visually.
    for (const track of tracks) for (const staff of track.staves) {
      for (const bar of staff.bars) for (const voice of bar.voices) {
        for (const other of voice.beats) other.showDynamics ??= false
      }
    }
    stylesheet.hideDynamics = false
  }
  // Removing resolves the inherited level above, so a value is always set here.
  const level = dynamic as model.DynamicValue
  beat.showDynamics = !remove
  beat.dynamics = level
  for (const other of following) {
    other.dynamics = level
    other.showDynamics = false
  }
  return true
}

function durationChange(beat: model.Beat | null | undefined, duration: model.Duration, dots: number): { count: number, remaining: number } | null {
  if (!beat || !(isSimpleBeat(beat) || isEntryRest(beat)) || !supportedRhythm(duration, dots)
    || beat.notes.some(note => note.isTieOrigin || note.isTieDestination)) return null

  let count = 0
  let remaining = beat.displayDuration - durationTicks(duration, dots)
  if (!remaining && duration === beat.duration && dots === beat.dots) return null
  while (remaining < 0) {
    const rest = beat.voice.beats[beat.index + count + 1]
    if (!isAvailableRest(rest)) return null
    count++
    remaining += rest.displayDuration
  }

  // Fill any space left over with standard rests. Preserve the start of the next note.
  return { count, remaining }
}

export function canChangeDuration(beat: model.Beat | null | undefined, duration: model.Duration, dots = 0): boolean {
  return durationChange(beat, duration, dots) !== null
}

export function canEnterDuration(beat: model.Beat | null | undefined, duration: model.Duration, dots = 0): boolean {
  if (beat?.hasTuplet) return beat.isRest && !beat.isEmpty && beat.graceType === GraceType.None
    && beat.duration === duration && beat.dots === dots
  return isEntryRest(beat) && supportedRhythm(duration, dots)
    && (beat!.displayDuration === durationTicks(duration, dots) || canChangeDuration(beat, duration, dots))
}

export function changeDuration(beat: model.Beat, duration: model.Duration, dots = 0): boolean {
  const change = durationChange(beat, duration, dots)
  if (!change) return false
  beat.duration = duration
  beat.dots = dots
  // MusicXML records an explicit tick length alongside the written value.
  beat.overrideDisplayDuration = undefined
  beat.voice.beats.splice(beat.index + 1, change.count, ...makeRests(change.remaining, Duration.Whole, beat))
  return true
}

function tupletTicks(voice: model.Voice, numerator: number, denominator: number, total: number): number[] | null {
  const group = new TupletGroup(voice)
  const ticks: number[] = []
  // Spread fractional ticks without changing the total. Let alphaTab validate that
  // the rounded beats still form one complete, renderable group.
  for (let i = 0; i < numerator; i++) {
    const length = Math.round((i + 1) * total / numerator) - Math.round(i * total / numerator)
    // check() only reads these fields of the beat.
    const probe = {
      voice, graceType: GraceType.None, tupletNumerator: numerator, tupletDenominator: denominator,
      displayDuration: length, playbackDuration: length,
    } as unknown as model.Beat
    if (length < 1 || !group.check(probe)) return null
    ticks.push(length)
  }
  return group.isFull ? ticks : null
}

type TupletPlan = {
  beats: model.Beat[], numerator: number, denominator: number, following: number, remainder: number, ticks: number[], normal: number
}

export function tupletPlans(first: model.Beat | null | undefined, last: model.Beat | null | undefined): TupletPlan[] {
  if (!first || !last || first.voice !== last.voice) return []
  const { voice, duration, dots } = first
  const beats = voice.beats.slice(first.index, last.index + 1)
  const numerator = beats.length
  if (numerator < 2 || numerator > 16 || beats.some(beat => beat.isEmpty || !isSimpleBeat(beat)
    || beat.duration !== duration || beat.dots !== dots
    || beat.notes.some(note => note.isTieOrigin || note.isTieDestination))) return []
  const normal = durationTicks(duration, dots)
  const original = normal * numerator
  const preferred = [0, 0, 3, 2, 6, 4, 4, 4, 6][numerator] ?? 8
  const denominators = [preferred, ...Array.from({ length: 16 }, (_, index) => index + 1).filter(value => value !== preferred)]
  const previous = voice.beats[first.index - 1]
  const plans: TupletPlan[] = []
  for (const denominator of denominators) {
    if (denominator === numerator) continue
    if (previous?.tupletNumerator === numerator && previous.tupletDenominator === denominator
      && !previous.tupletGroup?.isFull) continue
    const total = normal * denominator
    let remainder = original - total
    let following = 0
    while (remainder < 0 && isAvailableRest(voice.beats[last.index + following + 1])) {
      following++
      remainder += voice.beats[last.index + following].displayDuration
    }
    if (remainder < 0) continue
    const ticks = tupletTicks(voice, numerator, denominator, total)
    if (ticks) plans.push({ beats, numerator, denominator, following, remainder, ticks, normal })
  }
  return plans
}

export function applyTuplet({ beats, numerator, denominator, following, remainder, ticks, normal }: TupletPlan): boolean {
  const truncated = Math.floor(normal * denominator / numerator)
  for (const [index, beat] of beats.entries()) {
    beat.tupletNumerator = numerator
    beat.tupletDenominator = denominator
    beat.overrideDisplayDuration = ticks[index] === truncated ? undefined : ticks[index]
  }
  const last = beats.at(-1)!
  last.voice.beats.splice(last.index + 1, following, ...makeRests(remainder, Duration.Whole, last))
  return true
}

function makeRests(remaining: number, longest: model.Duration = Duration.Whole, previous?: model.Beat | null): model.Beat[] {
  const rests: model.Beat[] = []
  for (const value of restDurations) {
    if (value < longest) continue
    const length = durationTicks(value)
    while (length <= remaining) {
      const rest = new Beat()
      rest.duration = value
      if (previous) {
        rest.dynamics = previous.dynamics
        if (previous.showDynamics !== undefined) rest.showDynamics = false
        rest.crescendo = previous.crescendo
      }
      rests.push(rest)
      remaining -= length
    }
  }
  return rests
}

export function blankScore(type?: string): model.Score {
  const score = new Score()
  const track = new Track()
  const staff = new Staff()
  staff.showStandardNotation = true
  staff.showTablature = false
  configureBlankInstrument(staff, track, type)
  track.addStaff(staff)
  score.addTrack(track)
  appendMeasure(score)
  score.masterBars[0].tempoAutomations.push(Automation.buildTempoAutomation(false, 0, 120, 2))
  score.finish(new Settings())
  return score
}

export function appendMeasure(score: model.Score, amount = 1): boolean {
  const previous = score.masterBars.at(-1) ?? new MasterBar()
  const { timeSignatureNumerator: count, timeSignatureDenominator: denominator, timeSignatureCommon } = previous
  if (!Number.isSafeInteger(amount) || amount < 1 || !durationValues.includes(denominator)
    || !Number.isInteger(count) || count < 1) return false

  for (let index = 0; index < amount; index++) {
    const measure = new MasterBar()
    measure.timeSignatureNumerator = count
    measure.timeSignatureDenominator = denominator
    measure.timeSignatureCommon = timeSignatureCommon
    score.addMasterBar(measure)
    for (const track of score.tracks) {
      for (const staff of track.staves) {
        const last = staff.bars.at(-1)
        const bar = new Bar()
        if (last) {
          bar.clef = last.clef
          bar.clefOttava = last.clefOttava
          bar.keySignature = last.keySignature
          bar.keySignatureType = last.keySignatureType
        } else if (staff.isPercussion) bar.clef = Clef.Neutral
        staff.addBar(bar)
        const voice = new Voice()
        bar.addVoice(voice)
        const previous = last?.voices[0]?.beats.at(-1)
        for (const rest of makeRests(count * durationTicks(denominator), Math.max(Duration.Quarter, denominator), previous)) {
          rest.crescendo = model.CrescendoType.None
          voice.addBeat(rest)
        }
        for (let voiceIndex = 1; voiceIndex < (last?.voices.length ?? 1); voiceIndex++) {
          const secondary = new Voice()
          bar.addVoice(secondary)
          const empty = new Beat()
          empty.isEmpty = true
          empty.duration = Duration.Quarter
          secondary.addBeat(empty)
        }
      }
    }
  }
  return true
}

type NoteLink = "tieOrigin" | "tieDestination" | "slurOrigin" | "slurDestination" | "hammerPullOrigin" | "hammerPullDestination" | "slideOrigin" | "slideTarget"
type NoteFlag = "isTieDestination" | "isSlurDestination" | "isHammerPullOrigin" | "slideOutType"
const noteLinks: [NoteLink, NoteFlag?, model.SlideOutType?][] = [
  ["tieOrigin", "isTieDestination"], ["tieDestination"],
  ["slurOrigin", "isSlurDestination"], ["slurDestination"],
  ["hammerPullOrigin"], ["hammerPullDestination", "isHammerPullOrigin"],
  ["slideOrigin"], ["slideTarget", "slideOutType", SlideOutType.None],
]

export function trimMeasures(score: model.Score, count: number): boolean {
  if (!Number.isSafeInteger(count) || count < 1 || count >= score.masterBars.length) return false
  score.masterBars.splice(count)
  score.masterBars.at(-1)!.nextMasterBar = null
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      if (staff.bars.length > count) {
        staff.bars.splice(count)
        staff.bars.at(-1)!.nextBar = null
      }
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            if ((beat.nextBeat?.voice.bar.index ?? -1) >= count) beat.nextBeat = null
            for (const note of beat.notes) {
              for (const [link, flag, value = false] of noteLinks) {
                if (!((note[link]?.beat.voice.bar.index ?? -1) >= count)) continue
                ;(note as Record<NoteLink, model.Note | null>)[link] = null
                if (flag) (note as unknown as Record<NoteFlag, unknown>)[flag] = value
              }
            }
          }
        }
      }
    }
  }
  score.rebuildRepeatGroups()
  return true
}

function supportsPitchedNotes(bar: model.Bar): boolean {
  return topLine[bar.clef] !== undefined && !bar.staff.isPercussion && bar.staff.standardNotationLineCount === 5
}

export function isPitchedStaff(bar: model.Bar): boolean {
  return bar.staff.showStandardNotation && supportsPitchedNotes(bar)
}

export function staffDegree(beat: model.Beat, step: number): number {
  return topLine[beat.voice.bar.clef]! - step
}

export function pitchAtStep(beat: model.Beat, step: number, accidental?: number): number {
  const { bar } = beat.voice
  const degree = staffDegree(beat, step)
  const letter = ((degree % 7) + 7) % 7
  const key = bar.keySignature
  const keyAccidental = key > 0 && sharps.indexOf(letter) < key ? 1
    : key < 0 && flats.indexOf(letter) < -key ? -1 : 0
  const octaveShift = (bar.clefOttava + beat.ottava - 4) * 12
  return (Math.floor(degree / 7) + 1) * 12 + naturalPitches[letter] + (accidental ?? keyAccidental)
    + bar.staff.transpositionPitch + bar.staff.displayTranspositionPitch - octaveShift
}

export function canPlaceNote(beat: model.Beat | null | undefined): beat is model.Beat {
  if (!beat || !supportsPitchedNotes(beat.voice.bar) || beat.isEmpty) return false
  if (beat.hasTuplet) return beat.graceType === GraceType.None && !beat.graceGroup
    && beat.notes.every(note => note.isPiano && !note.isTieOrigin && !note.isTieDestination)
  if (!beat.isRest) return isSimpleBeat(beat) && beat.notes.every(note => note.isPiano && !note.isTieOrigin && !note.isTieDestination)
  return beat.displayDuration >= smallestRest && beat.displayDuration % smallestRest === 0
    && beat.graceType === GraceType.None && !beat.graceGroup && !beat.hasTuplet
}

function pitchedNote(pitch: number, accidental?: model.NoteAccidentalMode): model.Note {
  const note = new Note()
  note.octave = Math.floor(pitch / 12)
  note.tone = pitch % 12
  if (accidental !== undefined) note.accidentalMode = accidental
  return note
}

export function graceTypeFor(beat: model.Beat | null | undefined, count = 1): model.GraceType | null {
  if (!beat || !isPitchedStaff(beat.voice.bar) || beat.isRest || beat.graceType !== GraceType.None
    || beat.notes.some(note => note.isTieDestination) || count < 1) return null
  const existing = beat.graceGroup?.beats ?? []
  const first = existing[0]
  const type = first?.graceType ?? GraceType.OnBeat
  if (type !== GraceType.OnBeat && type !== GraceType.BeforeBeat) return null
  const size = count + existing.length
  // alphaTab plays a single grace note as a 32nd, a pair as 64ths, and longer groups as 128ths.
  const duration = size * durationTicks(size === 1 ? Duration.ThirtySecond
    : size === 2 ? Duration.SixtyFourth : Duration.OneHundredTwentyEighth)
  const donor = type === GraceType.BeforeBeat ? first!.previousBeat : beat
  if (!donor) return null
  const available = donor.playbackDuration + existing.reduce((sum, grace) => sum + grace.playbackDuration, 0)
  return duration < available ? type : null
}

type PitchEntry = { pitch: number, mode?: model.NoteAccidentalMode }

export function insertGraceNotes(note: model.Note, pitches: PitchEntry[]): NoteAddress | null {
  const beat = note.beat
  const type = graceTypeFor(beat, pitches.length)
  if (type === null || pitches.some(({ pitch }) => !Number.isInteger(pitch) || pitch < 0 || pitch > 127)) return null
  const additions = pitches.map(({ pitch, mode }) => {
    const grace = new Beat()
    grace.graceType = type
    grace.duration = Duration.Eighth
    grace.ottava = beat.ottava
    grace.dynamics = beat.dynamics
    grace.addNote(pitchedNote(pitch, mode))
    return grace
  })
  const address = noteAddress(note)
  beat.voice.beats.splice(beat.index, 0, ...additions)
  address[4] += additions.length
  return address
}

export function canEnterNote(beat: model.Beat | null | undefined, pitch: number, duration: model.Duration, dots = 0): boolean {
  return canPlaceNote(beat) && pitch >= 0 && pitch <= 127
    && !beat.notes.some(note => writtenPitch(note) === pitch)
    && (beat.isRest ? canEnterDuration(beat, duration, dots)
      : (beat.duration === duration && beat.dots === dots) || canChangeDuration(beat, duration, dots))
}

export function enterNotes(beat: model.Beat, notes: PitchEntry[], duration: model.Duration, dots: number): NoteAddress | null {
  if (!notes.length || new Set(notes.map(({ pitch }) => pitch)).size !== notes.length
    || !notes.every(({ pitch }) => canEnterNote(beat, pitch, duration, dots))) return null
  changeDuration(beat, duration, dots)
  const first = beat.notes.length
  for (const { pitch, mode } of notes) beat.addNote(pitchedNote(pitch, mode))
  return noteAddress(beat.notes[first])
}

export function placeNote(beat: model.Beat | null | undefined, step: number, fraction = 0): NoteAddress | null {
  if (!canPlaceNote(beat)) return null
  const pitch = pitchAtStep(beat, step)
  if (pitch < 0 || pitch > 127 || beat.notes.some(note => writtenPitch(note) === pitch)) return null

  const address = beatAddress(beat)
  const note = pitchedNote(pitch)
  if (!beat.isRest || beat.hasTuplet) {
    beat.addNote(note)
    return [...address, note.index]
  }

  const total = beat.displayDuration
  const meter = beat.voice.bar.masterBar.timeSignatureDenominator
  const grid = durationTicks(Math.max(Duration.Quarter, meter))
  const offset = Math.min(Math.ceil(total / grid) - 1, Math.max(0, Math.floor(fraction * total / grid))) * grid
  const duration = restDurations.find(value => durationTicks(value) <= Math.min(grid, total - offset))
  const remaining = total - offset - durationTicks(duration!)
  const before = makeRests(offset, Duration.Whole, beat)
  // Keep the original beat and its markings at the original onset.
  const target = before.length ? new Beat() : beat
  const replacement = [...before, target, ...makeRests(remaining, Duration.Whole, beat)]
  if (before.length) {
    target.dynamics = beat.dynamics
    if (beat.showDynamics !== undefined) target.showDynamics = false
    target.crescendo = beat.crescendo
    beat.duration = before[0].duration
    beat.dots = 0
    beat.overrideDisplayDuration = undefined
    replacement[0] = beat
  }
  target.duration = duration!
  target.dots = 0
  target.overrideDisplayDuration = undefined
  target.ottava = beat.ottava
  target.dynamics = beat.dynamics
  target.addNote(note)
  beat.voice.beats.splice(beat.index, 1, ...replacement)
  address[4] += before.length
  return [...address, note.index]
}

export function canRemoveNote(note: model.Note): boolean {
  return canChangePitch(note, 0) && !note.beat.graceGroup
    && !noteLinks.some(([link]) => note[link])
}

export function removeNote(note: model.Note): boolean {
  if (!canRemoveNote(note)) return false
  note.beat.removeNote(note)
  return true
}

export function cycleClef(bar: model.Bar | null | undefined): boolean {
  return !!bar && setClef(bar, clefs[(clefs.indexOf(bar.clef) + 1) % clefs.length])
}

export function setClef(bar: model.Bar | null | undefined, clef: model.Clef): boolean {
  if (!bar || !supportsPitchedNotes(bar) || !clefs.includes(clef) || bar.clef === clef) return false
  const original = bar.clef
  for (const next of bar.staff.bars.slice(bar.index)) {
    if (next.clef !== original) break
    next.clef = clef
  }
  return true
}

export function setKeySignature(bar: model.Bar | null | undefined, signature: number, type: model.KeySignatureType): boolean {
  if (!bar || !supportsPitchedNotes(bar) || !Number.isInteger(signature) || Math.abs(signature) > 7
    || (type !== KeySignatureType.Major && type !== KeySignatureType.Minor)) return false
  const { keySignature, keySignatureType, index } = bar
  if (signature === keySignature && type === keySignatureType) return false
  for (const track of bar.staff.track.score.tracks) {
    for (const staff of track.staves) {
      if (!staff.bars[index] || !supportsPitchedNotes(staff.bars[index])) continue
      for (const next of staff.bars.slice(index)) {
        if (next.keySignature !== keySignature || next.keySignatureType !== keySignatureType) break
        next.keySignature = signature
        next.keySignatureType = type
      }
    }
  }
  return true
}

export function cycleMeter(score: model.Score, start: number): boolean {
  const first = score.masterBars[start]
  if (!first) return false
  const index = meters.findIndex(([count, denominator]) =>
    count === first.timeSignatureNumerator && denominator === first.timeSignatureDenominator)
  return meters.slice(index + 1).concat(meters.slice(0, Math.max(0, index)))
    .some(([count, denominator]) => setMeter(score, start, count, denominator))
}

function meterChanges(score: model.Score, start: number, count: number, denominator: number) {
  const first = score.masterBars[start]
  if (!first || !meters.some(([n, d]) => n === count && d === denominator)
    || (first.timeSignatureNumerator === count && first.timeSignatureDenominator === denominator)) return null
  const capacity = count * durationTicks(denominator)
  const changes: { measure: model.MasterBar, voice: model.Voice, keep: number, used: number }[] = []
  for (const measure of score.masterBars.slice(start)) {
    if (measure.timeSignatureNumerator !== first.timeSignatureNumerator
      || measure.timeSignatureDenominator !== first.timeSignatureDenominator) break
    if (measure.isAnacrusis || measure.isFreeTime || measure.tempoAutomations.some(a => a.ratioPosition > 0)) return null
    for (const track of score.tracks) {
      for (const staff of track.staves) {
        const bar = staff.bars[measure.index]
        if (!bar) return null
        for (const voice of bar.voices) {
          if (voice.isEmpty) continue
          let keep = voice.beats.length
          while (keep && isAvailableRest(voice.beats[keep - 1])) keep--
          const end = voice.beats.slice(0, keep).reduce((sum, beat) => sum + beat.displayDuration, 0)
          if (end > capacity || end % smallestRest !== 0) return null
          changes.push({ measure, voice, keep, used: end })
        }
      }
    }
  }
  return changes.length ? changes : null
}

export function canSetMeter(score: model.Score, start: number, count: number, denominator: number): boolean {
  return meterChanges(score, start, count, denominator) !== null
}

export function setMeter(score: model.Score, start: number, count: number, denominator: number): boolean {
  const changes = meterChanges(score, start, count, denominator)
  if (!changes) return false
  for (const { measure, voice, keep, used } of changes) {
    measure.timeSignatureNumerator = count
    measure.timeSignatureDenominator = denominator
    measure.timeSignatureCommon = false
    const rests = makeRests(count * durationTicks(denominator) - used, Duration.Whole, voice.beats[keep - 1])
    for (const rest of rests) rest.crescendo = model.CrescendoType.None
    voice.beats.splice(keep, voice.beats.length - keep, ...rests)
  }
  return true
}

export function setScoreText(beat: model.Beat | null | undefined, value: string): boolean {
  const text = value.trim() ? value : null
  if (!beat || beat.text === text) return false
  beat.text = text
  return true
}

export function isLyricBeat(beat: model.Beat | null | undefined): boolean {
  return Boolean(beat && !beat.isEmpty && !beat.isRest && beat.graceType === GraceType.None)
}

export function setLyric(beat: model.Beat | null | undefined, value: string): boolean {
  if (!beat || (!isLyricBeat(beat) && !beat.lyrics?.[0])) return false
  const syllable = value.trim()
  if ((beat.lyrics?.[0] ?? "") === syllable) return false
  const lyrics = [...beat.lyrics ?? []]
  lyrics[0] = syllable
  beat.lyrics = lyrics.some(Boolean) ? lyrics : null
  return true
}

export function setHeading(score: model.Score, field: string, value: string): boolean {
  const heading = value.trim()
  if ((field !== "title" && field !== "subTitle") || score[field] === heading) return false
  score[field] = heading
  return true
}

export function setTempo(measure: model.MasterBar, bpm: number): boolean {
  if (!Number.isInteger(bpm) || bpm < 20 || bpm > 300) return false
  const marking = measure.tempoAutomations.find(a => a.ratioPosition === 0)
  if (marking?.value === bpm) return false
  if (marking) marking.value = bpm
  else measure.tempoAutomations.unshift(Automation.buildTempoAutomation(false, 0, bpm, 2))
  return true
}

export const sameAddress = (left: readonly number[] | null | undefined, right: readonly number[] | null | undefined) => left?.join("/") === right?.join("/")

// Replaces the visible labels of an untouched localized example with the translation seed.
export function localizeLabels(score: model.Score, text: string | null) {
  if (!text) return
  try {
    const { source = {}, labels = {} } = JSON.parse(text)
    if (typeof labels.title === "string" && score.title === source.title) score.title = labels.title
    if (typeof labels.subTitle === "string" && score.subTitle === source.subTitle) score.subTitle = labels.subTitle
    if (typeof labels.artist === "string" && score.artist === source.artist) score.artist = labels.artist
    for (const [index, label] of (labels.tracks ?? []).entries()) {
      const track = score.tracks[index]
      const original = source.tracks?.[index]
      if (!track || !original || !label) continue
      if (typeof label.name === "string" && track.name === original.name) track.name = label.name
      if (typeof label.shortName === "string" && track.shortName === original.shortName) track.shortName = label.shortName
    }
  } catch {
    // A malformed optional seed must not prevent the score itself from loading.
  }
}
