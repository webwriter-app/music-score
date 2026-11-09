import { midi, model } from "./vendor/alphaTab.core.min.mjs"
import { beatAddress, findBeat, isAvailableRest, readScore, restDurations, serializeScore } from "./score-model.js"

const format = "webwriter-score-passage-1"
const maxLength = 8 * 1024 * 1024
const whole = new midi.MidiFile().division * 4
const { AccentuationType, BeatBeamingMode, CrescendoType, Duration, Fermata, FermataType, GraceType, NoteOrnament } = model
const linkFields = [
  "tieoriginnoteid", "tiedestinationnoteid", "sluroriginnoteid", "slurdestinationnoteid",
  "hammerpulloriginnoteid", "hammerpulldestinationnoteid", "slideoriginnoteid", "slidetargetnoteid",
]
const noteLinkProperties = {
  tie: ["tieOrigin", "tieDestination", "isTieDestination"],
  slur: ["slurOrigin", "slurDestination", "isSlurDestination"],
}

export function sameVoice(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[3] === b[3]
}

const compare = (a, b) => a[2] - b[2] || a[4] - b[4]

export function passageBetween(a, b) {
  return compare(a, b) <= 0 ? { first: a, last: b } : { first: b, last: a }
}

export function inPassage(address, passage) {
  return sameVoice(address, passage.first)
    && compare(address, passage.first) >= 0 && compare(address, passage.last) <= 0
}

function isBeamable(beat) {
  return beat && !beat.isRest && !beat.deadSlapped && beat.duration >= Duration.Eighth && beat.graceType === GraceType.None
}

function canJoinBeam(left, right) {
  return isBeamable(left) && isBeamable(right) && left.tupletGroup === right.tupletGroup
    && left.displayStart + left.displayDuration === right.displayStart
}

export function passageBeamLinks(score, passage) {
  const first = passage && findBeat(score, passage.first)
  const last = passage && findBeat(score, passage.last)
  if (!first || !last || !sameVoice(passage.first, passage.last)) return null
  const joins = []
  const edges = []
  const { staff } = first.voice.bar
  for (const bar of staff.bars.slice(first.voice.bar.index, last.voice.bar.index + 1)) {
    const beats = bar.voices[first.voice.index]?.beats
    if (!beats) continue
    const start = bar === first.voice.bar ? first.index : 0
    const end = bar === last.voice.bar ? last.index : beats.length - 1
    for (let i = start; i < end; i++) {
      if (!canJoinBeam(beats[i], beats[i + 1])) continue
      // alphaTab stores each connection on the beat to its left.
      joins.push(beats[i])
      if (i === start && canJoinBeam(beats[i - 1], beats[i])) edges.push(beats[i - 1])
      if (i === end - 1 && canJoinBeam(beats[i + 1], beats[i + 2])) edges.push(beats[i + 1])
    }
  }
  return joins.length ? { joins, edges } : null
}

export function setPassageBeaming({ joins, edges }, mode) {
  let changed = false
  for (const beat of joins) {
    if (beat.beamingMode === mode) continue
    beat.beamingMode = mode
    changed = true
  }
  if (mode === BeatBeamingMode.ForceSplitToNext) return changed
  const edgeMode = mode === BeatBeamingMode.Auto ? mode : BeatBeamingMode.ForceSplitToNext
  for (const beat of edges) {
    if (beat.beamingMode === edgeMode) continue
    beat.beamingMode = edgeMode
    changed = true
  }
  return changed
}

function timeline(score, [track, staff, , voice], from = 0, to = score.masterBars.length) {
  let barStart = score.masterBars.slice(0, from).reduce((time, measure) => time + measure.calculateDuration(), 0)
  return score.masterBars.slice(from, to).map((measure, index) => {
    const start = barStart
    barStart += measure.calculateDuration()
    const beats = score.tracks[track]?.staves[staff]?.bars[from + index]?.voices[voice]?.beats ?? []
    return {
      start, end: barStart, slots: beats.map(beat => ({
        beat, start: start + beat.displayStart, end: start + beat.displayStart + beat.displayDuration,
      })),
    }
  })
}

