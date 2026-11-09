import { model } from "./vendor/alphaTab.core.min.mjs"
import { playbackInstrumentName, playbackInstruments, setPlaybackInstrument } from "./score-instruments.js"
import {
  applyTuplet, canChangeDuration, canChangePitch, canEnterDuration, canEnterNote, canRemoveNote, canSetMeter,
  changeDuration, changePitch, clefs, durations, enterNotes, findBeat, findNote, graceTypeFor, insertGraceNotes,
  hasDynamic, isPitchedStaff, meters, pitchAtStep, removeNote, setClef, setDynamic, setKeySignature, setMeter, staffDegree, tupletPlans, writtenPitch,
} from "./score-model.js"
import { passageBeamLinks, passageHairpinChanges, passageMarkChanges, passageNoteLinks, setPassageBeaming, setPassageNoteLinks } from "./score-passage.js"

const { BeatBeamingMode, Clef, CrescendoType, Duration, DynamicValue, GraceType, KeySignatureType, MusicFontSymbol, NoteAccidentalMode } = model
const letters = "cdefgab"
const pitchToken = /^([a-g])([#bn]?)(-?\d)?$/
const completeValue = /\/(?:1|2|4|8|16|32|64)\.{0,2}$/
const rhythms = [0, 1, 2].flatMap(dots => durations.map(([key, duration]) => ({ key, duration, dots })))
const clefChoices = [
  ["treble", "g", 0xe050, 6], ["bass", "f", 0xe062, 2], ["alto", "c3", 0xe05c, 4], ["tenor", "c4", 0xe05c, 2],
]
const majorKeys = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"]
const minorKeys = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#"]
const signatureOrder = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7]
const sharpSteps = [0, 3, -1, 2, 5, 1, 4]
const flatSteps = [4, 1, 5, 2, 6, 3, 7]
const keyClefOffset = { [Clef.G2]: 0, [Clef.F4]: 2, [Clef.C3]: 1, [Clef.C4]: -1 }
const beamChoices = [
  ["beam", "beam", [], BeatBeamingMode.ForceMergeWithNext],
  ["splitBeam", "unbeam", ["split beam"], BeatBeamingMode.ForceSplitToNext],
  ["automaticBeam", "beam auto", ["auto beam"], BeatBeamingMode.Auto],
]
const linkChoices = [
  ["tie", "tie", true], ["slur", "slur", true], ["untie", "tie", false], ["unslur", "slur", false],
]
const markGlyphs = {
  staccato: MusicFontSymbol.ArticStaccatoAbove,
  tenuto: MusicFontSymbol.ArticTenutoAbove,
  accent: MusicFontSymbol.ArticAccentAbove,
  fermata: MusicFontSymbol.FermataAbove,
  trill: MusicFontSymbol.OrnamentTrill,
  turn: MusicFontSymbol.OrnamentTurn,
}
const dynamicChoices = [
  ["ppp", "Pianississimo", MusicFontSymbol.DynamicPPP],
  ["pp", "Pianissimo", MusicFontSymbol.DynamicPP],
  ["p", "Piano", MusicFontSymbol.DynamicPiano],
  ["mp", "Mezzo-piano", MusicFontSymbol.DynamicMP],
  ["mf", "Mezzo-forte", MusicFontSymbol.DynamicMF],
  ["f", "Forte", MusicFontSymbol.DynamicForte],
  ["ff", "Fortissimo", MusicFontSymbol.DynamicFF],
  ["fff", "Fortississimo", MusicFontSymbol.DynamicFFF],
]
const accidentals = {
  "#": [1, "♯", NoteAccidentalMode.ForceSharp],
  b: [-1, "♭", NoteAccidentalMode.ForceFlat],
  n: [0, "♮", NoteAccidentalMode.ForceNatural],
}
const normalize = value => value.trim().toLowerCase().replaceAll("♯", "#").replaceAll("♭", "b").replaceAll("♮", "n")
const noteGlyph = duration => 0xe1d2 + 2 * Math.log2(duration) - (duration > 1 ? 1 : 0)
const restGlyph = duration => 0xe4e3 + (duration < 0 ? -Math.log2(-duration) : Math.log2(duration))
const sameRhythm = (a, b) => a.duration === b.duration && a.dots === b.dots

export function rhythmShortcut({ duration, dots }) {
  return "/" + duration + ".".repeat(dots)
}

export function entryRhythm(beat, preferred = Duration.Quarter, dots = 0) {
  if (!beat?.isRest) return null
  return [{ duration: preferred, dots }, beat, ...rhythms].find(rhythm => canEnterDuration(beat, rhythm.duration, rhythm.dots))
}

function rhythmLabel({ key, dots }, t, rest = false) {
  const name = t[rest ? key + "Rest" : key]
  return dots ? name + " · " + t[dots === 1 ? "dotted" : "doubleDotted"] : name
}

function resolvePitch(beat, reference, token) {
  const [, letter, suffix, writtenOctave] = token.match(pitchToken)
  const index = letters.indexOf(letter)
  const octave = writtenOctave === undefined ? Math.round((reference - index) / 7) : Number(writtenOctave)
  const [offset, , mode = NoteAccidentalMode.Default] = accidentals[suffix] ?? []
  const step = staffDegree(beat, 0) - (octave * 7 + index)
  const pitch = pitchAtStep(beat, step, offset)
  const keyOffset = pitch - pitchAtStep(beat, step, 0)
  const accidental = suffix || (keyOffset > 0 ? "#" : keyOffset < 0 ? "b" : "")
  const name = letter.toUpperCase() + (accidentals[accidental]?.[1] ?? "") + octave
  return { name, step, pitch, accidental, mode }
}

function pitchChoices(beat, selected, pitches, token, active, explicit, t) {
  const names = pitches.map(({ name }) => name).join(" ")
  const label = pitches.length > 1 ? t.chord + " · " + names : !selected && !beat.isRest ? t.addPitch + " " + names : names
  const [first] = pitches
  if (selected && !canChangePitch(selected, first.pitch - writtenPitch(selected))) return []
  if (new Set(pitches.map(({ pitch }) => pitch)).size !== pitches.length) return []
  const choices = active ? [{ rhythm: active, explicit: false }] : []
  if (explicit) choices.push(...rhythms.map(rhythm => ({ rhythm, explicit: true })))
  return choices.flatMap(({ rhythm, explicit }) => {
    const { duration, dots } = rhythm
    if (selected) {
      if (explicit && !sameRhythm(beat, rhythm) && !canChangeDuration(beat, duration, dots)) return []
    } else if (!pitches.every(({ pitch }) => canEnterNote(beat, pitch, duration, dots))) return []
    const shortcut = token + (explicit ? rhythmShortcut(rhythm) : "")
    const choiceLabel = explicit ? (pitches.length > 1 ? rhythmLabel(rhythm, t) : label + " · " + rhythmLabel(rhythm, t)) : label
    return [{
      id: "pitch:" + shortcut, label: choiceLabel,
      shortcut, pitches, duration, dots, explicit,
      advance: beat.isRest,
      apply: () => {
        if (!selected) return enterNotes(beat, pitches, duration, dots)
        const rhythmChanged = explicit && changeDuration(beat, duration, dots)
        const semitones = first.pitch - writtenPitch(selected)
        if (!semitones && first.mode === selected.accidentalMode) return rhythmChanged
        return changePitch(selected, semitones, first.mode)
      },
    }]
  })
}

function noteChoices(beat, note, context, target, active, t) {
  const entries = []
  const reference = staffDegree(beat, context.step ?? 4)
  const add = target.startsWith("+")
  const typed = (add ? target.slice(1) : target).match(pitchToken)
  if (!target.startsWith("<") && (!add || !beat.isRest)) {
    for (const letter of letters) {
      const matched = typed?.[1] === letter
      const token = matched ? typed[0] : letter
      const pitch = resolvePitch(beat, reference, token)
      const shortcut = (add ? "+" : "") + token
      entries.push(...pitchChoices(beat, add ? null : note, [pitch], shortcut, active, matched, t))
    }
    entries.sort((a, b) => b.pitches[0].step - a.pitches[0].step)
  }
  if (note && !target && !beat.isRest) {
    for (const letter of letters) {
      entries.push(...pitchChoices(beat, null, [resolvePitch(beat, reference, letter)], "+" + letter, active, false, t))
    }
  }
  if (beat.isRest && (!target || target.startsWith("<"))) {
    const octave = Math.round((reference - 2) / 7)
    const example = ["c", "e", "g"].map(letter => letter + octave)
    const chord = target.match(/^<([^<>]+)>?$/)
    const tokens = chord ? chord[1].trim().split(/\s+/) : example
    if (tokens.length >= 2 && tokens.every(token => pitchToken.test(token))) {
      const shortcut = "<" + tokens.join(" ") + ">"
      const pitches = tokens.map(token => resolvePitch(beat, reference, token))
      entries.splice(4, 0, ...pitchChoices(beat, null, pitches, shortcut, active, Boolean(chord), t))
    }
  }
  return entries
}

function restChoices(beat, note, target, active, t) {
  const removable = canRemoveNote(note)
  if (!beat.isRest && (!removable || beat.notes.length !== 1)) {
    return removable ? [{ id: "remove", label: t.removeNote, shortcut: "Delete", glyph: restGlyph(beat.duration),
      dots: beat.dots, clearsNote: true, apply: () => removeNote(note) }] : []
  }
  const choices = active ? [{ rhythm: active, explicit: false }] : []
  if (target === "r" || target === "0") choices.push(...rhythms.map(rhythm => ({ rhythm, explicit: true })))
  return choices.flatMap(({ rhythm, explicit }) => {
    const { duration, dots } = rhythm
    if (explicit && !(beat.isRest ? canEnterDuration(beat, duration, dots)
      : sameRhythm(beat, rhythm) || canChangeDuration(beat, duration, dots))) return []
    const suffix = explicit ? rhythmShortcut(rhythm) : ""
    return [{
      id: (beat.isRest ? "rest:" : "remove:") + suffix,
      label: explicit ? rhythmLabel(rhythm, t, true) : beat.isRest ? t.rest : t.replaceWithRest,
      shortcut: "r" + suffix, aliases: beat.isRest ? ["0" + suffix] : [],
      glyph: restGlyph(duration), rest: true, duration, dots, explicit, advance: beat.isRest, clearsNote: !beat.isRest,
      apply: () => {
        const changed = (beat.isRest || explicit) && changeDuration(beat, duration, dots)
        return beat.isRest ? changed : removeNote(note)
      },
    }]
  })
}

function keyChoices(bar, t) {
  return signatureOrder.flatMap(signature => ["major", "minor"].map(mode => {
    const major = mode === "major"
    const tonic = (major ? majorKeys : minorKeys)[signature + 7]
    const name = tonic + " " + mode
    const count = (signature > 0 ? "+" : "") + signature
    const type = major ? KeySignatureType.Major : KeySignatureType.Minor
    const aliases = [name, "key " + tonic + " " + t[mode], "key " + count + " " + mode]
    if (major) aliases.push("key " + count)
    return {
      id: "key:" + name, label: tonic.replace("#", "♯").replace("b", "♭") + " " + t[mode],
      shortcut: "key " + name, aliases, signature, clef: bar.clef,
      apply: () => setKeySignature(bar, signature, type),
    }
  }))
}

function noteLinkChoices(score, passage, t) {
  const plans = passageNoteLinks(score, passage)
  if (!plans) return []
  return linkChoices.flatMap(([id, kind, linked]) => {
    const pairs = plans[id]
    return pairs.length ? [{
      id, label: t[id], shortcut: id, link: kind, linked,
      apply: () => setPassageNoteLinks(pairs, kind, linked),
    }] : []
  })
}

function tupletChoices(score, passage, t) {
  if (!passage) return []
  return tupletPlans(findBeat(score, passage.first), findBeat(score, passage.last)).map(plan => {
    const { numerator, denominator } = plan
    const ratio = numerator + ":" + denominator
    const triplet = ratio === "3:2"
    const command = "tuplet " + ratio
    return {
      id: command, label: triplet ? t.triplet : t.tuplet + " " + ratio,
      shortcut: triplet ? "triplet" : command, aliases: triplet ? [command, ratio] : [ratio],
      tuplet: ratio, apply: () => applyTuplet(plan),
    }
  })
}

function graceChoices(note, context, query, t) {
  const { beat } = note
  const input = query.replace(/^grace(?: |$)/, "")
  const tokens = input ? [input.split(" ")] : Array.from(letters, letter => [letter])
  const reference = staffDegree(beat, context.step ?? 4)
  return tokens.flatMap(tokens => {
    if (!tokens.every(token => pitchToken.test(token))) return []
    const type = graceTypeFor(beat, tokens.length)
    if (type === null) return []
    const pitches = tokens.map(token => resolvePitch(beat, reference, token))
    if (pitches.some(({ pitch }) => pitch < 0 || pitch > 127)) return []
    const text = tokens.join(" ")
    const shortcut = "grace " + text
    return [{
      id: shortcut, label: t[pitches.length === 1 ? "grace" : "graceNotes"] + " · " + pitches.map(({ name }) => name).join(" "),
      shortcut, aliases: [text], grace: true, gracePitches: pitches, slash: type === GraceType.BeforeBeat,
      apply: () => insertGraceNotes(note, pitches),
    }]
  })
}

function hairpinChoices(score, passage, t) {
  return passageHairpinChanges(score, passage).map(({ id, direction, apply }) => ({
    id, label: t[id], shortcut: { crescendo: "crescendo", diminuendo: "diminuendo", removeHairpin: "remove hairpin" }[id],
    aliases: { crescendo: ["<", "cresc"], diminuendo: [">", "dim", "decrescendo"], removeHairpin: ["remove crescendo", "remove diminuendo"] }[id],
    hairpin: direction, removeMark: direction === CrescendoType.None, apply,
  }))
}

export function scoreCompletions(score, context, value, t) {
  const query = normalize(value).replace(/\s+/g, " ").replace(/< +| +>/g, match => match.trim())
  const { point, group } = context
  if (point.kind === "instrument") {
    const track = score.tracks[point.trackIndex]
    if (!track) return []
    const currentName = playbackInstrumentName(track)
    const words = query.split(/[\s-]+/).filter(Boolean)
    const priority = entry => query
      ? Number(entry.shortcut === query || normalize(entry.label) === query) : Number(entry.current)
    return playbackInstruments(track).flatMap(([program, label]) => {
      const shortcut = track.isPercussion ? String(program) : String(program + 1)
      const search = normalize(label) + " " + (track.isPercussion ? "kit " : "gm ") + shortcut
        + (!track.isPercussion && program < 2 ? " acoustic" : "")
      if (!words.every(word => search.includes(word))) return []
      return [{
        id: "instrument:" + program, label, shortcut, current: label === currentName,
        glyph: MusicFontSymbol.NoteQuarterUp, apply: () => setPlaybackInstrument(track, program),
      }]
    }).sort((a, b) => priority(b) - priority(a))
  }
  const position = point.address?.slice(0, 5)
  const selection = group === "passage" ? context.passage
    : position && { first: position, last: position, note: point.address[5] }
  const marks = passageMarkChanges(score, selection).map(({ mark, remove, apply }) => {
    const shortcut = remove ? "remove " + mark : mark
    return {
      id: shortcut, shortcut, label: remove ? t.removeMark.replace("{mark}", t[mark]) : t[mark],
      mark: markGlyphs[mark], removeMark: remove, apply,
    }
  })
  const markMenu = marks.length && {
    id: "marks-menu", label: t.marks, shortcut: "articulations", aliases: ["ornaments"],
    mark: markGlyphs.accent, openMarks: true,
  }
  const address = point.bar ?? point.address
  const bar = address && score.tracks[address[0]]?.staves[address[1]]?.bars[address[2]]
  const keyMenu = group !== "passage" && bar && isPitchedStaff(bar) && {
    id: "key-menu", label: t.key, shortcut: "key", signature: bar.keySignature, clef: bar.clef, openKey: true,
  }
  let fullValue = false
  let entries = []
  if (point.kind === "dynamics") {
    const beat = findBeat(score, position)
    if (!beat) return []
    const marked = hasDynamic(beat)
    entries = dynamicChoices.map(([shortcut, label, dynamicGlyph]) => ({
      id: shortcut, label, shortcut, aliases: ["dynamic " + shortcut], dynamicGlyph,
      apply: () => setDynamic(beat, DynamicValue[shortcut.toUpperCase()]),
    }))
    if (marked) entries.push({ id: "remove-dynamic", label: t.removeDynamic, shortcut: "remove dynamic",
      dynamicGlyph: dynamicChoices.find(([shortcut]) => DynamicValue[shortcut.toUpperCase()] === beat.dynamics)?.[2] ?? MusicFontSymbol.DynamicForte,
      removeMark: true, apply: () => setDynamic(beat) })
    entries.push(...hairpinChoices(score, selection, t))
  } else if (context.marksMenu) {
    entries = marks
  } else if (keyMenu && (point.kind === "key" || context.keyMenu || /^key(?: |$)/.test(query))) {
    entries = keyChoices(bar, t)
    if (query === "key" && !context.keyMenu && point.kind !== "key") entries.unshift(keyMenu)
  } else if (point.kind === "clef") {
    if (bar && isPitchedStaff(bar)) {
      entries = clefs.flatMap((clef, index) => {
        if (clef === bar.clef) return []
        const [key, shortcut, glyph, clefStep] = clefChoices[index]
        return [{ id: key, label: t[key], shortcut, glyph, clefStep, apply: () => setClef(bar, clef) }]
      })
    }
    if (keyMenu) entries.push(keyMenu)
  } else if (point.kind === "meter") {
    entries = meters.flatMap(([count, denominator]) => {
      if (!canSetMeter(score, point.measure, count, denominator)) return []
      const meter = count + "/" + denominator
      return [{ id: meter, label: meter + " " + t.meterName, shortcut: meter, meter,
        apply: () => setMeter(score, point.measure, count, denominator) }]
    })
    if (keyMenu) entries.push(keyMenu)
  } else if (group === "passage") {
    const links = passageBeamLinks(score, context.passage)
    if (links) {
      entries = beamChoices.map(([key, shortcut, aliases, mode]) => ({
        id: key, label: t[key], shortcut, aliases, beam: key, apply: () => setPassageBeaming(links, mode),
      }))
    }
    const [preferredTuplet, ...otherTuplets] = tupletChoices(score, context.passage, t)
    if (preferredTuplet) entries.push(preferredTuplet)
    if (markMenu) entries.push(markMenu, ...(query ? marks : []))
    entries.push(...noteLinkChoices(score, context.passage, t))
    entries.push(...hairpinChoices(score, context.passage, t))
    entries.push({ id: "clear", label: t.clearPassage, shortcut: "Delete", glyph: 0xe4e5 })
    entries.push(...otherTuplets)
  } else {
    const beat = findBeat(score, point.address)
    if (!beat) return []
    const note = point.kind === "note" ? findNote(score, point.address) : null
    if (point.kind === "note" && !note) return []
    const grace = note && graceTypeFor(beat) !== null && { id: "grace-menu", label: t.grace, shortcut: "grace", grace: true, openGrace: true }
    if (note && (context.graceMenu || /^grace(?: |$)/.test(query))) {
      entries = graceChoices(note, context, query, t)
      if (grace && query === "grace" && !context.graceMenu) entries.unshift(grace)
    } else {
      const pitched = isPitchedStaff(beat.voice.bar)
      const active = beat.isRest ? pitched && entryRhythm(beat, context.duration, context.dots) : beat
      const entering = beat.isRest && Boolean(active)
      const target = query.split("/", 1)[0]
      fullValue = completeValue.test(query)
      if (pitched) {
        entries = noteChoices(beat, note, context, target, active, t)
        entries.splice(3, 0, ...restChoices(beat, note, target, active, t))
        if (keyMenu) entries.splice(5, 0, keyMenu)
      }
      if (!beat.isRest) {
        const address = point.address.slice(0, 5)
        const links = noteLinkChoices(score, { first: address, last: address, note: point.address[5] }, t)
        entries.splice(3, 0, ...links)
      }
      if (grace) entries.splice(4, 0, grace)
      if (markMenu) entries.splice(5, 0, markMenu, ...(query ? marks : []))
      if (!beat.isRest || entering) {
        for (const rhythm of rhythms) {
          const { duration, dots } = rhythm
          const fits = entering ? canEnterDuration(beat, duration, dots)
            : sameRhythm(beat, rhythm) || canChangeDuration(beat, duration, dots)
          if (!fits) continue
          const shortcut = rhythmShortcut(rhythm)
          entries.push({ id: "duration:" + shortcut, label: rhythmLabel(rhythm, t), shortcut,
            glyph: noteGlyph(duration), duration, dots, setEntryDuration: entering,
            apply: () => changeDuration(beat, duration, dots) })
        }
      }
    }
  }
  if (!query) return entries
  const matches = entry => [entry.shortcut, ...(entry.aliases ?? [])].map(normalize)
  const isMatch = alias => fullValue ? alias === query || alias.startsWith(query + ".") : alias.startsWith(query)
  return entries.filter(entry => normalize(entry.label).includes(query) || matches(entry).some(isMatch))
    .sort((a, b) => Number(matches(b).includes(query)) - Number(matches(a).includes(query)))
}

export function completionPreview(document, entry) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 44 34")
  svg.setAttribute("aria-hidden", "true")
  const add = (tag, attributes) => {
    const node = document.createElementNS(svg.namespaceURI, tag)
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
    svg.append(node)
    return node
  }
  const glyph = (code, x, y, size) => {
    const text = add("text", { x, y, "font-size": size, fill: "currentColor" })
    text.textContent = String.fromCodePoint(code)
  }
  const dots = (x, y) => {
    for (let i = 0; i < entry.dots; i++) {
      add("circle", { cx: x + 3 * i, cy: y, r: 1, fill: "currentColor" })
    }
  }
  if (entry.pitches || entry.clefStep !== undefined || entry.signature !== undefined) {
    for (let i = 0; i <= 8; i += 2) {
      add("path", { d: "M3 " + (11 + i * 1.8) + "h38", stroke: "currentColor", opacity: ".28" })
    }
  }
  if (entry.mark !== undefined) {
    glyph(MusicFontSymbol.NoteheadBlack, 20, 25, 24)
    add("path", { d: "M23 25V16", stroke: "currentColor" })
    glyph(entry.mark, 20, 10, 24)
    if (entry.removeMark) add("path", { d: "M31 7l7 7m0-7l-7 7", stroke: "currentColor", "stroke-width": 1.5 })
  } else if (entry.dynamicGlyph || entry.hairpin !== undefined) {
    if (entry.dynamicGlyph) {
      glyph(entry.dynamicGlyph, 22, 21, 22)
    } else {
      const path = entry.hairpin === CrescendoType.Decrescendo ? "M6 11L38 17L6 23" : "M38 11L6 17L38 23"
      add("path", { d: path, stroke: "currentColor", fill: "none", "stroke-width": 1.5 })
    }
    if (entry.removeMark) add("path", { d: "M30 5l7 7m0-7l-7 7", stroke: "currentColor", "stroke-width": 1.5 })
  } else if (entry.tuplet) {
    for (const x of [8, 21, 34]) glyph(0xe0a4, x, 24, 20)
    add("path", { d: "M10 24V15M23 24V15M36 24V15M6 10V6H15M29 6H38V10", stroke: "currentColor", fill: "none" })
    const number = add("text", { x: 22, y: 10, "font-size": 8, "font-family": "system-ui", fill: "currentColor" })
    number.textContent = entry.tuplet.split(":")[0]
  } else if (entry.grace) {
    const pitches = entry.gracePitches?.slice(0, 3) ?? [{ step: 4 }]
    const xStep = pitches.length === 1 ? 0 : 8
    for (const [index, pitch] of pitches.entries()) {
      const x = 8 + index * xStep
      const y = 19 + Math.max(-3, Math.min(6, pitch.step - 4))
      glyph(0xe0a4, x, y, 16)
      add("path", { d: "M" + (x + 2) + " " + y + "v-9", stroke: "currentColor" })
      glyph(0xe240, x + 4, y - 9, 13)
      if (entry.slash) add("path", { d: "M" + x + " " + (y - 4) + "l7 -4", stroke: "currentColor" })
    }
    glyph(0xe0a4, 35, 23, 24)
    add("path", { d: "M38 23V10", stroke: "currentColor" })
  } else if (entry.link) {
    const tie = entry.link === "tie"
    const rightY = tie ? 22 : 17
    glyph(0xe0a4, 9, 22, 24)
    glyph(0xe0a4, 35, rightY, 24)
    add("path", { d: "M12 22V10 M38 " + rightY + "V" + (rightY - 12), stroke: "currentColor" })
    const curve = tie ? "M13 25Q22 31 32 25Q22 29 13 25" : "M7 8Q21-1 37 5Q22 1 7 8"
    add("path", { d: curve, fill: "currentColor" })
    if (!entry.linked) {
      add("path", { d: "M18 18l9 11M27 18l-9 11", stroke: "currentColor", "stroke-width": 1.5 })
    }
  } else if (entry.beam) {
    const split = entry.beam === "splitBeam"
    const end = entry.beam === "automaticBeam" ? 10 : 8
    glyph(0xe0a4, 11, 24, 24)
    glyph(0xe0a4, 27, 21, 24)
    add("path", { d: "M14 24V" + (end + 3) + "M30 21V" + end, stroke: "currentColor" })
    if (split) {
      glyph(0xe240, 16, end + 3, 18)
      glyph(0xe240, 32, end, 18)
    } else {
      add("path", { d: "M14 " + (end + 3) + "L30 " + end, stroke: "currentColor", "stroke-width": 2.5 })
    }
    if (entry.beam === "automaticBeam") {
      add("path", { d: "M33 25a4 4 0 1 1 0 5m0-5h3v3", stroke: "currentColor", fill: "none" })
    }
  } else if (entry.signature !== undefined) {
    const sharp = entry.signature > 0
    const steps = sharp ? sharpSteps : flatSteps
    const offset = keyClefOffset[entry.clef] ?? 0
    const count = Math.abs(entry.signature)
    for (let i = 0; i < count; i++) {
      glyph(sharp ? 0xe262 : 0xe260, 22 + (i - (count - 1) / 2) * 5, 11 + (steps[i] + offset) * 1.8, 17)
    }
  } else if (entry.meter) {
    const [count, denominator] = entry.meter.split("/").map(Number)
    glyph(0xe080 + count, 22, 15, 24)
    glyph(0xe080 + denominator, 22, 27, 24)
  } else if (entry.pitches) {
    const heads = entry.pitches.slice().sort((a, b) => a.step - b.step)
    const yAt = step => 11 + Math.max(-4, Math.min(12, step)) * 1.8
    const top = yAt(heads[0].step)
    const bottom = yAt(heads.at(-1).step)
    const up = (top + bottom) / 2 >= 17
    const head = entry.duration < 0 ? 0xe0a0 : entry.duration === 1 ? 0xe0a2 : entry.duration === 2 ? 0xe0a3 : 0xe0a4
    const ledgers = new Set()
    for (const [index, { step, accidental }] of heads.entries()) {
      const y = yAt(step)
      const adjacent = index > 0 && step - heads[index - 1].step === 1
      for (const line of [-4, -2, 10, 12]) {
        if (line < 0 ? line >= step : line <= step) ledgers.add(line)
      }
      glyph(head, 21 + (adjacent ? up ? 5 : -5 : 0), y, 24)
      if (accidental) glyph({ "#": 0xe262, b: 0xe260, n: 0xe261 }[accidental], 11, y, 19)
      dots(30, y - (step % 2 === 0 ? .9 : 0))
    }
    for (const line of ledgers) add("path", { d: "M14 " + yAt(line) + "h14", stroke: "currentColor", opacity: ".65" })
    if (entry.duration > 1) {
      const x = up ? 24 : 18
      const end = up ? Math.max(2, top - 11) : Math.min(32, bottom + 11)
      add("path", { d: "M" + x + " " + (up ? bottom : top) + "V" + end, stroke: "currentColor" })
      if (entry.duration > 4) glyph((up ? 0xe240 : 0xe241) + 2 * (Math.log2(entry.duration) - 3), x + 2, end, 17)
    }
  } else if (entry.clefStep !== undefined) {
    glyph(entry.glyph, 22, 11 + entry.clefStep * 1.8, 18)
  } else {
    glyph(entry.glyph, 22, 23, 24)
    dots(31, entry.rest ? 20 : 23)
  }
  return svg
}
