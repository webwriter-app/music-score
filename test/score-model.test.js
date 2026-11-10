import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  appendMeasure, beatAddress, blankScore, canChangeDuration, changeDuration, changePitch, cycleClef, cycleMeter,
  findNote, importMusicXML, noteAddress, pitchAtStep, placeNote, readScore, removeNote,
  serializeScore, setHeading, setLyric, setScoreText, setTempo, trimMeasures, writtenPitch,
} from "../dist/score-model.js"
import { applyScoreType, defaultScoreType, scoreScales } from "../dist/score-notation.js"
import { playbackInstruments, setPlaybackInstrument } from "../dist/score-instruments.js"
import { copyPassage, editPassage, passageBetween, readPassage } from "../dist/score-passage.js"
import { appendButtonRect, endBarDragDelta, scorePoints, trackLabelPositions } from "../dist/score-points.js"
import { NotationElement, Settings, midi, model, rendering, synth } from "../dist/vendor/alphaTab.core.min.mjs"
import { scoreCompletions } from "../dist/score-completion.js"
import { messages, optionFor, sizeOption } from "../dist/messages.js"

const fixture = readFileSync(new URL("./phrase.musicxml", import.meta.url))
const beats = (score, bar = 0) => score.tracks[0].staves[0].bars[bar].voices[0].beats
const reopen = score => readScore(serializeScore(score))
const staff = score => score.tracks[0].staves[0]
function languageNode(lang, parentElement = null) {
  return {
    parentElement,
    getRootNode: () => null,
    hasAttribute: name => name === "lang" && lang !== undefined,
    getAttribute: name => name === "lang" ? lang ?? null : null,
  }
}

const english = messages(languageNode("en"))

test("score messages and drawer choices follow each instance's language", () => {
  const inherited = languageNode(undefined, languageNode("de-CH"))
  const explicitEnglish = languageNode("en-GB", inherited)
  assert.equal(messages(inherited).play, "Abspielen")
  assert.equal(messages(explicitEnglish).play, "Play")
  assert.equal(messages(languageNode("", inherited)).play, "Play")
  assert.equal(optionFor(inherited, sizeOption).options[0].label._, "Kompakt")
  assert.equal(optionFor(explicitEnglish, sizeOption).options[0].label._, "Compact")
  assert.equal(messages(languageNode("fr-CA")).importScore, "Importer du MusicXML")
  assert.equal(optionFor(languageNode("es-419"), sizeOption).label._, "Tamaño")
  assert.equal(optionFor(languageNode("constructor"), sizeOption).label._, "Size")
})

test("advertised languages translate instrument labels without changing MIDI program IDs", () => {
  const { keywords } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  const track = blankScore(defaultScoreType).tracks[0]
  const programs = playbackInstruments(track)
  const translatedLabels = ["Bright Piano", "Electric Piano 1", "Rain", "Telephone Ring"]
  const languages = keywords.filter(keyword => keyword.startsWith("widget-lang-"))
    .map(keyword => keyword.slice("widget-lang-".length))
  for (const language of languages) {
    const localized = new Map(playbackInstruments(track, language))
    assert.deepEqual([...localized.keys()], programs.map(([id]) => id), language)
    if (language === "en" || language.startsWith("en-")) continue
    for (const [id, label] of programs) {
      if (translatedLabels.includes(label)) assert.notEqual(localized.get(id), label, `${language}: ${label}`)
    }
  }
})

test("completion enters a spelled pitch at the chosen duration without moving later notes", () => {
  const score = blankScore(defaultScoreType)
  const voice = beats(score)
  placeNote(voice[2], 6)
  const at = voice[2].playbackStart
  const context = { point: { kind: "insert", address: beatAddress(voice[0]) }, step: 8 }
  const [duration] = scoreCompletions(score, context, "/8", english)
  assert.equal(duration.setEntryDuration, true)
  assert.equal(voice[0].duration, model.Duration.Quarter)
  context.duration = duration.duration
  const [pitch] = scoreCompletions(score, context, "b♭3", english)
  assert.equal(pitch.label, "B♭3")
  assert.equal(pitch.advance, true)
  assert.ok(pitch.apply())
  const stored = beats(reopen(score))
  assert.equal(writtenPitch(stored[0].notes[0]), 58)
  assert.equal(stored[0].notes[0].accidentalMode, model.NoteAccidentalMode.ForceFlat)
  assert.equal(stored[0].duration, model.Duration.Eighth)
  assert.equal(stored[3].playbackStart, at)
})

test("completion adds a chord tone and offers only durations that fit the selected beat", () => {
  const score = blankScore(defaultScoreType)
  const voice = beats(score)
  const address = placeNote(voice[0], 10)
  placeNote(voice[1], 6)
  const context = { point: { kind: "note", address } }
  assert.equal(scoreCompletions(score, context, "/2", english).length, 0)
  const [chord] = scoreCompletions(score, context, "+g4", english)
  assert.equal(chord.label, "Add G4")
  assert.ok(chord.apply())
  assert.deepEqual(voice[0].notes.map(writtenPitch), [60, 67])
  assert.equal(scoreCompletions(score, context, "+g4", english).length, 0)
})

test("slash values autocomplete notes, rests, standalone durations, and chords", () => {
  const score = blankScore(defaultScoreType)
  const context = { point: { kind: "insert", address: beatAddress(beats(score)[0]) } }
  const choices = query => scoreCompletions(score, context, query, english)
  for (const value of [1, 2, 4, 8, 16, 32, 64]) {
    for (const prefix of ["", "a", "a4", "r", "<c4 e4 g4>"]) {
      const options = choices(prefix + "/")
      assert.ok(options.some(choice => choice.shortcut === prefix + "/" + value))
    }
  }
  assert.equal(choices("a'").length, 0)
  assert.equal(choices("a 8").length, 0)
  assert.equal(choices("1/8").length, 0)
  const last = { point: { kind: "insert", address: beatAddress(beats(score).at(-1)) } }
  assert.equal(scoreCompletions(score, last, "a/1", english).length, 0)
  assert.equal(choices("a")[0].duration, 4)
  assert.equal(choices("a")[0].shortcut, "a")
  context.duration = 8
  context.dots = 1
  assert.equal(choices("a")[0].duration, 8)
  assert.equal(choices("a")[0].dots, 1)
  assert.ok(choices("").some(choice => choice.pitches?.length === 3))
  const [chord] = choices("<c4 e4 g4>/4")
  assert.equal(chord.shortcut, "<c4 e4 g4>/4")
  assert.ok(chord.apply())
  assert.deepEqual(beats(reopen(score))[0].notes.map(writtenPitch), [60, 64, 67])
})

test("dotted note and rest commands preserve the next onset and survive passage paste", () => {
  const score = blankScore(defaultScoreType)
  placeNote(beats(score)[1], 8)
  const point = { kind: "insert", address: beatAddress(beats(score)[0]) }
  const [note] = scoreCompletions(score, { point }, "a4/64..", english)
  assert.ok(note.apply())
  const stored = reopen(score)
  const voice = beats(stored)
  assert.equal(voice[0].dots, 2)
  assert.equal(voice[0].displayDuration, 105)
  assert.equal(voice.find(beat => beat.notes.some(note => writtenPitch(note) !== 69)).displayStart, 960)
  const fragment = copyPassage(stored, passageBetween(point.address, point.address))
  const pasted = editPassage(stored, { source: fragment, target: beatAddress(voice.at(-1)) })
  assert.ok(pasted)
  const pastedBeat = beats(readScore(pasted.text))[pasted.passage.first[4]]
  assert.equal(pastedBeat.dots, 2)
  assert.equal(pastedBeat.displayDuration, 105)

  const restScore = blankScore(defaultScoreType)
  const [rest] = scoreCompletions(restScore, { point }, "r/8.", english)
  assert.equal(rest.shortcut, "r/8.")
  assert.ok(rest.apply())
  const rests = beats(reopen(restScore))
  assert.equal(rests[0].displayDuration, 720)
  assert.equal(rests[0].dots, 1)
  assert.equal(rests[0].isRest, true)
  assert.equal(rests[1].displayStart, 720)
})