function selectedSlots(score, { first, last }) {
  if (!sameVoice(first, last) || !findBeat(score, first) || !findBeat(score, last)) return []
  return timeline(score, first, first[2], last[2] + 1).flatMap(bar => bar.slots)
    .filter(({ beat }) => inPassage(beatAddress(beat), { first, last }))
}

export function passageHairpinChanges(score, passage) {
  if (!passage) return []
  const beats = selectedSlots(score, passage).map(({ beat }) => beat)
    .filter(beat => !beat.isEmpty && beat.graceType === GraceType.None)
  const choices = []
  const add = (id, direction, targets) => choices.push({ id, direction, apply: () => {
    for (const beat of targets) beat.crescendo = direction
    return true
  } })
  if (beats.length > 1 && beats.some(beat => !beat.isRest)) {
    for (const [id, direction] of [["crescendo", CrescendoType.Crescendo], ["diminuendo", CrescendoType.Decrescendo]]) {
      const targets = beats.filter(beat => beat.crescendo !== direction)
      if (targets.length) add(id, direction, targets)
    }
  }
  const marked = new Set()
  for (const beat of beats) {
    if (!beat.crescendo || marked.has(beat)) continue
    marked.add(beat)
    for (const edge of ["previousBeat", "nextBeat"]) {
      for (let neighbor = beat[edge]; neighbor && sameVoice(beatAddress(beat), beatAddress(neighbor)); neighbor = neighbor[edge]) {
        if (neighbor.graceType !== GraceType.None) continue
        if (neighbor.crescendo !== beat.crescendo) break
        marked.add(neighbor)
      }
    }
  }
  if (marked.size) add("removeHairpin", CrescendoType.None, marked)
  return choices
}

function selectedNotes(slots, index) {
  return slots.flatMap(({ beat }) => index === undefined ? beat.notes : beat.notes.slice(index, index + 1))
}

function canOrnament(note) {
  return (note.isPiano || note.isStringed) && !note.isTieDestination && !note.hasBend
}

function trillPitch(note) {
  return note.calculateRealValue(false, false) + 2
}

const noteMarks = [
  ["staccato", note => note.isStaccato, (note, apply) => { note.isStaccato = apply }],
  ["tenuto", note => note.accentuated === AccentuationType.Tenuto, (note, apply) => {
    note.accentuated = apply ? AccentuationType.Tenuto : AccentuationType.None
  }],
  ["accent", note => note.accentuated === AccentuationType.Normal || note.accentuated === AccentuationType.Heavy, (note, apply) => {
    note.accentuated = apply ? AccentuationType.Normal : AccentuationType.None
  }],
  ["trill", note => note.isTrill, (note, apply) => {
    note.trillValue = apply ? trillPitch(note) : -1
    note.isTrillStart = apply
    if (apply) {
      note.trillSpeed = Duration.ThirtySecond
      note.ornament = NoteOrnament.None
    }
  }, note => canOrnament(note) && trillPitch(note) <= 127],
  ["turn", note => note.ornament === NoteOrnament.Turn || note.ornament === NoteOrnament.InvertedTurn, (note, apply) => {
    note.ornament = apply ? NoteOrnament.Turn : NoteOrnament.None
    if (apply) {
      note.trillValue = -1
      note.isTrillStart = false
    }
  }, canOrnament],
]

