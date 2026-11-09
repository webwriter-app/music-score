import { model } from "./vendor/alphaTab.core.min.mjs"

// General MIDI program order, with zero-based numbers as stored by alphaTab.
const programs = [
  "Grand Piano", "Bright Piano", "Electric Grand Piano", "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Nylon-string Guitar", "Steel-string Guitar", "Jazz Guitar", "Clean Electric Guitar", "Muted Electric Guitar", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
  "Acoustic Bass", "Fingered Electric Bass", "Picked Electric Bass", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Square Lead", "Sawtooth Lead", "Calliope Lead", "Chiff Lead", "Charang Lead", "Voice Lead", "Fifths Lead", "Bass and Lead",
  "New Age Pad", "Warm Pad", "Polysynth Pad", "Choir Pad", "Bowed Pad", "Metallic Pad", "Halo Pad", "Sweep Pad",
  "Rain", "Soundtrack", "Crystal", "Atmosphere", "Brightness", "Goblins", "Echoes", "Sci-Fi",
  "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot",
].map((name, program) => [program, name])

const kits = [[0, "Standard Kit"], [8, "Room Kit"], [32, "Jazz Kit"], [40, "Brush Kit"]]
const drumChannel = 9
const drumBank = 128
const channelFields = ["primaryChannel", "secondaryChannel"]

export function playbackInstruments(track) {
  return track.isPercussion ? kits : programs
}

export function playbackInstrumentName(track) {
  const { program } = track.playbackInfo
  return track.isPercussion ? (kits.find(([id]) => id === program) ?? kits[0])[1]
    : programs[program]?.[1] ?? `GM ${program + 1}`
}

export function setPlaybackInstrument(track, program) {
  if (!playbackInstruments(track).some(([id]) => id === program)) return false
  const { playbackInfo } = track
  const bank = track.isPercussion ? drumBank : 0
  if (playbackInfo.program === program && (playbackInfo.bank === bank
    || (track.isPercussion && playbackInfo.bank === 0 && playbackInfo.primaryChannel === drumChannel))) return false
  playbackInfo.program = program
  playbackInfo.bank = bank

  // Program and bank changes affect a whole MIDI channel. Keep this part's
  // sound independent if an imported score reused channels across parts.
  const occupied = new Set(track.score.tracks.filter(other => other !== track)
    .flatMap(({ playbackInfo }) => channelFields.map(field => playbackInfo[field])))
  const reserved = new Set([drumChannel, ...occupied, ...channelFields.map(field => playbackInfo[field])])
  const replacements = new Map()
  for (const field of channelFields) {
    const channel = playbackInfo[field]
    if (!occupied.has(channel) && (track.isPercussion || channel !== drumChannel)) continue
    if (!replacements.has(channel)) {
      let free = 0
      while (reserved.has(free)) free++
      replacements.set(channel, free)
      reserved.add(free)
    }
    playbackInfo[field] = replacements.get(channel)
  }

  // The picker sets one sound for the entire part.
  const { Instrument, Bank } = model.AutomationType
  for (const staff of track.staves) for (const bar of staff.bars) {
    for (const voice of bar.voices) for (const beat of voice.beats) {
      beat.automations = beat.automations.filter(({ type }) => type !== Instrument && type !== Bank)
    }
  }
  return true
}