test("a combined pitch and duration edit fits before it changes either value", () => {
  const score = blankScore(defaultScoreType)
  const voice = beats(score)
  const address = placeNote(voice[0], 10)
  placeNote(voice[1], 6)
  const context = { point: { kind: "note", address } }
  assert.equal(scoreCompletions(score, context, "a4/4.", english).length, 0)
  const [choice] = scoreCompletions(score, context, "a4/8.", english)
  assert.ok(choice.apply())
  const saved = beats(reopen(score))
  assert.equal(writtenPitch(saved[0].notes[0]), 69)
  assert.equal(saved[0].dots, 1)
  assert.equal(saved[2].displayStart, 960)
})

test("completion can enter a note in an imported whole-measure rest with a shorter time signature", () => {
  const score = importMusicXML(Buffer.from(`<?xml version="1.0"?>
    <score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1">
          <attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time>
            <clef><sign>G</sign><line>2</line></clef></attributes>
          <note><rest measure="yes"/><duration>3</duration><type>whole</type></note>
        </measure>
      </part>
    </score-partwise>`))
  const beat = beats(score)[0]
  assert.equal(beat.duration, model.Duration.Whole)
  assert.equal(beat.displayDuration, 2880)
  const context = { point: { kind: "insert", address: beatAddress(beat) } }
  const [pitch] = scoreCompletions(score, context, "c4", english)
  assert.ok(pitch.apply())
  const stored = beats(reopen(score))
  assert.deepEqual(stored.map(beat => beat.duration), [model.Duration.Quarter, model.Duration.Half])
  assert.equal(writtenPitch(stored[0].notes[0]), 60)
})

test("completion directly chooses a clef and a compatible time signature", () => {
  const score = blankScore(defaultScoreType)
  appendMeasure(score)
  const [bass] = scoreCompletions(score, { point: { kind: "clef", bar: [0, 0, 0] } }, "bass", english)
  assert.ok(bass.apply())
  assert.deepEqual(staff(score).bars.map(bar => bar.clef), [model.Clef.F4, model.Clef.F4])
  placeNote(beats(score)[2], 5)
  const context = { point: { kind: "meter", measure: 0 } }
  assert.equal(scoreCompletions(score, context, "2/4", english).length, 0)
  const [meter] = scoreCompletions(score, context, "3/4", english)
  assert.ok(meter.apply())
  assert.deepEqual(score.masterBars.map(bar => bar.timeSignatureNumerator), [3, 3])
})

test("key autocomplete offers every major and minor signature from a blank measure", () => {
  const score = blankScore(defaultScoreType)
  const address = beatAddress(beats(score)[0])
  const context = { point: { kind: "insert", address } }
  const choices = query => scoreCompletions(score, context, query, english)
  assert.ok(choices("").some(choice => choice.shortcut === "key" && choice.openKey))
  assert.equal(choices("key").filter(choice => !choice.openKey).length, 30)
  const [flat] = choices("key B♭ major")
  assert.equal(flat.signature, -2)
  assert.ok(flat.apply())
  const [b] = choices("b4")
  assert.equal(b.label, "B♭4")
  const [sharp] = choices("key f# minor")
  assert.equal(sharp.signature, 3)
  assert.ok(sharp.apply())
  const [stored] = staff(reopen(score)).bars
  assert.equal(stored.keySignature, 3)
  assert.equal(stored.keySignatureType, model.KeySignatureType.Minor)
})

test("passage autocomplete joins, splits, and resets beams without changing the music", () => {
  let score = blankScore(defaultScoreType)
  for (let index = 0; index < 4; index++) {
    const point = { kind: "insert", address: beatAddress(beats(score)[index]) }
    const [choice] = scoreCompletions(score, { point }, "c4/8", english)
    assert.ok(choice.apply())
    score = reopen(score)
  }
  const voice = beats(score)
  const passage = passageBetween(beatAddress(voice[1]), beatAddress(voice[2]))
  const context = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
  const choices = query => scoreCompletions(score, context, query, english)
  const timing = voice.map(beat => [beat.displayStart, beat.displayDuration, beat.notes.map(writtenPitch)])
  const { Auto, ForceMergeWithNext: Join, ForceSplitToNext: Split } = model.BeatBeamingMode
  const modes = () => beats(reopen(score)).slice(0, 4).map(beat => beat.beamingMode)
  assert.deepEqual(choices("").filter(choice => choice.beam).map(choice => choice.shortcut), ["beam", "unbeam", "beam auto"])
  assert.ok(choices("split beam")[0].apply())
  assert.deepEqual(modes(), [Auto, Split, Auto, Auto])
  assert.ok(choices("beam")[0].apply())
  assert.deepEqual(modes(), [Split, Join, Split, Auto])
  assert.ok(choices("beam auto")[0].apply())
  assert.deepEqual(modes(), [Auto, Auto, Auto, Auto])
  assert.deepEqual(beats(reopen(score)).map(beat => [beat.displayStart, beat.displayDuration, beat.notes.map(writtenPitch)]), timing)
})

test("beaming choices require adjacent short notes in the same measure", () => {
  const score = blankScore(defaultScoreType)
  appendMeasure(score)
  assert.ok(changeDuration(beats(score)[3], model.Duration.Eighth))
  const ready = reopen(score)
  const first = placeNote(beats(ready)[4], 4).slice(0, 5)
  const secondBeat = beats(ready, 1)[0]
  const [choice] = scoreCompletions(ready, { point: { kind: "insert", address: beatAddress(secondBeat) } }, "g4/8", english)
  const last = choice.apply().slice(0, 5)
  const context = { point: { kind: "beat", address: last }, group: "passage", passage: passageBetween(first, last) }
  assert.equal(scoreCompletions(reopen(ready), context, "", english).some(choice => choice.beam), false)
})

test("tie autocomplete connects matching chord tones and removes one link without breaking the chain", () => {
  let score = blankScore(defaultScoreType)
  for (const [index, token] of ["<c4 e4>/4", "<c4 g4>/4", "c4/4", "g4/4"].entries()) {
    const point = { kind: "insert", address: beatAddress(beats(score)[index]) }
    assert.ok(scoreCompletions(score, { point }, token, english)[0].apply())
    score = reopen(score)
  }
  const passage = passageBetween(beatAddress(beats(score)[0]), beatAddress(beats(score)[3]))
  const context = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
  assert.ok(scoreCompletions(score, context, "tie", english)[0].apply())
  score = reopen(score)
  const [first, second, third, last] = beats(score).map(beat => beat.notes)
  assert.equal(first[0].tieDestination, second[0])
  assert.equal(second[0].tieDestination, third[0])
  assert.equal(first[1].tieDestination, null)
  assert.equal(last[0].tieOrigin, null)
  assert.deepEqual(beats(score).map(beat => beat.notes.map(writtenPitch)), [[60, 64], [60, 67], [60], [67]])

  const selected = { point: { kind: "note", address: noteAddress(first[0]) } }
  assert.ok(scoreCompletions(score, selected, "untie", english)[0].apply())
  const stored = beats(reopen(score))
  assert.equal(stored[0].notes[0].tieDestination, null)
  assert.equal(stored[1].notes[0].isTieDestination, false)
  assert.equal(stored[1].notes[0].tieDestination, stored[2].notes[0])
})