export function passageMarkChanges(score, passage) {
  if (!passage) return []
  const notes = selectedNotes(selectedSlots(score, passage), passage.note)
  if (!notes.length) return []
  const changes = []
  for (const [mark, hasMark, setMark, canApply] of noteMarks) {
    const unmarked = notes.filter(note => !hasMark(note) && (!canApply || canApply(note)))
    const marked = notes.filter(hasMark)
    if (unmarked.length) changes.push({ mark, remove: false, apply: () => {
      for (const note of unmarked) setMark(note, true)
      return true
    } })
    if (marked.length) changes.push({ mark, remove: true, apply: () => {
      for (const note of marked) setMark(note, false)
      return true
    } })
  }

  // Fermatas live on the master measure, so a marking applies to the entire onset.
  const marked = []
  const unmarked = []
  for (const beat of new Set(notes.map(note => note.beat))) {
    const master = beat.voice.bar.masterBar
    if (master.getFermata(beat)) {
      const offset = master.fermata.has(beat.playbackStart) ? beat.playbackStart : 0
      marked.push({ master, offset })
    } else if (beat.graceType === GraceType.None) unmarked.push({ master, offset: beat.playbackStart })
  }
  if (unmarked.length) changes.push({ mark: "fermata", remove: false, apply: () => {
    for (const { master, offset } of unmarked) {
      const fermata = new Fermata()
      fermata.type = FermataType.Medium
      master.addFermata(offset, fermata)
    }
    return true
  } })
  if (marked.length) changes.push({ mark: "fermata", remove: true, apply: () => {
    for (const { master, offset } of marked) {
      master.fermata?.delete(offset)
      if (master.fermata?.size === 0) master.fermata = null
    }
    return true
  } })
  return changes
}

function matchingPitch(origin, destination) {
  return origin.realValue === destination.realValue && origin.isStringed === destination.isStringed
    && (!origin.isStringed || origin.string === destination.string && origin.fret === destination.fret)
}

function existingNoteLinks(notes, kind, includeOutside) {
  const [originKey, destinationKey] = noteLinkProperties[kind]
  const pairs = new Map()
  for (const note of notes) {
    const destination = note[destinationKey]
    if (destination && (includeOutside || notes.has(destination))) pairs.set(note, destination)
    const origin = note[originKey]
    if (includeOutside && origin) pairs.set(origin, note)
  }
  return [...pairs]
}

export function passageNoteLinks(score, passage) {
  if (!passage) return null
  const slots = selectedSlots(score, passage)
  if (!slots.length) return null
  const { note: noteIndex } = passage
  const notes = new Set(selectedNotes(slots, noteIndex))
  const includeOutside = slots.length === 1
  const untie = existingNoteLinks(notes, "tie", includeOutside)
  const unslur = existingNoteLinks(notes, "slur", includeOutside)
  const tie = []
  const slur = []
  const beats = slots.filter(({ beat }) => beat.graceType === GraceType.None).map(slot => ({
    ...slot, notes: slot.beat.notes.filter(note => notes.has(note) && !note.isPercussion),
  }))
  const used = new Set()
  for (let i = 1; i < beats.length; i++) {
    const before = beats[i - 1]
    const after = beats[i]
    if (before.end !== after.start) continue
    for (const origin of before.notes) {
      if (origin.tieDestination || origin.hasBend) continue
      const destination = after.notes.find(note => !note.isTieDestination && !note.tieOrigin
        && !note.hasBend && !used.has(note) && matchingPitch(origin, note))
      if (destination) {
        tie.push([origin, destination])
        used.add(destination)
      }
    }
  }
  const sounded = beats.filter(({ notes }) => notes.length)
  if (sounded.length >= 2) {
    // Use the top note at either end when a phrase begins or ends on a chord.
    const top = ({ notes }) => notes.reduce((highest, note) => note.realValue > highest.realValue ? note : highest)
    const origin = top(sounded[0])
    const destination = top(sounded.at(-1))
    if (!origin.slurDestination && !destination.slurOrigin && !destination.isSlurDestination) slur.push([origin, destination])
  }
  return { tie, slur, untie, unslur }
}

