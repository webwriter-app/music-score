/// <reference types="mocha" />
import "mocha/mocha.js"
import { assert } from "chai"
import { getMochaConfig } from "@webwriter/build/test"
import manifest from "../package.json"
import phraseXml from "./fixtures/phrase.xml"
import practicePhrase from "../snippets/practice-phrase.html"
import bachPrelude from "../snippets/bach-prelude.html"
import guitarTab from "../snippets/guitar-tab.html"
import drumTab from "../snippets/drum-tab.html"
import jianpu from "../snippets/jianpu.html"
import {
  appendMeasure, beatAddress, blankScore, canChangeDuration, changeDuration, changePitch, cycleClef, cycleMeter,
  findNote, exportGuitarPro, exportMidi, importMusicXML, noteAddress, pitchAtStep, placeNote, readScore, removeNote,
  serializeScore, setHeading, setLyric, setScoreText, setTempo, trimMeasures, writtenPitch,
} from "../src/model/score-model"
import type { BeatAddress, NoteAddress } from "../src/model/score-model"
import { applyScoreType, defaultScoreType, scoreScales } from "../src/model/score-notation"
import { playbackInstruments, setPlaybackInstrument } from "../src/model/score-instruments"
import { copyPassage, editPassage, passageBetween, readPassage } from "../src/model/score-passage"
import { appendButtonRect, endBarDragDelta, scorePoints, trackLabelPositions } from "../src/model/score-points"
import { Environment, NotationElement, Settings, io, midi, model, rendering, synth } from "../src/assets/alphatab-core"
import { scoreCompletions } from "../src/components/score-completion"
import type { CompletionContext } from "../src/components/score-completion"
import { messages, optionFor, readerEditingLabel, sizeOption } from "../src/model/messages"

const fixture = new TextEncoder().encode(phraseXml)
const beats = (score: model.Score, bar = 0) => score.tracks[0].staves[0].bars[bar].voices[0].beats
const reopen = (score: model.Score) => readScore(serializeScore(score))
const staff = (score: model.Score) => score.tracks[0].staves[0]
const head = (address: readonly number[]) => address.slice(0, 5) as BeatAddress
// A stand-in for the elements that the message lookup reads.
function languageNode(lang?: string, parentElement: Element | null = null): Element {
  return {
    parentElement,
    getRootNode: () => null,
    hasAttribute: (name: string) => name === "lang" && lang !== undefined,
    getAttribute: (name: string) => name === "lang" ? lang ?? null : null,
  } as unknown as Element
}

const english = messages(languageNode("en"))

mocha.setup(getMochaConfig())