test("slur autocomplete spans a phrase across measures and removes both endpoints", () => {
  const blank = blankScore(defaultScoreType)
  appendMeasure(blank)
  let score = reopen(blank)
  const first = placeNote(beats(score)[3], 10)
  const last = placeNote(beats(score, 1)[1], 6)
  score = reopen(score)
  const passage = passageBetween(first.slice(0, 5), last.slice(0, 5))
  const context = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
  assert.equal(scoreCompletions(score, context, "tie", english).length, 0)
  assert.ok(scoreCompletions(score, context, "slur", english)[0].apply())
  score = reopen(score)
  const origin = findNote(score, first)
  const destination = findNote(score, last)
  assert.equal(origin.slurDestination, destination)
  assert.equal(destination.slurOrigin, origin)
  assert.equal(destination.isSlurDestination, true)
  const fragment = copyPassage(score, { first: passage.last, last: passage.last, note: last[5] })
  assert.equal(fragment.beats[0].data.notes[0].isslurdestination, false)
  assert.equal(fragment.beats[0].data.notes[0].sluroriginnoteid, undefined)

  const selected = { point: { kind: "note", address: last } }
  assert.ok(scoreCompletions(score, selected, "unslur", english)[0].apply())
  score = reopen(score)
  assert.equal(findNote(score, first).slurDestination, null)
  assert.equal(findNote(score, last).isSlurDestination, false)
})

test("ties can cross a barline between adjacent matching notes", () => {
  const blank = blankScore(defaultScoreType)
  appendMeasure(blank)
  let score = reopen(blank)
  const first = placeNote(beats(score)[3], 10)
  const last = placeNote(beats(score, 1)[0], 10)
  score = reopen(score)
  const passage = passageBetween(first.slice(0, 5), last.slice(0, 5))
  const context = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
  assert.ok(scoreCompletions(score, context, "tie", english)[0].apply())
  score = reopen(score)
  assert.equal(findNote(score, first).tieDestination, findNote(score, last))
})

test("triplet autocomplete turns three equal rests into fillable tuplet slots without shifting later notes", () => {
  const score = blankScore(defaultScoreType)
  const following = placeNote(beats(score)[3], 10)
  const pitch = writtenPitch(findNote(score, following))
  const passage = passageBetween(beatAddress(beats(score)[0]), beatAddress(beats(score)[2]))
  const context = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
  const [choice] = scoreCompletions(score, context, "tuplet 3:2", english)
  assert.equal(choice.shortcut, "triplet")
  assert.ok(choice.apply())
  const saved = reopen(score)
  const voice = beats(saved)
  assert.deepEqual(voice.slice(0, 3).map(beat => beat.displayDuration), [640, 640, 640])
  assert.equal(voice[0].tupletGroup.beats.length, 3)
  assert.equal(voice[0].tupletGroup.isFull, true)
  assert.equal(voice.at(-1).displayStart, 2880)
  assert.equal(writtenPitch(voice.at(-1).notes[0]), pitch)
  const point = { kind: "insert", address: beatAddress(voice[1]) }
  assert.ok(scoreCompletions(saved, { point }, "e4", english)[0].apply())
  assert.equal(beats(reopen(saved))[1].displayDuration, 640)
  assert.equal(writtenPitch(beats(reopen(saved))[1].notes[0]), 64)
})

test("a septuplet distributes fractional ticks and renders as one full group", () => {
  let score = blankScore(defaultScoreType)
  for (let index = 0; index < 8; index++) {
    const point = { kind: "insert", address: beatAddress(beats(score)[index]) }
    assert.ok(scoreCompletions(score, { point }, "c4/16", english)[0].apply())
    score = reopen(score)
  }
  const voice = beats(score)
  const passage = passageBetween(beatAddress(voice[0]), beatAddress(voice[6]))
  const context = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
  const [choice] = scoreCompletions(score, context, "tuplet 7:4", english)
  assert.ok(choice.apply())
  const stored = beats(reopen(score))
  assert.equal(stored[0].tupletGroup.isFull, true)
  assert.equal(stored[0].tupletGroup.beats.length, 7)
  assert.equal(stored.slice(0, 7).reduce((total, beat) => total + beat.displayDuration, 0), 960)
  assert.equal(stored.find(beat => !beat.isRest && !beat.hasTuplet).displayStart, 1680)
})

test("grace autocomplete inserts pitches before the selected note and keeps the following onset", () => {
  const score = blankScore(defaultScoreType)
  const address = placeNote(beats(score)[0], 10)
  placeNote(beats(score)[1], 8)
  const context = { point: { kind: "note", address } }
  assert.ok(scoreCompletions(score, context, "", english).some(choice => choice.openGrace))
  const [choice] = scoreCompletions(score, context, "grace g#4 a4", english)
  const selected = choice.apply()
  const saved = reopen(score)
  const voice = beats(saved)
  assert.deepEqual(voice.slice(0, 2).map(beat => writtenPitch(beat.notes[0])), [68, 69])
  assert.equal(voice[0].graceType, model.GraceType.OnBeat)
  assert.equal(voice[0].displayDuration, 0)
  assert.equal(findNote(saved, selected), voice[2].notes[0])
  assert.equal(voice[2].playbackStart, 120)
  assert.equal(voice[2].displayStart, 0)
  assert.equal(voice[3].playbackStart, 960)
  assert.equal(voice[3].displayStart, 960)
})

test("articulation autocomplete applies to a passage and removes from a single chord tone", () => {
  const score = blankScore(defaultScoreType)
  const voice = beats(score)
  const first = placeNote(voice[0], 10)
  placeNote(voice[0], 6)
  placeNote(voice[1], 8)
  placeNote(voice[2], 7)
  let saved = reopen(score)
  const passage = passageBetween(beatAddress(beats(saved)[0]), beatAddress(beats(saved)[1]))
  const range = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
  const note = { point: { kind: "note", address: first } }
  const choose = (context, shortcut) => scoreCompletions(saved, context, shortcut, english).find(choice => choice.shortcut === shortcut)
  assert.deepEqual(scoreCompletions(saved, { ...range, marksMenu: true }, "", english).map(choice => choice.shortcut),
    ["staccato", "tenuto", "accent", "trill", "turn", "fermata"])
  assert.ok(choose(range, "staccato").apply())
  assert.ok(choose(range, "accent").apply())
  assert.ok(choose(note, "remove staccato").apply())
  assert.ok(choose(note, "tenuto").apply())
  saved = reopen(saved)
  assert.deepEqual(beats(saved).slice(0, 3).map(beat => beat.notes.map(note => note.isStaccato)), [[false, true], [true], [false]])
  const { None, Normal, Tenuto } = model.AccentuationType
  assert.deepEqual(beats(saved).slice(0, 3).map(beat => beat.notes.map(note => note.accentuated)), [[Tenuto, Normal], [Normal], [None]])
  assert.ok(choose(range, "remove accent").apply())
  assert.equal(findNote(saved, first).accentuated, Tenuto)
  assert.ok(choose(note, "remove tenuto").apply())
  assert.equal(findNote(reopen(saved), first).accentuated, None)
})

test("fermata autocomplete persists and removes marks at the selected beat onsets", () => {
  let score = blankScore(defaultScoreType)
  const first = placeNote(beats(score)[1], 10)
  placeNote(beats(score)[1], 6)
  const last = placeNote(beats(score)[2], 8)
  score = reopen(score)
  const passage = passageBetween(first.slice(0, 5), last.slice(0, 5))
  const context = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
  assert.ok(scoreCompletions(score, context, "fermata", english)[0].apply())
  score = reopen(score)
  assert.deepEqual([...score.masterBars[0].fermata.keys()], [960, 1920])
  assert.equal(beats(score)[1].fermata.type, model.FermataType.Medium)
  const [remove] = scoreCompletions(score, { point: { kind: "note", address: first } }, "remove fermata", english)
  assert.ok(remove.apply())
  score = reopen(score)
  assert.equal(beats(score)[1].fermata, null)
  assert.equal(beats(score)[2].fermata.type, model.FermataType.Medium)
  assert.ok(scoreCompletions(score, context, "remove fermata", english)[0].apply())
  assert.equal(reopen(score).masterBars[0].fermata, null)
})