export function setPassageNoteLinks(pairs, kind, linked) {
  const [originKey, destinationKey, flag] = noteLinkProperties[kind]
  for (const [origin, destination] of pairs) {
    origin[destinationKey] = linked ? destination : null
    destination[originKey] = linked ? origin : null
    destination[flag] = linked
    if (kind === "tie" && !linked && destination.bendOrigin === origin) destination.bendOrigin = null
  }
  return pairs.length > 0
}

function rawVoice(raw, [track, staff, bar, voice]) {
  return raw.score.tracks[track].staves[staff].bars[bar].voices[voice].beats
}

function staffSignature(staff) {
  return JSON.stringify([staff.isPercussion, staff.tuning, staff.capo, staff.transpositionPitch,
    staff.isPercussion ? staff.track.percussionArticulations : null])
}

function collect(score, raw, { first, last, note }) {
  const slots = selectedSlots(score, { first, last })
  if (!slots.length) return null
  const entries = slots.map(({ beat, start, end }) => {
    const address = beatAddress(beat)
    const data = rawVoice(raw, address)[beat.index]
    const notes = data.notes ?? []
    return { beat, start, end, data, notes: note === undefined ? notes : notes.slice(note, note + 1) }
  })
  return entries
}

function selectedIds(entries) {
  return new Set(entries.flatMap(({ notes }) => notes.map(note => note.id)))
}

function remove(entries) {
  const ids = selectedIds(entries)
  if (!ids.size || entries.some(({ beat, notes }) => beat.graceType || beat.graceGroup || notes.some(note =>
    linkFields.some(field => note[field] !== undefined && !ids.has(note[field]))))) return false
  for (const { data, notes } of entries) {
    data.notes = (data.notes ?? []).filter(note => !notes.includes(note))
  }
  return true
}

function fragment(entries) {
  if (!entries?.some(entry => entry.notes.length) || entries.some(({ beat, start, end }, index) =>
    beat.isEmpty || beat.graceType || beat.graceGroup || beat.hasTuplet || !Number.isInteger(end - start)
    || end <= start || (index > 0 && entries[index - 1].end !== start))) return null
  const ids = selectedIds(entries)
  return {
    format, staff: staffSignature(entries[0].beat.voice.bar.staff),
    beats: entries.map(({ data, notes, start, end }) => ({
      ticks: end - start,
      data: { ...data, notes: notes.map(note => {
        const copy = { ...note }
        for (const field of linkFields) {
          if (copy[field] !== undefined && !ids.has(copy[field])) {
            delete copy[field]
            if (field === "tieoriginnoteid") copy.istiedestination = false
            if (field === "sluroriginnoteid") copy.isslurdestination = false
          }
        }
        return copy
      }) },
    })),
  }
}

export function copyPassage(score, selection) {
  const raw = JSON.parse(serializeScore(score))
  return fragment(collect(score, raw, selection))
}

export function readPassage(text) {
  if (!text || text.length > maxLength) return null
  try {
    const data = JSON.parse(text)
    if (data?.format === format && typeof data.staff === "string" && Array.isArray(data.beats)
      && data.beats.length && data.beats.every(entry => Number.isSafeInteger(entry?.ticks)
        && entry.ticks > 0 && Array.isArray(entry.data?.notes)
        && entry.data.notes.every(note => Number.isSafeInteger(note?.id)))) return data
  } catch {}
  return null
}

function rests(ticks) {
  const beats = []
  for (const duration of restDurations) {
    const length = whole / duration
    while (ticks >= length) {
      beats.push({ duration })
      ticks -= length
    }
  }
  return ticks === 0 ? beats : null
}