describe("score model", function () {
  it("score messages and drawer choices follow each instance's language", function () {
    const inherited = languageNode(undefined, languageNode("de-CH"))
    const explicitEnglish = languageNode("en-GB", inherited)
    assert.strictEqual(messages(inherited).play, "Abspielen")
    assert.strictEqual(messages(explicitEnglish).play, "Play")
    assert.strictEqual(messages(languageNode("", inherited)).play, "Play")
    assert.strictEqual(optionFor(inherited, sizeOption).options[0].label._, "Kompakt")
    assert.strictEqual(optionFor(explicitEnglish, sizeOption).options[0].label._, "Compact")
    assert.strictEqual(messages(languageNode("fr-CA")).importScore, "Importer du MusicXML")
    assert.strictEqual(optionFor(languageNode("es-419"), sizeOption).label._, "Tamaño")
    assert.strictEqual(readerEditingLabel(languageNode("es-419"))._, "Permitir la edición en modo de lectura")
    assert.strictEqual(readerEditingLabel(explicitEnglish)._, "Allow reader editing")
    assert.strictEqual(optionFor(inherited, sizeOption).label._, "Grösse")
    assert.strictEqual(optionFor(languageNode("constructor"), sizeOption).label._, "Size")
  })

  it("advertised languages translate instrument labels without changing MIDI program IDs", function () {
    const { keywords } = manifest
    const track = blankScore(defaultScoreType).tracks[0]
    const programs = playbackInstruments(track)
    const translatedLabels = ["Bright Piano", "Electric Piano 1", "Rain", "Telephone Ring"]
    const languages = keywords.filter((keyword: string) => keyword.startsWith("widget-lang-"))
      .map((keyword: string) => keyword.slice("widget-lang-".length))
    for (const language of languages) {
      const localized = new Map(playbackInstruments(track, language))
      assert.deepEqual([...localized.keys()], programs.map(([id]) => id), language)
      if (language === "en" || language.startsWith("en-")) continue
      for (const [id, label] of programs) {
        if (translatedLabels.includes(label)) assert.notStrictEqual(localized.get(id), label, `${language}: ${label}`)
      }
    }
  })

  it("completion enters a spelled pitch at the chosen duration without moving later notes", function () {
    const score = blankScore(defaultScoreType)
    const voice = beats(score)
    placeNote(voice[2], 6)
    const at = voice[2].playbackStart
    const context: CompletionContext = { point: { kind: "insert", address: beatAddress(voice[0]) }, step: 8 }
    const [duration] = scoreCompletions(score, context, "/8", english)
    assert.strictEqual(duration.setEntryDuration, true)
    assert.strictEqual(voice[0].duration, model.Duration.Quarter)
    context.duration = duration.duration
    const [pitch] = scoreCompletions(score, context, "b♭3", english)
    assert.strictEqual(pitch.label, "B♭3")
    assert.strictEqual(pitch.advance, true)
    assert.ok(pitch.apply!())
    const stored = beats(reopen(score))
    assert.strictEqual(writtenPitch(stored[0].notes[0]), 58)
    assert.strictEqual(stored[0].notes[0].accidentalMode, model.NoteAccidentalMode.ForceFlat)
    assert.strictEqual(stored[0].duration, model.Duration.Eighth)
    assert.strictEqual(stored[3].playbackStart, at)
  })

  it("completion adds a chord tone and offers only durations that fit the selected beat", function () {
    const score = blankScore(defaultScoreType)
    const voice = beats(score)
    const address = placeNote(voice[0], 10)!
    placeNote(voice[1], 6)
    const context: CompletionContext = { point: { kind: "note", address } }
    assert.strictEqual(scoreCompletions(score, context, "/2", english).length, 0)
    const [chord] = scoreCompletions(score, context, "+g4", english)
    assert.strictEqual(chord.label, "Add G4")
    assert.ok(chord.apply!())
    assert.deepEqual(voice[0].notes.map(writtenPitch), [60, 67])
    assert.strictEqual(scoreCompletions(score, context, "+g4", english).length, 0)
  })

  it("slash values autocomplete notes, rests, standalone durations, and chords", function () {
    const score = blankScore(defaultScoreType)
    const context: CompletionContext = { point: { kind: "insert", address: beatAddress(beats(score)[0]) } }
    const choices = (query: string) => scoreCompletions(score, context, query, english)
    for (const value of [1, 2, 4, 8, 16, 32, 64]) {
      for (const prefix of ["", "a", "a4", "r", "<c4 e4 g4>"]) {
        const options = choices(prefix + "/")
        assert.ok(options.some(choice => choice.shortcut === prefix + "/" + value))
      }
    }
    assert.strictEqual(choices("a'").length, 0)
    assert.strictEqual(choices("a 8").length, 0)
    assert.strictEqual(choices("1/8").length, 0)
    const last: CompletionContext = { point: { kind: "insert", address: beatAddress(beats(score).at(-1)!) } }
    assert.strictEqual(scoreCompletions(score, last, "a/1", english).length, 0)
    assert.strictEqual(choices("a")[0].duration, 4)
    assert.strictEqual(choices("a")[0].shortcut, "a")
    context.duration = 8
    context.dots = 1
    assert.strictEqual(choices("a")[0].duration, 8)
    assert.strictEqual(choices("a")[0].dots, 1)
    assert.ok(choices("").some(choice => choice.pitches?.length === 3))
    const [chord] = choices("<c4 e4 g4>/4")
    assert.strictEqual(chord.shortcut, "<c4 e4 g4>/4")
    assert.ok(chord.apply!())
    assert.deepEqual(beats(reopen(score))[0].notes.map(writtenPitch), [60, 64, 67])
  })

  it("dotted note and rest commands preserve the next onset and survive passage paste", function () {
    const score = blankScore(defaultScoreType)
    placeNote(beats(score)[1], 8)
    const point = { kind: "insert", address: beatAddress(beats(score)[0]) }
    const [note] = scoreCompletions(score, { point }, "a4/64..", english)
    assert.ok(note.apply!())
    const stored = reopen(score)
    const voice = beats(stored)
    assert.strictEqual(voice[0].dots, 2)
    assert.strictEqual(voice[0].displayDuration, 105)
    assert.strictEqual(voice.find(beat => beat.notes.some(note => writtenPitch(note) !== 69))!.displayStart, 960)
    const fragment = copyPassage(stored, passageBetween(point.address, point.address))
    const pasted = editPassage(stored, { source: fragment, target: beatAddress(voice.at(-1)!) })
    assert.ok(pasted)
    const pastedBeat = beats(readScore(pasted.text))[pasted.passage!.first[4]]
    assert.strictEqual(pastedBeat.dots, 2)
    assert.strictEqual(pastedBeat.displayDuration, 105)

    const restScore = blankScore(defaultScoreType)
    const [rest] = scoreCompletions(restScore, { point }, "r/8.", english)
    assert.strictEqual(rest.shortcut, "r/8.")
    assert.ok(rest.apply!())
    const rests = beats(reopen(restScore))
    assert.strictEqual(rests[0].displayDuration, 720)
    assert.strictEqual(rests[0].dots, 1)
    assert.strictEqual(rests[0].isRest, true)
    assert.strictEqual(rests[1].displayStart, 720)
  })

  it("a combined pitch and duration edit fits before it changes either value", function () {
    const score = blankScore(defaultScoreType)
    const voice = beats(score)
    const address = placeNote(voice[0], 10)!
    placeNote(voice[1], 6)
    const context: CompletionContext = { point: { kind: "note", address } }
    assert.strictEqual(scoreCompletions(score, context, "a4/4.", english).length, 0)
    const [choice] = scoreCompletions(score, context, "a4/8.", english)
    assert.ok(choice.apply!())
    const saved = beats(reopen(score))
    assert.strictEqual(writtenPitch(saved[0].notes[0]), 69)
    assert.strictEqual(saved[0].dots, 1)
    assert.strictEqual(saved[2].displayStart, 960)
  })

  it("completion can enter a note in an imported whole-measure rest with a shorter time signature", function () {
    const score = importMusicXML(new TextEncoder().encode(`<?xml version="1.0"?>
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
    assert.strictEqual(beat.duration, model.Duration.Whole)
    assert.strictEqual(beat.displayDuration, 2880)
    const context: CompletionContext = { point: { kind: "insert", address: beatAddress(beat) } }
    const [pitch] = scoreCompletions(score, context, "c4", english)
    assert.ok(pitch.apply!())
    const stored = beats(reopen(score))
    assert.deepEqual(stored.map(beat => beat.duration), [model.Duration.Quarter, model.Duration.Half])
    assert.strictEqual(writtenPitch(stored[0].notes[0]), 60)
  })

  it("completion directly chooses a clef and a compatible time signature", function () {
    const score = blankScore(defaultScoreType)
    appendMeasure(score)
    const [bass] = scoreCompletions(score, { point: { kind: "clef", bar: [0, 0, 0] } }, "bass", english)
    assert.ok(bass.apply!())
    assert.deepEqual(staff(score).bars.map(bar => bar.clef), [model.Clef.F4, model.Clef.F4])
    placeNote(beats(score)[2], 5)
    const context: CompletionContext = { point: { kind: "meter", measure: 0 } }
    assert.strictEqual(scoreCompletions(score, context, "2/4", english).length, 0)
    const [meter] = scoreCompletions(score, context, "3/4", english)
    assert.ok(meter.apply!())
    assert.deepEqual(score.masterBars.map(bar => bar.timeSignatureNumerator), [3, 3])
  })

  it("key autocomplete offers every major and minor signature from a blank measure", function () {
    const score = blankScore(defaultScoreType)
    const address = beatAddress(beats(score)[0])
    const context: CompletionContext = { point: { kind: "insert", address } }
    const choices = (query: string) => scoreCompletions(score, context, query, english)
    assert.ok(choices("").some(choice => choice.shortcut === "key" && choice.openKey))
    assert.strictEqual(choices("key").filter(choice => !choice.openKey).length, 30)
    const [flat] = choices("key B♭ major")
    assert.strictEqual(flat.signature, -2)
    assert.ok(flat.apply!())
    const [b] = choices("b4")
    assert.strictEqual(b.label, "B♭4")
    const [sharp] = choices("key f# minor")
    assert.strictEqual(sharp.signature, 3)
    assert.ok(sharp.apply!())
    const [stored] = staff(reopen(score)).bars
    assert.strictEqual(stored.keySignature, 3)
    assert.strictEqual(stored.keySignatureType, model.KeySignatureType.Minor)
  })

  it("passage autocomplete joins, splits, and resets beams without changing the music", function () {
    let score = blankScore(defaultScoreType)
    for (let index = 0; index < 4; index++) {
      const point = { kind: "insert", address: beatAddress(beats(score)[index]) }
      const [choice] = scoreCompletions(score, { point }, "c4/8", english)
      assert.ok(choice.apply!())
      score = reopen(score)
    }
    const voice = beats(score)
    const passage = passageBetween(beatAddress(voice[1]), beatAddress(voice[2]))
    const context: CompletionContext = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
    const choices = (query: string) => scoreCompletions(score, context, query, english)
    const timing = voice.map(beat => [beat.displayStart, beat.displayDuration, beat.notes.map(writtenPitch)])
    const { Auto, ForceMergeWithNext: Join, ForceSplitToNext: Split } = model.BeatBeamingMode
    const modes = () => beats(reopen(score)).slice(0, 4).map(beat => beat.beamingMode)
    assert.deepEqual(choices("").filter(choice => choice.beam).map(choice => choice.shortcut), ["beam", "unbeam", "beam auto"])
    assert.ok(choices("split beam")[0].apply!())
    assert.deepEqual(modes(), [Auto, Split, Auto, Auto])
    assert.ok(choices("beam")[0].apply!())
    assert.deepEqual(modes(), [Split, Join, Split, Auto])
    assert.ok(choices("beam auto")[0].apply!())
    assert.deepEqual(modes(), [Auto, Auto, Auto, Auto])
    assert.deepEqual(beats(reopen(score)).map(beat => [beat.displayStart, beat.displayDuration, beat.notes.map(writtenPitch)]), timing)
  })

  it("beaming choices require adjacent short notes in the same measure", function () {
    const score = blankScore(defaultScoreType)
    appendMeasure(score)
    assert.ok(changeDuration(beats(score)[3], model.Duration.Eighth))
    const ready = reopen(score)
    const first = head(placeNote(beats(ready)[4], 4)!)!
    const secondBeat = beats(ready, 1)[0]
    const [choice] = scoreCompletions(ready, { point: { kind: "insert", address: beatAddress(secondBeat) } }, "g4/8", english)
    const last = head(choice.apply!() as NoteAddress)
    const context: CompletionContext = { point: { kind: "beat", address: last! }, group: "passage", passage: passageBetween(first, last) }
    assert.strictEqual(scoreCompletions(reopen(ready), context, "", english).some(choice => choice.beam), false)
  })

  it("tie autocomplete connects matching chord tones and removes one link without breaking the chain", function () {
    let score = blankScore(defaultScoreType)
    for (const [index, token] of ["<c4 e4>/4", "<c4 g4>/4", "c4/4", "g4/4"].entries()) {
      const point = { kind: "insert", address: beatAddress(beats(score)[index]) }
      assert.ok(scoreCompletions(score, { point }, token, english)[0].apply!())
      score = reopen(score)
    }
    const passage = passageBetween(beatAddress(beats(score)[0]), beatAddress(beats(score)[3]))
    const context: CompletionContext = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
    assert.ok(scoreCompletions(score, context, "tie", english)[0].apply!())
    score = reopen(score)
    const [first, second, third, last] = beats(score).map(beat => beat.notes)
    assert.strictEqual(first[0].tieDestination, second[0])
    assert.strictEqual(second[0].tieDestination, third[0])
    assert.strictEqual(first[1].tieDestination, null)
    assert.strictEqual(last[0].tieOrigin, null)
    assert.deepEqual(beats(score).map(beat => beat.notes.map(writtenPitch)), [[60, 64], [60, 67], [60], [67]])

    const selected: CompletionContext = { point: { kind: "note", address: noteAddress(first[0]) } }
    assert.ok(scoreCompletions(score, selected, "untie", english)[0].apply!())
    const stored = beats(reopen(score))
    assert.strictEqual(stored[0].notes[0].tieDestination, null)
    assert.strictEqual(stored[1].notes[0].isTieDestination, false)
    assert.strictEqual(stored[1].notes[0].tieDestination, stored[2].notes[0])
  })

  it("slur autocomplete spans a phrase across measures and removes both endpoints", function () {
    const blank = blankScore(defaultScoreType)
    appendMeasure(blank)
    let score = reopen(blank)
    const first = placeNote(beats(score)[3], 10)!
    const last = placeNote(beats(score, 1)[1], 6)!
    score = reopen(score)
    const passage = passageBetween(head(first!), head(last!))
    const context: CompletionContext = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
    assert.strictEqual(scoreCompletions(score, context, "tie", english).length, 0)
    assert.ok(scoreCompletions(score, context, "slur", english)[0].apply!())
    score = reopen(score)
    const origin = findNote(score, first)
    const destination = findNote(score, last)
    assert.strictEqual(origin!.slurDestination, destination)
    assert.strictEqual(destination!.slurOrigin, origin)
    assert.strictEqual(destination!.isSlurDestination, true)
    const fragment = copyPassage(score, { first: passage.last, last: passage.last, note: last![5] })
    assert.strictEqual(fragment!.beats[0].data.notes![0].isslurdestination, false)
    assert.strictEqual(fragment!.beats[0].data.notes![0].sluroriginnoteid, undefined)

    const selected: CompletionContext = { point: { kind: "note", address: last! } }
    assert.ok(scoreCompletions(score, selected, "unslur", english)[0].apply!())
    score = reopen(score)
    assert.strictEqual(findNote(score, first)!.slurDestination, null)
    assert.strictEqual(findNote(score, last)!.isSlurDestination, false)
  })

  it("ties can cross a barline between adjacent matching notes", function () {
    const blank = blankScore(defaultScoreType)
    appendMeasure(blank)
    let score = reopen(blank)
    const first = placeNote(beats(score)[3], 10)!
    const last = placeNote(beats(score, 1)[0], 10)!
    score = reopen(score)
    const passage = passageBetween(head(first!), head(last!))
    const context: CompletionContext = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
    assert.ok(scoreCompletions(score, context, "tie", english)[0].apply!())
    score = reopen(score)
    assert.strictEqual(findNote(score, first)!.tieDestination, findNote(score, last))
  })

  it("triplet autocomplete turns three equal rests into fillable tuplet slots without shifting later notes", function () {
    const score = blankScore(defaultScoreType)
    const following = placeNote(beats(score)[3], 10)!
    const pitch = writtenPitch(findNote(score, following)!)
    const passage = passageBetween(beatAddress(beats(score)[0]), beatAddress(beats(score)[2]))
    const context: CompletionContext = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
    const [choice] = scoreCompletions(score, context, "tuplet 3:2", english)
    assert.strictEqual(choice.shortcut, "triplet")
    assert.ok(choice.apply!())
    const saved = reopen(score)
    const voice = beats(saved)
    assert.deepEqual(voice.slice(0, 3).map(beat => beat.displayDuration), [640, 640, 640])
    assert.strictEqual(voice[0].tupletGroup!.beats.length, 3)
    assert.strictEqual(voice[0].tupletGroup!.isFull, true)
    assert.strictEqual(voice.at(-1)!.displayStart, 2880)
    assert.strictEqual(writtenPitch(voice.at(-1)!.notes[0]), pitch)
    const point = { kind: "insert", address: beatAddress(voice[1]) }
    assert.ok(scoreCompletions(saved, { point }, "e4", english)[0].apply!())
    assert.strictEqual(beats(reopen(saved))[1].displayDuration, 640)
    assert.strictEqual(writtenPitch(beats(reopen(saved))[1].notes[0]), 64)
  })

  it("a septuplet distributes fractional ticks and renders as one full group", function () {
    let score = blankScore(defaultScoreType)
    for (let index = 0; index < 8; index++) {
      const point = { kind: "insert", address: beatAddress(beats(score)[index]) }
      assert.ok(scoreCompletions(score, { point }, "c4/16", english)[0].apply!())
      score = reopen(score)
    }
    const voice = beats(score)
    const passage = passageBetween(beatAddress(voice[0]), beatAddress(voice[6]))
    const context: CompletionContext = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
    const [choice] = scoreCompletions(score, context, "tuplet 7:4", english)
    assert.ok(choice.apply!())
    const stored = beats(reopen(score))
    assert.strictEqual(stored[0].tupletGroup!.isFull, true)
    assert.strictEqual(stored[0].tupletGroup!.beats.length, 7)
    assert.strictEqual(stored.slice(0, 7).reduce((total, beat) => total + beat.displayDuration, 0), 960)
    assert.strictEqual(stored.find(beat => !beat.isRest && !beat.hasTuplet)!.displayStart, 1680)
  })

  it("grace autocomplete inserts pitches before the selected note and keeps the following onset", function () {
    const score = blankScore(defaultScoreType)
    const address = placeNote(beats(score)[0], 10)!
    placeNote(beats(score)[1], 8)
    const context: CompletionContext = { point: { kind: "note", address } }
    assert.ok(scoreCompletions(score, context, "", english).some(choice => choice.openGrace))
    const [choice] = scoreCompletions(score, context, "grace g#4 a4", english)
    const selected = choice.apply!()
    const saved = reopen(score)
    const voice = beats(saved)
    assert.deepEqual(voice.slice(0, 2).map(beat => writtenPitch(beat.notes[0])), [68, 69])
    assert.strictEqual(voice[0].graceType, model.GraceType.OnBeat)
    assert.strictEqual(voice[0].displayDuration, 0)
    assert.strictEqual(findNote(saved, selected as NoteAddress), voice[2].notes[0])
    assert.strictEqual(voice[2].playbackStart, 120)
    assert.strictEqual(voice[2].displayStart, 0)
    assert.strictEqual(voice[3].playbackStart, 960)
    assert.strictEqual(voice[3].displayStart, 960)
  })

  it("articulation autocomplete applies to a passage and removes from a single chord tone", function () {
    const score = blankScore(defaultScoreType)
    const voice = beats(score)
    const first = placeNote(voice[0], 10)!
    placeNote(voice[0], 6)
    placeNote(voice[1], 8)
    placeNote(voice[2], 7)
    let saved = reopen(score)
    const passage = passageBetween(beatAddress(beats(saved)[0]), beatAddress(beats(saved)[1]))
    const range: CompletionContext = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
    const note: CompletionContext = { point: { kind: "note", address: first! } }
    const choose = (context: CompletionContext, shortcut: string) => scoreCompletions(saved, context, shortcut, english).find(choice => choice.shortcut === shortcut)
    assert.deepEqual(scoreCompletions(saved, { ...range, marksMenu: true }, "", english).map(choice => choice.shortcut),
      ["staccato", "tenuto", "accent", "trill", "turn", "fermata"])
    assert.ok(choose(range, "staccato")!.apply!())
    assert.ok(choose(range, "accent")!.apply!())
    assert.ok(choose(note, "remove staccato")!.apply!())
    assert.ok(choose(note, "tenuto")!.apply!())
    saved = reopen(saved)
    assert.deepEqual(beats(saved).slice(0, 3).map(beat => beat.notes.map(note => note.isStaccato)), [[false, true], [true], [false]])
    const { None, Normal, Tenuto } = model.AccentuationType
    assert.deepEqual(beats(saved).slice(0, 3).map(beat => beat.notes.map(note => note.accentuated)), [[Tenuto, Normal], [Normal], [None]])
    assert.ok(choose(range, "remove accent")!.apply!())
    assert.strictEqual(findNote(saved, first)!.accentuated, Tenuto)
    assert.ok(choose(note, "remove tenuto")!.apply!())
    assert.strictEqual(findNote(reopen(saved), first)!.accentuated, None)
  })

  it("fermata autocomplete persists and removes marks at the selected beat onsets", function () {
    let score = blankScore(defaultScoreType)
    const first = placeNote(beats(score)[1], 10)!
    placeNote(beats(score)[1], 6)
    const last = placeNote(beats(score)[2], 8)!
    score = reopen(score)
    const passage = passageBetween(head(first!), head(last!))
    const context: CompletionContext = { point: { kind: "beat", address: passage.last }, group: "passage", passage }
    assert.ok(scoreCompletions(score, context, "fermata", english)[0].apply!())
    score = reopen(score)
    assert.deepEqual([...score.masterBars[0].fermata!.keys()], [960, 1920])
    assert.strictEqual(beats(score)[1].fermata!.type, model.FermataType.Medium)
    const [remove] = scoreCompletions(score, { point: { kind: "note", address: first! } }, "remove fermata", english)
    assert.ok(remove.apply!())
    score = reopen(score)
    assert.strictEqual(beats(score)[1].fermata, null)
    assert.strictEqual(beats(score)[2].fermata!.type, model.FermataType.Medium)
    assert.ok(scoreCompletions(score, context, "remove fermata", english)[0].apply!())
    assert.strictEqual(reopen(score).masterBars[0].fermata, null)
  })

  it("trill and turn choices persist, replace one another, and can be removed", function () {
    let score = blankScore(defaultScoreType)
    const address = placeNote(beats(score)[0], 10)!
    score = reopen(score)
    const context: CompletionContext = { point: { kind: "note", address } }
    const choose = (shortcut: string) => scoreCompletions(score, context, shortcut, english).find(choice => choice.shortcut === shortcut)
    assert.ok(choose("trill")!.apply!())
    score = reopen(score)
    assert.strictEqual(findNote(score, address)!.trillValue, 62)
    assert.strictEqual(findNote(score, address)!.isTrillStart, true)
    assert.ok(changePitch(findNote(score, address)!, 2))
    assert.strictEqual(findNote(score, address)!.trillValue, 64)
    assert.ok(choose("turn")!.apply!())
    score = reopen(score)
    assert.strictEqual(findNote(score, address)!.trillValue, -1)
    assert.strictEqual(findNote(score, address)!.ornament, model.NoteOrnament.Turn)
    assert.ok(choose("remove turn")!.apply!())
    assert.ok(choose("trill")!.apply!())
    assert.ok(choose("remove trill")!.apply!())
    const note = findNote(reopen(score), address)
    assert.strictEqual(note!.isTrill, false)
    assert.strictEqual(note!.isTrillStart, false)
    assert.strictEqual(note!.ornament, model.NoteOrnament.None)
  })

  it("key editing keeps pitches, updates matching staves, and stops at an existing key change", function () {
    const score = snippetScore("bach-prelude")
    const [upper, lower] = score.tracks[0].staves
    upper.bars[3].keySignature = model.KeySignature.G
    lower.bars[2].keySignature = model.KeySignature.D
    const note = upper.bars[1].voices[0].beats.find(beat => beat.notes.length)!.notes[0]
    const pitch = writtenPitch(note)
    const context: CompletionContext = { point: { kind: "key", bar: [0, 0, 1] } }
    const [choice] = scoreCompletions(score, context, "bb major", english)
    assert.ok(choice.apply!())
    const [editedUpper, editedLower] = reopen(score).tracks[0].staves
    assert.deepEqual(editedUpper.bars.slice(0, 4).map(bar => bar.keySignature), [0, -2, -2, 1])
    assert.deepEqual(editedLower.bars.slice(0, 4).map(bar => bar.keySignature), [0, -2, 2, 0])
    assert.strictEqual(writtenPitch(editedUpper.bars[1].voices[0].beats[note.beat.index].notes[0]), pitch)
  })

  const snippets: Record<string, string> = { "practice-phrase": practicePhrase, "bach-prelude": bachPrelude, "guitar-tab": guitarTab, "drum-tab": drumTab, jianpu }
  function snippetScore(name: string, type?: string) {
    const html = snippets[name]
    const block = html.match(/^<webwriter-music-score(?: type="([^"]+)")?>\s*<script type="application\/json" slot="data" data-music-score>([^<]+)<\/script>/)
    assert.ok(block)
    assert.strictEqual(block[1], type)
    return readScore(block[2])
  }

  it("imports MusicXML and preserves ties, repeat groups and tempo through document storage", function () {
    const score = reopen(importMusicXML(fixture))
    assert.strictEqual(score.title.replace(/\s/g, " "), "Practice phrase")
    assert.strictEqual(writtenPitch(beats(score)[0].notes[0]), 60)
    assert.strictEqual(beats(score)[3].notes[0].tieDestination, beats(score, 1)[0].notes[0])
    assert.strictEqual(score.masterBars[0].repeatGroup, score.masterBars[1].repeatGroup)
    assert.strictEqual(score.masterBars[1].repeatCount, 2)
    assert.strictEqual(score.masterBars[0].tempoAutomations[0].value, 112)
  })

  it("the practice phrase export contains the example as authored score data", function () {
    const score = snippetScore("practice-phrase")
    assert.strictEqual(score.masterBars.length, 2)
    assert.strictEqual(writtenPitch(beats(score)[0].notes[0]), 60)
    assert.strictEqual(beats(score)[3].notes[0].tieDestination, beats(score, 1)[0].notes[0])
  })

  it("the Bach prelude snippet includes the complete piano score", function () {
    const score = snippetScore("bach-prelude")
    const [treble, bass] = score.tracks[0].staves
    assert.strictEqual(score.title.replace(/\s/g, " "), "Prelude in C major, BWV 846")
    assert.strictEqual(score.masterBars.length, 35)
    assert.strictEqual(score.tempo, 60)
    assert.deepEqual(treble.bars[0].voices[0].beats.slice(1, 4).map(beat => writtenPitch(beat.notes[0])), [67, 72, 76])
    const bassVoice = bass.bars[0].voices[0].beats
    assert.strictEqual(bassVoice[1].notes[0].tieDestination, bassVoice[2].notes[0])
    assert.deepEqual(treble.bars.at(-1)!.voices[0].beats[0].notes.map(writtenPitch), [64, 67, 72])
  })

  it("appends editable measures to both Bach staves and keeps the lower staff's secondary voice", function () {
    const score = snippetScore("bach-prelude")
    for (const amount of [1, 2]) {
      const before = score.masterBars.length
      assert.ok(appendMeasure(score, amount))
      const [treble, bass] = score.tracks[0].staves
      assert.ok(treble.bars.slice(before).every(bar => bar.voices.length === 1))
      assert.ok(bass.bars.slice(before).every(bar => bar.voices.length === 2 && bar.voices[1].isEmpty))
    }
    const saved = reopen(score)
    assert.strictEqual(saved.masterBars.length, 38)
    for (const staff of saved.tracks[0].staves) {
      assert.ok(staff.bars.slice(35).every(bar =>
        bar.voices[0].beats.length === 4 && bar.voices[0].beats.every(beat => beat.isRest && !beat.isEmpty)))
    }
    const bass = saved.tracks[0].staves[1]
    assert.strictEqual(bass.bars[34].voices[1].beats.at(-1)!.nextBeat, bass.bars[35].voices[1].beats[0])
  })

  it("reopens a Bach score saved by the old single-voice append", function () {
    const score = snippetScore("bach-prelude")
    const bass = score.tracks[0].staves[1]
    const ending = bass.bars[34].voices[1].beats[0].notes.map(writtenPitch)
    assert.ok(appendMeasure(score, 2))
    // Reproduce the two trailing bars written by the old append code.
    for (const bar of bass.bars.slice(35)) bar.voices.splice(1)

    const recovered = reopen(score)
    const restoredBass = recovered.tracks[0].staves[1]
    assert.strictEqual(recovered.masterBars.length, 37)
    assert.deepEqual(restoredBass.bars[34].voices[1].beats[0].notes.map(writtenPitch), ending)
    assert.ok(restoredBass.bars.slice(35).every(bar => bar.voices.length === 2 && bar.voices[1].beats[0].isEmpty))
    assert.ok(appendMeasure(recovered))
    assert.strictEqual(reopen(recovered).masterBars.length, 38)
  })

  it("alternate notation snippets contain playable examples for their selected type", function () {
    const guitar = snippetScore("guitar-tab", "guitar-tab")
    assert.strictEqual(applyScoreType(guitar, "guitar-tab"), false)
    assert.strictEqual(staff(guitar).showTablature, true)
    assert.strictEqual(staff(guitar).showStandardNotation, false)
    assert.ok(beats(guitar)[0].notes[0].isStringed)

    const drums = snippetScore("drum-tab", "drum-tab")
    assert.strictEqual(applyScoreType(drums, "drum-tab"), false)
    assert.strictEqual(staff(drums).showTablature, true)
    assert.strictEqual(staff(drums).isPercussion, true)
    assert.strictEqual(drums.tracks[0].playbackInfo.primaryChannel, 9)
    assert.strictEqual(beats(drums)[0].notes.length, 2)

    const jianpu = snippetScore("jianpu", "jianpu")
    assert.strictEqual(applyScoreType(jianpu, "jianpu"), false)
    assert.strictEqual(staff(jianpu).showNumbered, true)
    assert.strictEqual(staff(jianpu).showStandardNotation, false)
  })

  it("instrument autocomplete saves a whole part's sound without changing its notation or another part", function () {
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
    const context: CompletionContext = { point: { kind: "instrument", trackIndex: 0 } }
    assert.strictEqual(scoreCompletions(score, context, "", english).length, 128)
    assert.strictEqual(scoreCompletions(score, context, "", english)[0].current, true)
    const [choice] = scoreCompletions(score, context, "flute", english)
    assert.strictEqual(choice.label, "Flute")
    assert.strictEqual(scoreCompletions(score, context, "acoustic grand piano", english)[0].label, "Grand Piano")
    assert.strictEqual(scoreCompletions(score, context, "74", english)[0].label, "Flute")
    assert.ok(choice.apply!())
    const saved = reopen(score)
    assert.strictEqual(saved.tracks[0].playbackInfo.program, 73)
    assert.strictEqual(saved.tracks[1].playbackInfo.program, 40)
    assert.notStrictEqual(saved.tracks[0].playbackInfo.primaryChannel, saved.tracks[1].playbackInfo.primaryChannel)
    assert.strictEqual(saved.tracks[0].name, piano.name)
    assert.deepEqual(saved.tracks[0].staves.map(staff => staff.bars[0].clef), piano.staves.map(staff => staff.bars[0].clef))
    assert.deepEqual(beats(saved)[0].automations.map(automation => automation.type), [Volume, Instrument])
    assert.strictEqual(beats(saved)[0].getAutomation(Instrument)!.value, 73)
    applyScoreType(saved, "jianpu")
    assert.strictEqual(saved.tracks[0].playbackInfo.program, 73)
  })

  it("loads the selected drum kit on a separate playback channel", async function () {
    const score = snippetScore("drum-tab", "drum-tab")
    const [drums] = score.tracks
    const other = blankScore("drum-tab").tracks[0]
    score.addTrack(other)
    const context: CompletionContext = { point: { kind: "instrument", trackIndex: 0 } }
    assert.deepEqual(scoreCompletions(score, context, "", english).map(choice => choice.label),
      ["Standard Kit", "Room Kit", "Jazz Kit", "Brush Kit"])
    assert.ok(setPlaybackInstrument(drums, 40))
    assert.strictEqual(drums.playbackInfo.bank, 128)
    assert.notStrictEqual(drums.playbackInfo.primaryChannel, 9)
    assert.strictEqual(other.playbackInfo.program, 0)

    const file = new midi.MidiFile()
    const handler = new midi.AlphaSynthMidiFileHandler(file)
    new midi.MidiFileGenerator(reopen(score), new Settings(), handler).generate()
    assert.ok(file.events.some(event => event.type === midi.MidiEventType.ProgramChange
      && (event as midi.ProgramChangeEvent).channel === drums.playbackInfo.primaryChannel && (event as midi.ProgramChangeEvent).program === 40))
    const options = new synth.AudioExportOptions()
    options.soundFonts = [new Uint8Array(await (await fetch(new URL("../vendor/soundfont/sonivox.sf2", import.meta.url))).arrayBuffer())]
    const event = { on() {} } as never
    const output = { sampleRate: 44100, ready: event, sampleRequest: event, samplesPlayed: event, open() {} } as unknown as synth.ISynthOutput
    const player = new synth.AlphaSynth(output, 100)
    const audio = player.exportAudio(options, file, [], new Map()).render(160)
    assert.ok(audio!.samples.some(sample => Math.abs(sample) > 0.0001))
  })

  it("guitar tab derives fingerings without changing pitches or separating tied notes", function () {
    const score = importMusicXML(fixture)
    const notes = score.masterBars.flatMap((_, index) => beats(score, index).flatMap(beat => beat.notes))
    const pitches = notes.map(note => note.realValue)
    assert.strictEqual(applyScoreType(score, "guitar-tab"), false)
    assert.deepEqual(notes.map(note => note.realValue), pitches)
    assert.ok(notes.every(note => note.isStringed))
    assert.strictEqual(beats(score)[3].notes[0].string, beats(score, 1)[0].notes[0].string)
  })

  it("standard staff remains the default and is the fallback for pitched parts in drum tab", function () {
    const score = importMusicXML(fixture)
    assert.strictEqual(applyScoreType(score, "drum-tab"), true)
    assert.strictEqual(staff(score).showStandardNotation, true)
    assert.strictEqual(staff(score).showTablature, false)
    applyScoreType(score, "jianpu")
    assert.strictEqual(applyScoreType(score, defaultScoreType), false)
    assert.strictEqual(staff(score).showStandardNotation, true)
    assert.strictEqual(staff(score).showNumbered, false)
  })

  it("persists pitch and duration, consumes a rest, and leaves later onsets in place", function () {
    const score = importMusicXML(fixture)
    const note = beats(score)[0].notes[0]
    const address = noteAddress(note)
    const nextOnset = beats(score)[2].displayStart
    assert.strictEqual(changePitch(note, 1), true)
    assert.strictEqual(changeDuration(note.beat, 2), true)
    const restored = reopen(score)
    const edited = findNote(restored, address)
    assert.strictEqual(writtenPitch(edited!), 61)
    assert.strictEqual(edited!.beat.duration, 2)
    assert.strictEqual(edited!.beat.playbackDuration, 1920)
    assert.strictEqual(beats(restored)[1].displayStart, nextOnset)
    assert.strictEqual(beats(restored)[2].notes[0].tieDestination, beats(restored, 1)[0].notes[0])
  })

  it("shortening leaves rests that can be reclaimed by a later edit", function () {
    const score = importMusicXML(fixture)
    const beat = beats(score)[0]
    assert.strictEqual(changeDuration(beat, 16), true)
    const restored = reopen(score)
    assert.deepEqual(beats(restored).slice(0, 4).map(beat => [beat.duration, beat.isRest]),
      [[16, false], [8, true], [16, true], [4, true]])
    assert.strictEqual(changeDuration(beats(restored)[0], 2), true)
    assert.deepEqual(beats(reopen(restored)).map(beat => beat.duration), [2, 4, 4])
  })

  it("rejects changes that would overlap a note or break a tie", function () {
    const score = importMusicXML(fixture)
    const before = serializeScore(score)
    assert.strictEqual(canChangeDuration(beats(score)[0], 1), false)
    assert.strictEqual(changeDuration(beats(score)[2], 2), false)
    assert.strictEqual(changeDuration(beats(score)[3], 8), false)
    assert.strictEqual(changePitch(beats(score, 1)[0].notes[0], 1), false)
    assert.strictEqual(serializeScore(score), before)
  })

  it("rejects invalid imports and escapes script markup in saved score text", function () {
    assert.throws(() => importMusicXML(new TextEncoder().encode("<html>not a score</html>")))
    assert.throws(() => importMusicXML(new TextEncoder().encode("<score-partwise/>")))
    const score = importMusicXML(fixture)
    score.title = "</script><p>title</p>"
    const text = serializeScore(score)
    assert.ok(!text.includes("<"))
    assert.strictEqual(readScore(text).title, score.title)
  })

  it("blank score starts with one editable measure and accepts notes at staff positions", function () {
    const score = blankScore()
    assert.strictEqual(score.masterBars.length, 1)
    assert.strictEqual(beats(score).length, 4)
    assert.ok(beats(score).every(beat => beat.isRest))
    const beat = beats(score)[0]
    assert.strictEqual(pitchAtStep(beat, 4), 71)
    const address = placeNote(beat, 4)!
    const chordTone = placeNote(beat, 2)!
    const saved = reopen(score)
    assert.strictEqual(writtenPitch(findNote(saved, address)!), 71)
    assert.strictEqual(writtenPitch(findNote(saved, chordTone)!), 74)
    assert.strictEqual(placeNote(beats(saved)[0], 4), null)
    assert.strictEqual(removeNote(findNote(saved, chordTone)!), true)
    assert.strictEqual(removeNote(findNote(saved, address)!), true)
    assert.strictEqual(beats(reopen(saved))[0].isRest, true)
  })

  it("places a note inside a long rest and changes its duration without moving the next beat", function () {
    const blank = blankScore()
    assert.strictEqual(appendMeasure(blank), true)
    const score = reopen(blank)
    assert.strictEqual(cycleMeter(score, 0), true)
    const saved = reopen(score)
    const voice = beats(saved, 1)
    assert.strictEqual(voice.length, 2)
    assert.strictEqual(voice[0].duration, 2)
    const address = placeNote(voice[0], 4, 0.8)!
    const edited = reopen(saved)
    const note = findNote(edited, address)
    assert.strictEqual(note!.beat.displayStart, 960)
    assert.strictEqual(changeDuration(note!.beat, 8), true)
    assert.strictEqual(beats(reopen(edited), 1).at(-1)!.displayStart, 1920)
  })

  it("score points can change clef, meter and tempo and add a measure", function () {
    const score = blankScore()
    const bar = beats(score)[0].voice.bar
    assert.strictEqual(cycleClef(bar), true)
    assert.strictEqual(pitchAtStep(beats(score)[0], 4), 50)
    assert.strictEqual(cycleMeter(score, 0), true)
    assert.strictEqual(setTempo(score.masterBars[0], 96), true)
    assert.strictEqual(appendMeasure(score), true)
    const saved = reopen(score)
    assert.strictEqual(saved.masterBars.length, 2)
    assert.strictEqual(saved.tempo, 96)
    assert.ok(saved.masterBars.every(measure => measure.timeSignatureNumerator === 3))
    assert.strictEqual(beats(saved, 1)[0].voice.bar.clef, bar.clef)
  })

  it("appends a batch of measures with the last meter, clef and key", function () {
    const score = blankScore()
    const bar = beats(score)[0].voice.bar
    cycleClef(bar)
    bar.keySignature = 2
    assert.strictEqual(cycleMeter(score, 0), true)
    assert.strictEqual(appendMeasure(score, 0), false)
    assert.strictEqual(appendMeasure(score, 3), true)
    const saved = reopen(score)
    assert.strictEqual(saved.masterBars.length, 4)
    for (const measure of saved.masterBars.slice(1)) {
      const voice = beats(saved, measure.index)
      assert.strictEqual(measure.timeSignatureNumerator, 3)
      assert.strictEqual(voice[0].voice.bar.clef, bar.clef)
      assert.strictEqual(voice[0].voice.bar.keySignature, 2)
      assert.strictEqual(voice.length, 3)
      assert.ok(voice.every(beat => beat.isRest))
    }
  })

  it("trims trailing measures and severs note links into the removed part", function () {
    const score = reopen(importMusicXML(fixture))
    const tie = beats(score)[3].notes[0]
    assert.strictEqual(tie.tieDestination, beats(score, 1)[0].notes[0])
    assert.strictEqual(trimMeasures(score, 0), false)
    assert.strictEqual(trimMeasures(score, 1), true)
    assert.strictEqual(tie.tieDestination, null)
    assert.strictEqual(score.masterBars[0].nextMasterBar, null)
    const saved = reopen(score)
    assert.strictEqual(saved.masterBars.length, 1)
    assert.strictEqual(staff(saved).bars.length, 1)
    assert.strictEqual(saved.tempo, 112)
    assert.strictEqual(writtenPitch(beats(saved)[3].notes[0]), 67)
    assert.strictEqual(beats(saved)[3].notes[0].isTieOrigin, false)
  })

  it("sizes the add button within the right gutter", function () {
    const staff = { x: 48, y: 22, w: 240, h: 36 }
    assert.deepEqual(appendButtonRect(720, staff), { x: 289, y: 22, w: 48, h: 36 })
    assert.deepEqual(appendButtonRect(320, staff), { x: 289, y: 22, w: 31, h: 36 })
  })

  it("positions instrument names beside their visible staves and respects name display settings", function () {
    const score = reopen(importMusicXML(fixture))
    const [piano] = score.tracks
    const staff = (track: model.Track, y: number) => ({ bar: { staff: { track } }, realBounds: { x: 52, y, h: 36 } })
    const system = (...bars: ReturnType<typeof staff>[]) => ({ realBounds: { x: 48 }, bars: [{ bars }] }) as unknown as rendering.StaffSystemBounds
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
    assert.strictEqual(piano.name, "Grand piano")
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

  it("aligns clefs across systems with and without an opening repeat", function () {
    const score = importMusicXML(fixture)
    appendMeasure(score)
    const settings = new Settings()
    settings.core.enableLazyLoading = false
    settings.display.barsPerRow = 1
    settings.notation.elements.set(NotationElement.TrackNames, false)
    const renderer = new rendering.ScoreRenderer(settings)
    renderer.width = 460
    const systems: string[] = []
    renderer.partialRenderFinished.on(({ firstMasterBarIndex, renderResult }) => {
      if (firstMasterBarIndex >= 0) systems.push(renderResult as string)
  })
    renderer.renderScore(score, [0])
    renderer.destroy()

    assert.strictEqual(systems.length, 3)
    const clefX = systems.map(svg => svg.match(/translate\(([^ ]+) [^)]+\)" class="at" ><text[^>]*>&#57424;<\/text>/)?.[1])
    assert.ok(clefX[0])
    assert.deepEqual(clefX, [clefX[0], clefX[0], clefX[0]])
    assert.match(systems[0], /&#57412;/)
    assert.notMatch(systems[2], /&#57412;/)
  })

  it("preserves staff spacing when cycling clefs on wrapped empty and pitched measures", function () {
    const settings = new Settings()
    settings.display.barsPerRow = 1
    for (const score of [blankScore(), importMusicXML(fixture)]) {
      appendMeasure(score, 2)
      const renderer = new rendering.ScoreRenderer(settings)
      renderer.width = 300
      const staffPositions = () => {
        renderer.renderScore(reopen(score), [0])
        return renderer.boundsLookup!.staffSystems.map(system => system.bars[0].lineAlignedBounds.y)
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

  it("renders smaller bars and noteheads at the compact and normal sizes", function () {
    const score = snippetScore("practice-phrase")
    const settings = new Settings()
    settings.core.includeNoteBounds = true
    const renderer = new rendering.ScoreRenderer(settings)
    renderer.width = 300
    const dimensions = ["compact", "normal", "spacious"].map(size => {
      settings.display.scale = scoreScales[size as keyof typeof scoreScales]
      renderer.updateSettings(settings)
      renderer.renderScore(score, [0])
      const { staffSystems } = renderer.boundsLookup!
      const staff = staffSystems[0].bars[0].bars[0]
      const note = staff.beats[0].notes![0]
      const end = staffSystems.at(-1)!.bars.at(-1)!.bars[0].realBounds
      assert.ok(appendButtonRect(renderer.width, end).w > 0)
      return [staff.realBounds.h, note.noteHeadBounds.w]
  })
    renderer.destroy()
    for (const index of [0, 1]) {
      assert.ok(dimensions[0][index] < dimensions[1][index])
      assert.ok(dimensions[1][index] < dimensions[2][index])
    }
  })

  it("justifies a complete final system and leaves an incomplete one compact", function () {
    const score = blankScore()
    appendMeasure(score, 5)
    const renderer = new rendering.ScoreRenderer(new Settings())
    renderer.width = 720
    const widths = () => {
      renderer.renderScore(reopen(score), [0])
      return renderer.boundsLookup!.staffSystems.map(system => system.realBounds.w)
    }
    const [first, full] = widths()
    assert.strictEqual(full, first)
    appendMeasure(score)
    const [unchanged, second, partial] = widths()
    assert.strictEqual(unchanged, first)
    assert.strictEqual(second, first)
    assert.ok(partial < first)
    renderer.destroy()
  })

  it("aligns the first beat across rows while drawing time signatures only when needed", function () {
    const score = blankScore()
    appendMeasure(score, 3)
    assert.strictEqual(cycleMeter(score, 2), true)
    const settings = new Settings()
    settings.core.enableLazyLoading = false
    settings.display.barsPerRow = 1
    const renderer = new rendering.ScoreRenderer(settings)
    renderer.width = 460
    const systems: string[] = []
    renderer.partialRenderFinished.on(({ firstMasterBarIndex, renderResult }) => {
      if (firstMasterBarIndex >= 0) systems.push(renderResult as string)
  })
    renderer.renderScore(reopen(score), [0])
    const firstBeats = renderer.boundsLookup!.staffSystems.map(system => system.bars[0].bars[0].beats[0].onNotesX)
    renderer.destroy()

    assert.strictEqual(systems.length, 4)
    assert.deepEqual(firstBeats, Array(4).fill(firstBeats[0]))
    assert.deepEqual(systems.map(svg => [...svg.matchAll(/&#5747[56];/g)].map(match => match[0])), [
      ["&#57476;", "&#57476;"], [], ["&#57475;", "&#57476;"], [],
    ])
  })

  it("only counts additions past the full measure edges, including on a wrapped row", function () {
    const systems = [{ realBounds: { y: 0, h: 80 }, bars: [{ index: 0, realBounds: { x: 48, w: 250 } }] }] as unknown as rendering.StaffSystemBounds[]
    const areas = [
      { y: 0, dy: 0, h: 80, edges: [470, 680] },
      { y: 75, dy: 5, h: 80, edges: [245, 435] },
    ]
    assert.strictEqual(endBarDragDelta({ x: 469, y: 40 }, systems, areas), 0)
    assert.strictEqual(endBarDragDelta({ x: 470, y: 40 }, systems, areas), 1)
    assert.strictEqual(endBarDragDelta({ x: 679, y: 40 }, systems, areas), 1)
    assert.strictEqual(endBarDragDelta({ x: 680, y: 40 }, systems, areas), 2)
    assert.strictEqual(endBarDragDelta({ x: 244, y: 120 }, systems, areas), 2)
    assert.strictEqual(endBarDragDelta({ x: 245, y: 120 }, systems, areas), 3)
    assert.strictEqual(endBarDragDelta({ x: 244, y: 120 }, systems, areas.slice(1)), 0)
    const wrappedOnly = [{ ...areas[0], edges: [] }, areas[1]]
    assert.strictEqual(endBarDragDelta({ x: 680, y: 40 }, systems, wrappedOnly), 0)
    assert.strictEqual(endBarDragDelta({ x: 245, y: 120 }, systems, wrappedOnly), 1)
  })

  it("snaps a backward drag to existing measure boundaries, including on an earlier row", function () {
    const row = (y: number, first: number, widths: number[]) => {
      let x = 48
      return { realBounds: { y, h: 80 }, bars: widths.map((w, i) => {
        const bar = { index: first + i, realBounds: { x, w } }
        x += w
        return bar
      }) }
    }
    const systems = [row(0, 0, [160, 120, 180]), row(80, 3, [180, 180]), row(160, 5, [150, 100])] as unknown as rendering.StaffSystemBounds[]
    assert.strictEqual(endBarDragDelta({ x: 310, y: 200 }, systems), 0)
    assert.strictEqual(endBarDragDelta({ x: 200, y: 200 }, systems), -1)
    assert.strictEqual(endBarDragDelta({ x: 450, y: 120 }, systems), -2)
    assert.strictEqual(endBarDragDelta({ x: 240, y: 40 }, systems), -6)
    assert.strictEqual(endBarDragDelta({ x: 48, y: -80 }, systems), -6)
    assert.strictEqual(endBarDragDelta({ x: 48, y: 280 }, systems), 0)
  })

  it("clips clef and time signature glyph boxes to their respective staffs", function () {
    const bar = beats(blankScore())[0].voice.bar
    const staves = [10, 51].map((y, index) => ({
      bar: { ...bar, staff: { ...bar.staff, index } },
      realBounds: { x: 48, y, w: 180, h: 36 },
      beats: [],
    }))
    const sheet = { offsetWidth: 300, offsetHeight: 120, getBoundingClientRect: () => ({
      left: 0, top: 0, width: 300, height: 120,
    }) }
    const glyphs = ([
      ["\ue050", 52, -30, 76], ["\ue050", 52, 40, 60],
      ["\ue084", 75, -30, 76], ["\ue084", 75, 40, 60],
    ] as [string, number, number, number][]).map(([textContent, left, top, height]) => ({
      textContent,
      getBoundingClientRect: () => ({ left, right: left + 19, top, bottom: top + height, width: 19, height }),
    }))
    const system = { realBounds: { y: 0, h: 120 }, bars: [{ bars: staves }] }
    const points = scorePoints(sheet as unknown as HTMLElement, { staffSystems: [system] } as unknown as rendering.BoundsLookup,
      { querySelectorAll: (selector: string) => selector === "svg text" ? glyphs : [] } as unknown as Element)
    assert.deepEqual(points.filter(point => point.kind === "clef").map(point => [point.bar![1], point.rect.y, point.rect.h]),
      [[0, 10, 36], [1, 51, 36]])
    assert.deepEqual(points.filter(point => point.kind === "meter").map(point => [point.bar![1], point.rect]),
      [[0, { x: 75, y: 10, w: 19, h: 36 }], [1, { x: 75, y: 51, w: 19, h: 36 }]])
  })

  it("score text preserves spelling and punctuation through save and removal", function () {
    const score = blankScore()
    const beat = beats(score)[1]
    const text = "text Dolce & <cantabile>"
    assert.ok(setScoreText(beat, text))
    const saved = reopen(score)
    assert.strictEqual(beats(saved)[1].text, text)
    assert.strictEqual(setScoreText(beats(saved)[1], text), false)
    assert.ok(setScoreText(beats(saved)[1], " "))
    assert.strictEqual(beats(reopen(saved))[1].text, null)
  })

  it("sets and removes a lyric syllable without overwriting another verse", function () {
    const score = blankScore()
    const [beat, rest] = beats(score)
    assert.strictEqual(setLyric(rest, "la"), false)
    placeNote(beat, 4)
    beat.lyrics = ["Old", "Second verse"]
    assert.ok(setLyric(beat, " Ré- "))
    const saved = reopen(score)
    assert.deepEqual(beats(saved)[0].lyrics, ["Ré-", "Second verse"])
    assert.ok(setLyric(beats(saved)[0], ""))
    assert.deepEqual(beats(reopen(saved))[0].lyrics, ["", "Second verse"])
    assert.strictEqual(setLyric(beats(saved)[2], ""), false)
  })

  it("adds, edits, and clears the score title and subtitle independently", function () {
    const score = blankScore()
    assert.ok(setHeading(score, "title", "Song & <Dance>"))
    assert.ok(setHeading(score, "subTitle", "First sketch"))
    const saved = reopen(score)
    assert.strictEqual(saved.title, "Song & <Dance>")
    assert.strictEqual(saved.subTitle, "First sketch")
    assert.ok(setHeading(saved, "subTitle", "Second sketch"))
    assert.ok(setHeading(saved, "title", ""))
    const edited = reopen(saved)
    assert.strictEqual(edited.title, "")
    assert.strictEqual(edited.subTitle, "Second sketch")
  })

  it("a dynamic lasts until the next marking and carries through new rests and notes", function () {
    const score = blankScore()
    score.stylesheet.hideDynamics = true
    const voice = beats(score)
    const choose = (score: model.Score, index: number, shortcut: string) => scoreCompletions(score,
      { point: { kind: "dynamics", address: beatAddress(beats(score)[index]) } }, shortcut, english)[0]
    assert.ok(choose(score, 2, "mf").apply!())
    assert.ok(choose(score, 0, "p").apply!())
    assert.ok(changeDuration(voice[0], model.Duration.Eighth))
    const split = reopen(score)
    assert.ok(placeNote(beats(split)[1], 4))
    assert.ok(appendMeasure(split))
    const saved = reopen(split)
    assert.deepEqual(beats(saved).map(beat => [beat.dynamics, beat.showDynamics]),
      [[2, true], [2, false], [2, false], [4, true], [4, false]])
    assert.strictEqual(beats(saved)[1].notes[0].dynamics, model.DynamicValue.P)
    assert.ok(beats(saved, 1).every(beat => beat.dynamics === model.DynamicValue.MF))
    assert.ok(choose(saved, 0, "remove dynamic").apply!())
    assert.deepEqual(beats(reopen(saved)).map(beat => beat.dynamics), [5, 5, 5, 4, 4])
  })

  it("hairpins span selected beats across bars and can be removed from either end", function () {
    const score = blankScore()
    appendMeasure(score)
    const saved = reopen(score)
    placeNote(beats(saved)[2], 4)
    placeNote(beats(saved, 1)[0], 2)
    const first = beatAddress(beats(saved)[2])
    const last = beatAddress(beats(saved, 1)[0])
    const context: CompletionContext = { point: { kind: "beat", address: last! }, group: "passage", passage: { first, last } }
    assert.ok(scoreCompletions(saved, context, "<", english)[0].apply!())
    const span = (score: model.Score) => [...beats(score), ...beats(score, 1)].map(beat => beat.crescendo)
    assert.deepEqual(span(reopen(saved)), [0, 0, 1, 1, 1, 0, 0, 0])
    assert.ok(scoreCompletions(saved, context, ">", english)[0].apply!())
    const changed = reopen(saved)
    assert.deepEqual(span(changed), [0, 0, 2, 2, 2, 0, 0, 0])
    assert.ok(scoreCompletions(changed, { point: { kind: "dynamics", address: last! } }, "remove hairpin", english)[0].apply!())
    assert.deepEqual(span(reopen(changed)), Array(8).fill(0))
  })

  it("positions the tempo edit target over the digits alone", function () {
    const bar = beats(blankScore())[0].voice.bar
    const realBounds = { x: 48, y: 20, w: 180, h: 70 }
    const staffSystemBounds = { realBounds, bars: [
      { index: 0, realBounds, bars: [{ bar, realBounds, beats: [] }] } as { index: number, realBounds: typeof realBounds, bars: object[], staffSystemBounds?: object },
    ] }
    staffSystemBounds.bars[0].staffSystemBounds = staffSystemBounds
    const sheet = { offsetWidth: 300, offsetHeight: 120, getBoundingClientRect: () => ({
      left: 0, top: 0, width: 300, height: 120,
    }) }
    const position = (x: number) => ({ matrixTransform: () => ({ x, y: 20 }) })
    const glyph = {
      textContent: " = 120",
      getBoundingClientRect: () => ({ left: 78, right: 108, top: 12, bottom: 24, width: 30, height: 12 }),
      getScreenCTM: () => ({}),
      getStartPositionOfChar: (index: number) => position(78 + index * 5),
      getEndPositionOfChar: (index: number) => position(78 + (index + 1) * 5),
    }
    const points = scorePoints(sheet as unknown as HTMLElement, { staffSystems: [staffSystemBounds] } as unknown as rendering.BoundsLookup,
      { querySelectorAll: (selector: string) => selector === "svg text" ? [glyph] : [] } as unknown as Element)
    const tempo = points.find(point => point.kind === "tempo")
    assert.strictEqual(tempo!.digits, "120")
    assert.deepEqual(tempo!.rect, { x: 93, y: 12, w: 15, h: 12 })
  })

  it("copies and pastes a passage across bars without changing existing notes or timing", function () {
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
    const pasted = readScore(result!.text)
    assert.deepEqual(result!.passage, { first: [0, 0, 1, 0, 3], last: [0, 0, 2, 0, 0] })
    assert.deepEqual([beats(pasted)[3], beats(pasted, 1)[0], beats(pasted, 1)[3], beats(pasted, 2)[0]]
      .map(beat => [writtenPitch(beat.notes[0]), beat.displayStart]),
    [[71, 2880], [74, 0], [71, 2880], [74, 0]])
    assert.notStrictEqual(beats(pasted)[3].notes[0].id, beats(pasted, 1)[3].notes[0].id)
    assert.strictEqual(editPassage(pasted, { source, target: beatAddress(beats(pasted, 1)[3]) }), null)
  })

  it("moves an overlapping passage at the grabbed beat and fills the source with rests", function () {
    const score = blankScore()
    const voice = beats(score)
    placeNote(voice[0], 4)
    placeNote(voice[1], 2)
    const selection = passageBetween(beatAddress(voice[0]), beatAddress(voice[1]))
    const result = editPassage(score, { selection, grab: selection.last, target: beatAddress(voice[2]) })
    const moved = readScore(result!.text)
    assert.deepEqual(beats(moved).map(beat => beat.notes.map(writtenPitch)), [[], [71], [74], []])
    assert.deepEqual(beats(moved).map(beat => beat.displayStart), [0, 960, 1920, 2880])
    const removed = readScore(editPassage(moved, { selection: result!.passage }!)!.text)
    assert.ok(beats(removed).every(beat => beat.isRest))
  })

  it("pastes ties with fresh endpoints and prevents cutting only one side", function () {
    const imported = importMusicXML(fixture)
    appendMeasure(imported)
    const score = reopen(imported)
    const first = beatAddress(beats(score)[3])
    const last = beatAddress(beats(score, 1)[0])
    assert.strictEqual(editPassage(score, { selection: { first, last: first } }), null)
    const selection = { first, last }
    const source = copyPassage(score, selection)
    const pasted = readScore(editPassage(score, { source, target: beatAddress(beats(score, 2)[0]) })!.text)
    const origin = beats(pasted, 2)[0].notes[0]
    assert.strictEqual(origin.tieDestination, beats(pasted, 2)[1].notes[0])
    assert.notStrictEqual(origin.id, beats(pasted)[3].notes[0].id)
    const cut = readScore(editPassage(pasted, { selection })!.text)
    assert.strictEqual(beats(cut)[3].isRest, true)
    assert.strictEqual(beats(cut, 1)[0].isRest, true)
    assert.strictEqual(beats(cut, 2)[0].notes[0].tieDestination, beats(cut, 2)[1].notes[0])
  })
})

describe("file export round trips", function () {
  const source = () => importMusicXML(fixture)
  const sounding = (score: model.Score) => {
    const notes: model.Note[] = []
    for (const track of score.tracks) for (const st of track.staves) for (const bar of st.bars) for (const voice of bar.voices) for (const beat of voice.beats) for (const note of beat.notes) if (!note.isTieDestination) notes.push(note)
    return notes
  }
  const noteCount = (score: model.Score) => sounding(score).length
  function readMidi(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const chunk = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4))
    assert.strictEqual(chunk(0), "MThd")
    const tracks = view.getUint16(10)
    const pitches = new Set<number>()
    let at = 14, noteOns = 0, microsPerBeat = 0
    for (let t = 0; t < tracks; t++) {
      assert.strictEqual(chunk(at), "MTrk")
      const end = at + 8 + view.getUint32(at + 4)
      let i = at + 8, status = 0
      const varLen = () => { let v = 0, b; do { b = bytes[i++]; v = (v << 7) | (b & 0x7f) } while (b & 0x80); return v }
      while (i < end) {
        varLen()
        if (bytes[i] & 0x80) status = bytes[i++]
        if (status === 0xff) {
          const type = bytes[i++], length = varLen()
          if (type === 0x51 && !microsPerBeat) microsPerBeat = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
          i += length
        } else if (status === 0xf0 || status === 0xf7) i += varLen()
        else {
          const kind = status & 0xf0
          if (kind === 0x90 && bytes[i + 1] > 0) { noteOns++; pitches.add(bytes[i]) }
          i += kind === 0xc0 || kind === 0xd0 ? 1 : 2
        }
      }
      assert.strictEqual(i, end, "track chunk is well formed")
      at = end
    }
    return { tracks, noteOns, pitches, tempo: Math.round(60000000 / microsPerBeat) }
  }

  it("writes a MIDI file with the tempo and the notes of the score", function () {
    const score = source()
    const midiFile = readMidi(exportMidi(score))
    assert.isAtLeast(midiFile.tracks, score.tracks.length)
    assert.strictEqual(midiFile.tempo, Math.round(score.tempo))
    assert.isAbove(noteCount(score), 0)
    // The phrase has a repeat, and the MIDI file plays it out, so every note sounds at least once.
    assert.isAtLeast(midiFile.noteOns, noteCount(score))
    assert.sameMembers([...midiFile.pitches], [...new Set(sounding(score).map(note => note.realValue))])
  })

  it("writes a Guitar Pro file that alphaTab reads back with the same tracks, bars and tempo", function () {
    const score = source()
    const importer = Environment.buildImporters().find(candidate => candidate.name === "Guitar Pro 7-8")!
    importer.init(io.ByteBuffer.fromBuffer(exportGuitarPro(score)), new Settings())
    const back = importer.readScore()
    assert.strictEqual(back.tracks.length, score.tracks.length)
    assert.strictEqual(back.masterBars.length, score.masterBars.length)
    assert.strictEqual(Math.round(back.tempo), Math.round(score.tempo))
    assert.strictEqual(noteCount(back), noteCount(score))
  })
})

mocha.run()