test("trill and turn choices persist, replace one another, and can be removed", () => {
  let score = blankScore(defaultScoreType)
  const address = placeNote(beats(score)[0], 10)
  score = reopen(score)
  const context = { point: { kind: "note", address } }
  const choose = shortcut => scoreCompletions(score, context, shortcut, english).find(choice => choice.shortcut === shortcut)
  assert.ok(choose("trill").apply())
  score = reopen(score)
  assert.equal(findNote(score, address).trillValue, 62)
  assert.equal(findNote(score, address).isTrillStart, true)
  assert.ok(changePitch(findNote(score, address), 2))
  assert.equal(findNote(score, address).trillValue, 64)
  assert.ok(choose("turn").apply())
  score = reopen(score)
  assert.equal(findNote(score, address).trillValue, -1)
  assert.equal(findNote(score, address).ornament, model.NoteOrnament.Turn)
  assert.ok(choose("remove turn").apply())
  assert.ok(choose("trill").apply())
  assert.ok(choose("remove trill").apply())
  const note = findNote(reopen(score), address)
  assert.equal(note.isTrill, false)
  assert.equal(note.isTrillStart, false)
  assert.equal(note.ornament, model.NoteOrnament.None)
})

test("key editing keeps pitches, updates matching staves, and stops at an existing key change", () => {
  const score = snippetScore("bach-prelude")
  const [upper, lower] = score.tracks[0].staves
  upper.bars[3].keySignature = model.KeySignature.G
  lower.bars[2].keySignature = model.KeySignature.D
  const note = upper.bars[1].voices[0].beats.find(beat => beat.notes.length).notes[0]
  const pitch = writtenPitch(note)
  const context = { point: { kind: "key", bar: [0, 0, 1] } }
  const [choice] = scoreCompletions(score, context, "bb major", english)
  assert.ok(choice.apply())
  const [editedUpper, editedLower] = reopen(score).tracks[0].staves
  assert.deepEqual(editedUpper.bars.slice(0, 4).map(bar => bar.keySignature), [0, -2, -2, 1])
  assert.deepEqual(editedLower.bars.slice(0, 4).map(bar => bar.keySignature), [0, -2, 2, 0])
  assert.equal(writtenPitch(editedUpper.bars[1].voices[0].beats[note.beat.index].notes[0]), pitch)
})

function snippetScore(name, type) {
  const manifestUrl = new URL("../package.json", import.meta.url)
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"))
  const snippetUrl = new URL(manifest.exports[`./snippets/${name}.html`], manifestUrl)
  const html = readFileSync(snippetUrl, "utf8")
  const block = html.match(/^<webwriter-music-score(?: type="([^"]+)")?>\s*<script type="application\/json" slot="data" data-music-score>([^<]+)<\/script>/)
  assert.ok(block)
  assert.equal(block[1], type)
  return readScore(block[2])
}

test("imports MusicXML and preserves ties, repeat groups and tempo through document storage", () => {
  const score = reopen(importMusicXML(fixture))
  assert.equal(score.title.replace(/\s/g, " "), "Practice phrase")
  assert.equal(writtenPitch(beats(score)[0].notes[0]), 60)
  assert.equal(beats(score)[3].notes[0].tieDestination, beats(score, 1)[0].notes[0])
  assert.equal(score.masterBars[0].repeatGroup, score.masterBars[1].repeatGroup)
  assert.equal(score.masterBars[1].repeatCount, 2)
  assert.equal(score.masterBars[0].tempoAutomations[0].value, 112)
})

test("the practice phrase export contains the example as authored score data", () => {
  const score = snippetScore("practice-phrase")
  assert.equal(score.masterBars.length, 2)
  assert.equal(writtenPitch(beats(score)[0].notes[0]), 60)
  assert.equal(beats(score)[3].notes[0].tieDestination, beats(score, 1)[0].notes[0])
})

test("the Bach prelude snippet includes the complete piano score", () => {
  const score = snippetScore("bach-prelude")
  const [treble, bass] = score.tracks[0].staves
  assert.equal(score.title.replace(/\s/g, " "), "Prelude in C major, BWV 846")
  assert.equal(score.masterBars.length, 35)
  assert.equal(score.tempo, 60)
  assert.deepEqual(treble.bars[0].voices[0].beats.slice(1, 4).map(beat => writtenPitch(beat.notes[0])), [67, 72, 76])
  const bassVoice = bass.bars[0].voices[0].beats
  assert.equal(bassVoice[1].notes[0].tieDestination, bassVoice[2].notes[0])
  assert.deepEqual(treble.bars.at(-1).voices[0].beats[0].notes.map(writtenPitch), [64, 67, 72])
})

test("appends editable measures to both Bach staves and keeps the lower staff's secondary voice", () => {
  const score = snippetScore("bach-prelude")
  for (const amount of [1, 2]) {
    const before = score.masterBars.length
    assert.ok(appendMeasure(score, amount))
    const [treble, bass] = score.tracks[0].staves
    assert.ok(treble.bars.slice(before).every(bar => bar.voices.length === 1))
    assert.ok(bass.bars.slice(before).every(bar => bar.voices.length === 2 && bar.voices[1].isEmpty))
  }
  const saved = reopen(score)
  assert.equal(saved.masterBars.length, 38)
  for (const staff of saved.tracks[0].staves) {
    assert.ok(staff.bars.slice(35).every(bar =>
      bar.voices[0].beats.length === 4 && bar.voices[0].beats.every(beat => beat.isRest && !beat.isEmpty)))
  }
  const bass = saved.tracks[0].staves[1]
  assert.equal(bass.bars[34].voices[1].beats.at(-1).nextBeat, bass.bars[35].voices[1].beats[0])
})

test("reopens a Bach score saved by the old single-voice append", () => {
  const score = snippetScore("bach-prelude")
  const bass = score.tracks[0].staves[1]
  const ending = bass.bars[34].voices[1].beats[0].notes.map(writtenPitch)
  assert.ok(appendMeasure(score, 2))
  // Reproduce the two trailing bars written by the old append code.
  for (const bar of bass.bars.slice(35)) bar.voices.splice(1)

  const recovered = reopen(score)
  const restoredBass = recovered.tracks[0].staves[1]
  assert.equal(recovered.masterBars.length, 37)
  assert.deepEqual(restoredBass.bars[34].voices[1].beats[0].notes.map(writtenPitch), ending)
  assert.ok(restoredBass.bars.slice(35).every(bar => bar.voices.length === 2 && bar.voices[1].beats[0].isEmpty))
  assert.ok(appendMeasure(recovered))
  assert.equal(reopen(recovered).masterBars.length, 38)
})

test("alternate notation snippets contain playable examples for their selected type", () => {
  const guitar = snippetScore("guitar-tab", "guitar-tab")
  assert.equal(applyScoreType(guitar, "guitar-tab"), false)
  assert.equal(staff(guitar).showTablature, true)
  assert.equal(staff(guitar).showStandardNotation, false)
  assert.ok(beats(guitar)[0].notes[0].isStringed)

  const drums = snippetScore("drum-tab", "drum-tab")
  assert.equal(applyScoreType(drums, "drum-tab"), false)
  assert.equal(staff(drums).showTablature, true)
  assert.equal(staff(drums).isPercussion, true)
  assert.equal(drums.tracks[0].playbackInfo.primaryChannel, 9)
  assert.equal(beats(drums)[0].notes.length, 2)

  const jianpu = snippetScore("jianpu", "jianpu")
  assert.equal(applyScoreType(jianpu, "jianpu"), false)
  assert.equal(staff(jianpu).showNumbered, true)
  assert.equal(staff(jianpu).showStandardNotation, false)
})