function placedBeats(raw, source) {
  // IDs identify rendered beats and tie/slur endpoints, so pasted music needs fresh IDs.
  let nextBeat = 0
  let nextNote = 0
  for (const track of raw.score.tracks) {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            nextBeat = Math.max(nextBeat, beat.id + 1)
            for (const note of beat.notes ?? []) nextNote = Math.max(nextNote, note.id + 1)
          }
        }
      }
    }
  }
  const ids = new Map()
  for (const { data } of source.beats) {
    for (const note of data.notes) ids.set(note.id, nextNote++)
  }
  const beats = source.beats.map(({ data, ticks }) => ({
    ticks, data: {
      ...data, id: nextBeat++, overridedisplayduration: ticks,
      notes: data.notes.map(note => {
        const copy = { ...note, id: ids.get(note.id) }
        for (const field of linkFields) {
          if (copy[field] !== undefined) copy[field] = ids.get(copy[field])
        }
        return copy
      }),
    },
  }))
  return { beats, nextBeat }
}

function place(score, raw, source, target, offset = 0, freed = new Set()) {
  const targetBeat = findBeat(score, target)
  if (!targetBeat || staffSignature(targetBeat.voice.bar.staff) !== source.staff) return null
  const bars = timeline(score, target)
  const anchor = bars[target[2]].slots.find(({ beat }) => beat === targetBeat)
  const start = anchor.start - offset
  const end = start + source.beats.reduce((sum, item) => sum + item.ticks, 0)
  if (start < 0 || end > bars.at(-1).end) return null
  const { beats, nextBeat } = placedBeats(raw, source)
  let restId = nextBeat
  let time = start
  let index = 0
  let first
  let last
  for (const bar of bars) {
    const from = Math.max(start, bar.start)
    const to = Math.min(end, bar.end)
    if (from >= to) continue
    const slots = bar.slots.filter(slot => slot.end > from && slot.start < to)
    if (!slots.length || slots[0].start > from || slots.at(-1).end < to
      || slots.some((slot, i) => (i > 0 && slots[i - 1].end !== slot.start)
        || (!freed.has(slot.beat) && !isAvailableRest(slot.beat)))) return null
    const address = beatAddress(slots[0].beat)
    const before = rests(from - slots[0].start)
    const after = rests(slots.at(-1).end - to)
    if (!before || !after) return null
    const replacement = before
    const firstHere = [...address.slice(0, 4), address[4] + replacement.length]
    while (time < to) {
      const entry = beats[index]
      const next = time + entry.ticks
      if (next <= to && entry.ticks === entry.data.overridedisplayduration) replacement.push(entry.data)
      else {
        if (entry.data.notes.length) return null
        const split = rests(Math.min(next, to) - Math.max(time, from))
        if (!split) return null
        replacement.push(...split)
      }
      if (next <= to) index++
      time = Math.min(next, to)
      if (next > to) entry.ticks = next - to
    }
    first ??= firstHere
    last = [...address.slice(0, 4), address[4] + replacement.length - 1]
    const newBeats = [...replacement, ...after]
    for (const beat of newBeats) if (beat.id === undefined) beat.id = restId++
    rawVoice(raw, address).splice(address[4], slots.length, ...newBeats)
  }
  return first && { first, last }
}

export function editPassage(score, { selection, source, target, grab }) {
  const raw = JSON.parse(serializeScore(score))
  const entries = selection && collect(score, raw, selection)
  if (selection && !entries) return null
  let offset = 0
  let freed
  if (grab) {
    if (!target || compare(grab, target) === 0) return null
    source = fragment(entries)
    if (!source) return null
    const grabbed = entries.find(({ beat }) => compare(beatAddress(beat), grab) === 0)
    if (!grabbed) return null
    offset = grabbed.start - entries[0].start
    freed = new Set(entries.filter(({ beat, data, notes }) =>
      notes.length === (data.notes ?? []).length && !beat.text && !beat.lyrics?.length
      && !beat.chordId && !beat.fermata && !beat.automations.length && !beat.style).map(entry => entry.beat))
  }
  if (entries && !remove(entries)) return null
  try {
    const placed = source && target && place(score, raw, source, target, offset, freed)
    if (source && !placed) return null
    if (!entries && !placed) return null
    return { text: serializeScore(readScore(JSON.stringify(raw))), passage: placed ?? null }
  } catch {
    return null
  }
}