test("instrument autocomplete saves a whole part's sound without changing its notation or another part", () => {
  const score = snippetScore("bach-prelude")
  const [piano] = score.tracks
  const other = blankScore().tracks[0]
  other.playbackInfo.program = 40
  score.addTrack(other)
  const beat = beats(score)[0]
  const { Instrument, Bank, Volume } = model.AutomationType
  for (const type of [Instrument, Bank, Volume]) {
    const automation = new model.Automation()
    automation.type = type
    beat.automations.push(automation)
  }
  const context = { point: { kind: "instrument", trackIndex: 0 } }
  assert.equal(scoreCompletions(score, context, "", english).length, 128)
  assert.equal(scoreCompletions(score, context, "", english)[0].current, true)
  const [choice] = scoreCompletions(score, context, "flute", english)
  assert.equal(choice.label, "Flute")
  assert.equal(scoreCompletions(score, context, "acoustic grand piano", english)[0].label, "Grand Piano")
  assert.equal(scoreCompletions(score, context, "74", english)[0].label, "Flute")
  assert.ok(choice.apply())
  const saved = reopen(score)
  assert.equal(saved.tracks[0].playbackInfo.program, 73)
  assert.equal(saved.tracks[1].playbackInfo.program, 40)
  assert.notEqual(saved.tracks[0].playbackInfo.primaryChannel, saved.tracks[1].playbackInfo.primaryChannel)
  assert.equal(saved.tracks[0].name, piano.name)
  assert.deepEqual(saved.tracks[0].staves.map(staff => staff.bars[0].clef), piano.staves.map(staff => staff.bars[0].clef))
  assert.deepEqual(beats(saved)[0].automations.map(automation => automation.type), [Volume, Instrument])
  assert.equal(beats(saved)[0].getAutomation(Instrument).value, 73)
  applyScoreType(saved, "jianpu")
  assert.equal(saved.tracks[0].playbackInfo.program, 73)
})

test("loads the selected drum kit on a separate playback channel", () => {
  const score = snippetScore("drum-tab", "drum-tab")
  const [drums] = score.tracks
  const other = blankScore("drum-tab").tracks[0]
  score.addTrack(other)
  const context = { point: { kind: "instrument", trackIndex: 0 } }
  assert.deepEqual(scoreCompletions(score, context, "", english).map(choice => choice.label),
    ["Standard Kit", "Room Kit", "Jazz Kit", "Brush Kit"])
  assert.ok(setPlaybackInstrument(drums, 40))
  assert.equal(drums.playbackInfo.bank, 128)
  assert.notEqual(drums.playbackInfo.primaryChannel, 9)
  assert.equal(other.playbackInfo.program, 0)

  const file = new midi.MidiFile()
  const handler = new midi.AlphaSynthMidiFileHandler(file)
  new midi.MidiFileGenerator(reopen(score), new Settings(), handler).generate()
  assert.ok(file.events.some(event => event.type === midi.MidiEventType.ProgramChange
    && event.channel === drums.playbackInfo.primaryChannel && event.program === 40))
  const options = new synth.AudioExportOptions()
  options.soundFonts = [readFileSync(new URL("../dist/vendor/soundfont/sonivox.sf2", import.meta.url))]
  const event = { on() {} }
  const player = new synth.AlphaSynth({ sampleRate: 44100, ready: event, sampleRequest: event, samplesPlayed: event, open() {} }, 100)
  const audio = player.exportAudio(options, file, [], new Map()).render(160)
  assert.ok(audio.samples.some(sample => Math.abs(sample) > 0.0001))
})

test("guitar tab derives fingerings without changing pitches or separating tied notes", () => {
  const score = importMusicXML(fixture)
  const notes = score.masterBars.flatMap((_, index) => beats(score, index).flatMap(beat => beat.notes))
  const pitches = notes.map(note => note.realValue)
  assert.equal(applyScoreType(score, "guitar-tab"), false)
  assert.deepEqual(notes.map(note => note.realValue), pitches)
  assert.ok(notes.every(note => note.isStringed))
  assert.equal(beats(score)[3].notes[0].string, beats(score, 1)[0].notes[0].string)
})

test("standard staff remains the default and is the fallback for pitched parts in drum tab", () => {
  const score = importMusicXML(fixture)
  assert.equal(applyScoreType(score, "drum-tab"), true)
  assert.equal(staff(score).showStandardNotation, true)
  assert.equal(staff(score).showTablature, false)
  applyScoreType(score, "jianpu")
  assert.equal(applyScoreType(score, defaultScoreType), false)
  assert.equal(staff(score).showStandardNotation, true)
  assert.equal(staff(score).showNumbered, false)
})

test("persists pitch and duration, consumes a rest, and leaves later onsets in place", () => {
  const score = importMusicXML(fixture)
  const note = beats(score)[0].notes[0]
  const address = noteAddress(note)
  const nextOnset = beats(score)[2].displayStart
  assert.equal(changePitch(note, 1), true)
  assert.equal(changeDuration(note.beat, 2), true)
  const restored = reopen(score)
  const edited = findNote(restored, address)
  assert.equal(writtenPitch(edited), 61)
  assert.equal(edited.beat.duration, 2)
  assert.equal(edited.beat.playbackDuration, 1920)
  assert.equal(beats(restored)[1].displayStart, nextOnset)
  assert.equal(beats(restored)[2].notes[0].tieDestination, beats(restored, 1)[0].notes[0])
})

test("shortening leaves rests that can be reclaimed by a later edit", () => {
  const score = importMusicXML(fixture)
  const beat = beats(score)[0]
  assert.equal(changeDuration(beat, 16), true)
  const restored = reopen(score)
  assert.deepEqual(beats(restored).slice(0, 4).map(beat => [beat.duration, beat.isRest]),
    [[16, false], [8, true], [16, true], [4, true]])
  assert.equal(changeDuration(beats(restored)[0], 2), true)
  assert.deepEqual(beats(reopen(restored)).map(beat => beat.duration), [2, 4, 4])
})

test("rejects changes that would overlap a note or break a tie", () => {
  const score = importMusicXML(fixture)
  const before = serializeScore(score)
  assert.equal(canChangeDuration(beats(score)[0], 1), false)
  assert.equal(changeDuration(beats(score)[2], 2), false)
  assert.equal(changeDuration(beats(score)[3], 8), false)
  assert.equal(changePitch(beats(score, 1)[0].notes[0], 1), false)
  assert.equal(serializeScore(score), before)
})

test("rejects invalid imports and escapes script markup in saved score text", () => {
  assert.throws(() => importMusicXML(Buffer.from("<html>not a score</html>")))
  assert.throws(() => importMusicXML(Buffer.from("<score-partwise/>")))
  const score = importMusicXML(fixture)
  score.title = "</script><p>title</p>"
  const text = serializeScore(score)
  assert.ok(!text.includes("<"))
  assert.equal(readScore(text).title, score.title)
})

test("blank score starts with one editable measure and accepts notes at staff positions", () => {
  const score = blankScore()
  assert.equal(score.masterBars.length, 1)
  assert.equal(beats(score).length, 4)
  assert.ok(beats(score).every(beat => beat.isRest))
  const beat = beats(score)[0]
  assert.equal(pitchAtStep(beat, 4), 71)
  const address = placeNote(beat, 4)
  const chordTone = placeNote(beat, 2)
  const saved = reopen(score)
  assert.equal(writtenPitch(findNote(saved, address)), 71)
  assert.equal(writtenPitch(findNote(saved, chordTone)), 74)
  assert.equal(placeNote(beats(saved)[0], 4), null)
  assert.equal(removeNote(findNote(saved, chordTone)), true)
  assert.equal(removeNote(findNote(saved, address)), true)
  assert.equal(beats(reopen(saved))[0].isRest, true)
})

test("places a note inside a long rest and changes its duration without moving the next beat", () => {
  const blank = blankScore()
  assert.equal(appendMeasure(blank), true)
  const score = reopen(blank)
  assert.equal(cycleMeter(score, 0), true)
  const saved = reopen(score)
  const voice = beats(saved, 1)
  assert.equal(voice.length, 2)
  assert.equal(voice[0].duration, 2)
  const address = placeNote(voice[0], 4, 0.8)
  const edited = reopen(saved)
  const note = findNote(edited, address)
  assert.equal(note.beat.displayStart, 960)
  assert.equal(changeDuration(note.beat, 8), true)
  assert.equal(beats(reopen(edited), 1).at(-1).displayStart, 1920)
})

test("score points can change clef, meter and tempo and add a measure", () => {
  const score = blankScore()
  const bar = beats(score)[0].voice.bar
  assert.equal(cycleClef(bar), true)
  assert.equal(pitchAtStep(beats(score)[0], 4), 50)
  assert.equal(cycleMeter(score, 0), true)
  assert.equal(setTempo(score.masterBars[0], 96), true)
  assert.equal(appendMeasure(score), true)
  const saved = reopen(score)
  assert.equal(saved.masterBars.length, 2)
  assert.equal(saved.tempo, 96)
  assert.ok(saved.masterBars.every(measure => measure.timeSignatureNumerator === 3))
  assert.equal(beats(saved, 1)[0].voice.bar.clef, bar.clef)
})

test("appends a batch of measures with the last meter, clef and key", () => {
  const score = blankScore()
  const bar = beats(score)[0].voice.bar
  cycleClef(bar)
  bar.keySignature = 2
  assert.equal(cycleMeter(score, 0), true)
  assert.equal(appendMeasure(score, 0), false)
  assert.equal(appendMeasure(score, 3), true)
  const saved = reopen(score)
  assert.equal(saved.masterBars.length, 4)
  for (const measure of saved.masterBars.slice(1)) {
    const voice = beats(saved, measure.index)
    assert.equal(measure.timeSignatureNumerator, 3)
    assert.equal(voice[0].voice.bar.clef, bar.clef)
    assert.equal(voice[0].voice.bar.keySignature, 2)
    assert.equal(voice.length, 3)
    assert.ok(voice.every(beat => beat.isRest))
  }
})

test("trims trailing measures and severs note links into the removed part", () => {
  const score = reopen(importMusicXML(fixture))
  const tie = beats(score)[3].notes[0]
  assert.equal(tie.tieDestination, beats(score, 1)[0].notes[0])
  assert.equal(trimMeasures(score, 0), false)
  assert.equal(trimMeasures(score, 1), true)
  assert.equal(tie.tieDestination, null)
  assert.equal(score.masterBars[0].nextMasterBar, null)
  const saved = reopen(score)
  assert.equal(saved.masterBars.length, 1)
  assert.equal(staff(saved).bars.length, 1)
  assert.equal(saved.tempo, 112)
  assert.equal(writtenPitch(beats(saved)[3].notes[0]), 67)
  assert.equal(beats(saved)[3].notes[0].isTieOrigin, false)
})

test("sizes the add button within the right gutter", () => {
  const staff = { x: 48, y: 22, w: 240, h: 36 }
  assert.deepEqual(appendButtonRect(720, staff), { x: 289, y: 22, w: 48, h: 36 })
  assert.deepEqual(appendButtonRect(320, staff), { x: 289, y: 22, w: 31, h: 36 })
})

test("positions instrument names beside their visible staves and respects name display settings", () => {
  const score = reopen(importMusicXML(fixture))
  const [piano] = score.tracks
  const staff = (track, y) => ({ bar: { staff: { track } }, realBounds: { x: 52, y, h: 36 } })
  const system = (...bars) => ({ realBounds: { x: 48 }, bars: [{ bars }] })
  const systems = [system(staff(piano, 24), staff(piano, 80)), system(staff(piano, 150))]

  assert.deepEqual(trackLabelPositions(score, systems), [{ name: "Grand Piano", trackIndex: 0, x: 48, y: 70 }])
  assert.deepEqual(trackLabelPositions(score, systems, [{ x: 37, y: 24, h: 92 }]),
    [{ name: "Grand Piano", trackIndex: 0, x: 37, y: 70 }])
  piano.name = "Grand piano"
  score.stylesheet.firstSystemTrackNameMode = model.TrackNameMode.FullName
  score.stylesheet.singleTrackTrackNamePolicy = model.TrackNamePolicy.AllSystems
  assert.ok(setPlaybackInstrument(piano, 42))
  assert.deepEqual(trackLabelPositions(score, systems), [
    { name: "Cello", trackIndex: 0, x: 48, y: 70 },
    { name: "Cello", trackIndex: 0, x: 48, y: 168 },
  ])
  assert.equal(piano.name, "Grand piano")
  score.stylesheet.singleTrackTrackNamePolicy = model.TrackNamePolicy.Hidden
  assert.deepEqual(trackLabelPositions(score, systems), [])
  assert.deepEqual(trackLabelPositions(score, systems, [], true), [{ name: "Cello", trackIndex: 0, x: 48, y: 70 }])

  const violin = new model.Track()
  violin.name = "Violin"
  violin.playbackInfo.program = 40
  score.addTrack(violin)
  assert.deepEqual(trackLabelPositions(score, [system(staff(piano, 24), staff(piano, 80), staff(violin, 138))]), [
    { name: "Cello", trackIndex: 0, x: 48, y: 70 },
    { name: "Violin", trackIndex: 1, x: 48, y: 156 },
  ])
})

test("aligns clefs across systems with and without an opening repeat", () => {
  const score = importMusicXML(fixture)
  appendMeasure(score)
  const settings = new Settings()
  settings.core.enableLazyLoading = false
  settings.display.barsPerRow = 1
  settings.notation.elements.set(NotationElement.TrackNames, false)
  const renderer = new rendering.ScoreRenderer(settings)
  renderer.width = 460
  const systems = []
  renderer.partialRenderFinished.on(({ firstMasterBarIndex, renderResult }) => {
    if (firstMasterBarIndex >= 0) systems.push(renderResult)
  })
  renderer.renderScore(score, [0])
  renderer.destroy()

  assert.equal(systems.length, 3)
  const clefX = systems.map(svg => svg.match(/translate\(([^ ]+) [^)]+\)" class="at" ><text[^>]*>&#57424;<\/text>/)?.[1])
  assert.ok(clefX[0])
  assert.deepEqual(clefX, [clefX[0], clefX[0], clefX[0]])
  assert.match(systems[0], /&#57412;/)
  assert.doesNotMatch(systems[2], /&#57412;/)
})

test("preserves staff spacing when cycling clefs on wrapped empty and pitched measures", () => {
  const settings = new Settings()
  settings.display.barsPerRow = 1
  for (const score of [blankScore(), importMusicXML(fixture)]) {
    appendMeasure(score, 2)
    const renderer = new rendering.ScoreRenderer(settings)
    renderer.width = 300
    const staffPositions = () => {
      renderer.renderScore(reopen(score), [0])
      return renderer.boundsLookup.staffSystems.map(system => system.bars[0].lineAlignedBounds.y)
    }
    const before = staffPositions()
    assert.ok(before.length > 1)
    for (let index = 0; index < 3; index++) {
      assert.ok(cycleClef(staff(score).bars[0]))
      assert.deepEqual(staffPositions(), before)
    }
    renderer.destroy()
  }
})

test("renders smaller bars and noteheads at the compact and normal sizes", () => {
  const score = snippetScore("practice-phrase")
  const settings = new Settings()
  settings.core.includeNoteBounds = true
  const renderer = new rendering.ScoreRenderer(settings)
  renderer.width = 300
  const dimensions = ["compact", "normal", "spacious"].map(size => {
    settings.display.scale = scoreScales[size]
    renderer.updateSettings(settings)
    renderer.renderScore(score, [0])
    const { staffSystems } = renderer.boundsLookup
    const staff = staffSystems[0].bars[0].bars[0]
    const note = staff.beats[0].notes[0]
    const end = staffSystems.at(-1).bars.at(-1).bars[0].realBounds
    assert.ok(appendButtonRect(renderer.width, end).w > 0)
    return [staff.realBounds.h, note.noteHeadBounds.w]
  })
  renderer.destroy()
  for (const index of [0, 1]) {
    assert.ok(dimensions[0][index] < dimensions[1][index])
    assert.ok(dimensions[1][index] < dimensions[2][index])
  }
})

test("justifies a complete final system and leaves an incomplete one compact", () => {
  const score = blankScore()
  appendMeasure(score, 5)
  const renderer = new rendering.ScoreRenderer(new Settings())
  renderer.width = 720
  const widths = () => {
    renderer.renderScore(reopen(score), [0])
    return renderer.boundsLookup.staffSystems.map(system => system.realBounds.w)
  }
  const [first, full] = widths()
  assert.equal(full, first)
  appendMeasure(score)
  const [unchanged, second, partial] = widths()
  assert.equal(unchanged, first)
  assert.equal(second, first)
  assert.ok(partial < first)
  renderer.destroy()
})

test("aligns the first beat across rows while drawing time signatures only when needed", () => {
  const score = blankScore()
  appendMeasure(score, 3)
  assert.equal(cycleMeter(score, 2), true)
  const settings = new Settings()
  settings.core.enableLazyLoading = false
  settings.display.barsPerRow = 1
  const renderer = new rendering.ScoreRenderer(settings)
  renderer.width = 460
  const systems = []
  renderer.partialRenderFinished.on(({ firstMasterBarIndex, renderResult }) => {
    if (firstMasterBarIndex >= 0) systems.push(renderResult)
  })
  renderer.renderScore(reopen(score), [0])
  const firstBeats = renderer.boundsLookup.staffSystems.map(system => system.bars[0].bars[0].beats[0].onNotesX)
  renderer.destroy()

  assert.equal(systems.length, 4)
  assert.deepEqual(firstBeats, Array(4).fill(firstBeats[0]))
  assert.deepEqual(systems.map(svg => [...svg.matchAll(/&#5747[56];/g)].map(match => match[0])), [
    ["&#57476;", "&#57476;"], [], ["&#57475;", "&#57476;"], [],
  ])
})

test("only counts additions past the full measure edges, including on a wrapped row", () => {
  const systems = [{ realBounds: { y: 0, h: 80 }, bars: [{ index: 0, realBounds: { x: 48, w: 250 } }] }]
  const areas = [
    { y: 0, dy: 0, h: 80, edges: [470, 680] },
    { y: 75, dy: 5, h: 80, edges: [245, 435] },
  ]
  assert.equal(endBarDragDelta({ x: 469, y: 40 }, systems, areas), 0)
  assert.equal(endBarDragDelta({ x: 470, y: 40 }, systems, areas), 1)
  assert.equal(endBarDragDelta({ x: 679, y: 40 }, systems, areas), 1)
  assert.equal(endBarDragDelta({ x: 680, y: 40 }, systems, areas), 2)
  assert.equal(endBarDragDelta({ x: 244, y: 120 }, systems, areas), 2)
  assert.equal(endBarDragDelta({ x: 245, y: 120 }, systems, areas), 3)
  assert.equal(endBarDragDelta({ x: 244, y: 120 }, systems, areas.slice(1)), 0)
  const wrappedOnly = [{ ...areas[0], edges: [] }, areas[1]]
  assert.equal(endBarDragDelta({ x: 680, y: 40 }, systems, wrappedOnly), 0)
  assert.equal(endBarDragDelta({ x: 245, y: 120 }, systems, wrappedOnly), 1)
})

test("snaps a backward drag to existing measure boundaries, including on an earlier row", () => {
  const row = (y, first, widths) => {
    let x = 48
    return { realBounds: { y, h: 80 }, bars: widths.map((w, i) => {
      const bar = { index: first + i, realBounds: { x, w } }
      x += w
      return bar
    }) }
  }
  const systems = [row(0, 0, [160, 120, 180]), row(80, 3, [180, 180]), row(160, 5, [150, 100])]
  assert.equal(endBarDragDelta({ x: 310, y: 200 }, systems), 0)
  assert.equal(endBarDragDelta({ x: 200, y: 200 }, systems), -1)
  assert.equal(endBarDragDelta({ x: 450, y: 120 }, systems), -2)
  assert.equal(endBarDragDelta({ x: 240, y: 40 }, systems), -6)
  assert.equal(endBarDragDelta({ x: 48, y: -80 }, systems), -6)
  assert.equal(endBarDragDelta({ x: 48, y: 280 }, systems), 0)
})

test("clips clef and time signature glyph boxes to their respective staffs", () => {
  const bar = beats(blankScore())[0].voice.bar
  const staves = [10, 51].map((y, index) => ({
    bar: { ...bar, staff: { ...bar.staff, index } },
    realBounds: { x: 48, y, w: 180, h: 36 },
    beats: [],
  }))
  const sheet = { offsetWidth: 300, offsetHeight: 120, getBoundingClientRect: () => ({
    left: 0, top: 0, width: 300, height: 120,
  }) }
  const glyphs = [
    ["\ue050", 52, -30, 76], ["\ue050", 52, 40, 60],
    ["\ue084", 75, -30, 76], ["\ue084", 75, 40, 60],
  ].map(([textContent, left, top, height]) => ({
    textContent,
    getBoundingClientRect: () => ({ left, right: left + 19, top, bottom: top + height, width: 19, height }),
  }))
  const system = { realBounds: { y: 0, h: 120 }, bars: [{ bars: staves }] }
  const points = scorePoints(sheet, { staffSystems: [system] }, { querySelectorAll: selector => selector === "svg text" ? glyphs : [] })
  assert.deepEqual(points.filter(point => point.kind === "clef").map(point => [point.bar[1], point.rect.y, point.rect.h]),
    [[0, 10, 36], [1, 51, 36]])
  assert.deepEqual(points.filter(point => point.kind === "meter").map(point => [point.bar[1], point.rect]),
    [[0, { x: 75, y: 10, w: 19, h: 36 }], [1, { x: 75, y: 51, w: 19, h: 36 }]])
})

test("score text preserves spelling and punctuation through save and removal", () => {
  const score = blankScore()
  const beat = beats(score)[1]
  const text = "text Dolce & <cantabile>"
  assert.ok(setScoreText(beat, text))
  const saved = reopen(score)
  assert.equal(beats(saved)[1].text, text)
  assert.equal(setScoreText(beats(saved)[1], text), false)
  assert.ok(setScoreText(beats(saved)[1], " "))
  assert.equal(beats(reopen(saved))[1].text, null)
})

test("sets and removes a lyric syllable without overwriting another verse", () => {
  const score = blankScore()
  const [beat, rest] = beats(score)
  assert.equal(setLyric(rest, "la"), false)
  placeNote(beat, 4)
  beat.lyrics = ["Old", "Second verse"]
  assert.ok(setLyric(beat, " Ré- "))
  const saved = reopen(score)
  assert.deepEqual(beats(saved)[0].lyrics, ["Ré-", "Second verse"])
  assert.ok(setLyric(beats(saved)[0], ""))
  assert.deepEqual(beats(reopen(saved))[0].lyrics, ["", "Second verse"])
  assert.equal(setLyric(beats(saved)[2], ""), false)
})

test("adds, edits, and clears the score title and subtitle independently", () => {
  const score = blankScore()
  assert.ok(setHeading(score, "title", "Song & <Dance>"))
  assert.ok(setHeading(score, "subTitle", "First sketch"))
  const saved = reopen(score)
  assert.equal(saved.title, "Song & <Dance>")
  assert.equal(saved.subTitle, "First sketch")
  assert.ok(setHeading(saved, "subTitle", "Second sketch"))
  assert.ok(setHeading(saved, "title", ""))
  const edited = reopen(saved)
  assert.equal(edited.title, "")
  assert.equal(edited.subTitle, "Second sketch")
})

test("a dynamic lasts until the next marking and carries through new rests and notes", () => {
  const score = blankScore()
  score.stylesheet.hideDynamics = true
  const voice = beats(score)
  const choose = (score, index, shortcut) => scoreCompletions(score,
    { point: { kind: "dynamics", address: beatAddress(beats(score)[index]) } }, shortcut, english)[0]
  assert.ok(choose(score, 2, "mf").apply())
  assert.ok(choose(score, 0, "p").apply())
  assert.ok(changeDuration(voice[0], model.Duration.Eighth))
  const split = reopen(score)
  assert.ok(placeNote(beats(split)[1], 4))
  assert.ok(appendMeasure(split))
  const saved = reopen(split)
  assert.deepEqual(beats(saved).map(beat => [beat.dynamics, beat.showDynamics]),
    [[2, true], [2, false], [2, false], [4, true], [4, false]])
  assert.equal(beats(saved)[1].notes[0].dynamics, model.DynamicValue.P)
  assert.ok(beats(saved, 1).every(beat => beat.dynamics === model.DynamicValue.MF))
  assert.ok(choose(saved, 0, "remove dynamic").apply())
  assert.deepEqual(beats(reopen(saved)).map(beat => beat.dynamics), [5, 5, 5, 4, 4])
})

test("hairpins span selected beats across bars and can be removed from either end", () => {
  const score = blankScore()
  appendMeasure(score)
  const saved = reopen(score)
  placeNote(beats(saved)[2], 4)
  placeNote(beats(saved, 1)[0], 2)
  const first = beatAddress(beats(saved)[2])
  const last = beatAddress(beats(saved, 1)[0])
  const context = { point: { kind: "beat", address: last }, group: "passage", passage: { first, last } }
  assert.ok(scoreCompletions(saved, context, "<", english)[0].apply())
  const span = score => [...beats(score), ...beats(score, 1)].map(beat => beat.crescendo)
  assert.deepEqual(span(reopen(saved)), [0, 0, 1, 1, 1, 0, 0, 0])
  assert.ok(scoreCompletions(saved, context, ">", english)[0].apply())
  const changed = reopen(saved)
  assert.deepEqual(span(changed), [0, 0, 2, 2, 2, 0, 0, 0])
  assert.ok(scoreCompletions(changed, { point: { kind: "dynamics", address: last } }, "remove hairpin", english)[0].apply())
  assert.deepEqual(span(reopen(changed)), Array(8).fill(0))
})

test("positions the tempo edit target over the digits alone", () => {
  const bar = beats(blankScore())[0].voice.bar
  const realBounds = { x: 48, y: 20, w: 180, h: 70 }
  const staffSystemBounds = { realBounds, bars: [
    { index: 0, realBounds, bars: [{ bar, realBounds, beats: [] }] },
  ] }
  staffSystemBounds.bars[0].staffSystemBounds = staffSystemBounds
  const sheet = { offsetWidth: 300, offsetHeight: 120, getBoundingClientRect: () => ({
    left: 0, top: 0, width: 300, height: 120,
  }) }
  const position = x => ({ matrixTransform: () => ({ x, y: 20 }) })
  const glyph = {
    textContent: " = 120",
    getBoundingClientRect: () => ({ left: 78, right: 108, top: 12, bottom: 24, width: 30, height: 12 }),
    getScreenCTM: () => ({}),
    getStartPositionOfChar: index => position(78 + index * 5),
    getEndPositionOfChar: index => position(78 + (index + 1) * 5),
  }
  const points = scorePoints(sheet, { staffSystems: [staffSystemBounds] }, { querySelectorAll: selector => selector === "svg text" ? [glyph] : [] })
  const tempo = points.find(point => point.kind === "tempo")
  assert.equal(tempo.digits, "120")
  assert.deepEqual(tempo.rect, { x: 93, y: 12, w: 15, h: 12 })
})

test("copies and pastes a passage across bars without changing existing notes or timing", () => {
  const blank = blankScore()
  appendMeasure(blank)
  appendMeasure(blank)
  const score = reopen(blank)
  const first = beats(score)[3]
  const last = beats(score, 1)[0]
  placeNote(first, 4)
  placeNote(last, 2)
  const selection = passageBetween(beatAddress(last), beatAddress(first))
  const source = readPassage(JSON.stringify(copyPassage(score, selection)))
  const result = editPassage(score, { source, target: beatAddress(beats(score, 1)[3]) })
  const pasted = readScore(result.text)
  assert.deepEqual(result.passage, { first: [0, 0, 1, 0, 3], last: [0, 0, 2, 0, 0] })
  assert.deepEqual([beats(pasted)[3], beats(pasted, 1)[0], beats(pasted, 1)[3], beats(pasted, 2)[0]]
    .map(beat => [writtenPitch(beat.notes[0]), beat.displayStart]),
  [[71, 2880], [74, 0], [71, 2880], [74, 0]])
  assert.notEqual(beats(pasted)[3].notes[0].id, beats(pasted, 1)[3].notes[0].id)
  assert.equal(editPassage(pasted, { source, target: beatAddress(beats(pasted, 1)[3]) }), null)
})

test("moves an overlapping passage at the grabbed beat and fills the source with rests", () => {
  const score = blankScore()
  const voice = beats(score)
  placeNote(voice[0], 4)
  placeNote(voice[1], 2)
  const selection = passageBetween(beatAddress(voice[0]), beatAddress(voice[1]))
  const result = editPassage(score, { selection, grab: selection.last, target: beatAddress(voice[2]) })
  const moved = readScore(result.text)
  assert.deepEqual(beats(moved).map(beat => beat.notes.map(writtenPitch)), [[], [71], [74], []])
  assert.deepEqual(beats(moved).map(beat => beat.displayStart), [0, 960, 1920, 2880])
  const removed = readScore(editPassage(moved, { selection: result.passage }).text)
  assert.ok(beats(removed).every(beat => beat.isRest))
})

test("pastes ties with fresh endpoints and prevents cutting only one side", () => {
  const imported = importMusicXML(fixture)
  appendMeasure(imported)
  const score = reopen(imported)
  const first = beatAddress(beats(score)[3])
  const last = beatAddress(beats(score, 1)[0])
  assert.equal(editPassage(score, { selection: { first, last: first } }), null)
  const selection = { first, last }
  const source = copyPassage(score, selection)
  const pasted = readScore(editPassage(score, { source, target: beatAddress(beats(score, 2)[0]) }).text)
  const origin = beats(pasted, 2)[0].notes[0]
  assert.equal(origin.tieDestination, beats(pasted, 2)[1].notes[0])
  assert.notEqual(origin.id, beats(pasted)[3].notes[0].id)
  const cut = readScore(editPassage(pasted, { selection }).text)
  assert.equal(beats(cut)[3].isRest, true)
  assert.equal(beats(cut, 1)[0].isRest, true)
  assert.equal(beats(cut, 2)[0].notes[0].tieDestination, beats(cut, 2)[1].notes[0])
})
