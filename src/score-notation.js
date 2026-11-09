import { model } from "./vendor/alphaTab.core.min.mjs"

export const defaultScoreType = "standard"
export const scoreTypes = [defaultScoreType, "guitar-tab", "drum-tab", "jianpu"]
export const scoreScales = { compact: 0.7, normal: 0.8, spacious: 1 }

export function configureBlankInstrument(staff, track, type) {
  if (type === "guitar-tab") {
    staff.stringTuning = model.Tuning.getDefaultTuningFor(6)
    track.playbackInfo.program = 25
  } else if (type === "drum-tab") {
    staff.isPercussion = true
    track.playbackInfo.primaryChannel = 9
    track.playbackInfo.secondaryChannel = 9
  }
}

function useGuitarTab(staff) {
  if (staff.isPercussion) return false
  const tuning = staff.isStringed ? staff.stringTuning : model.Tuning.getDefaultTuningFor(6)
  const openStrings = tuning.tunings.slice().reverse().map(pitch => pitch + staff.capo)
  const fingerings = new Map()
  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        const occupied = new Set()
        const pitched = []
        for (const note of beat.notes) {
          if (note.isStringed) occupied.add(note.string)
          else if (note.isPiano && note.harmonicType !== model.HarmonicType.Natural) pitched.push(note)
          else return false
        }
        // Reserve the string from the tie origin before placing other chord notes.
        pitched.sort((a, b) => Number(b.isTieDestination) - Number(a.isTieDestination) || b.realValue - a.realValue)
        for (const note of pitched) {
          const pitch = note.octave * 12 + note.tone
          const tiedString = note.tieOrigin && (fingerings.get(note.tieOrigin)?.string ?? note.tieOrigin.string)
          let string = tiedString
          if (!note.isTieDestination) {
            for (string = openStrings.length; string > 0; string--) {
              const fret = pitch - openStrings[string - 1]
              if (!occupied.has(string) && fret >= 0 && fret <= 24) break
            }
          }
          const fret = pitch - openStrings[string - 1]
          if (!Number.isInteger(fret) || fret < 0 || fret > 24 || occupied.has(string)) return false
          occupied.add(string)
          fingerings.set(note, { string, fret })
        }
      }
    }
  }
  staff.stringTuning = tuning
  for (const [note, fingering] of fingerings) Object.assign(note, fingering)
  return true
}

// Apply display flags and any derived fingerings only to the score used for rendering.
// Authoring commands read the original score data from the document.
export function applyScoreType(score, type) {
  let usedStandardStaff = false
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      staff.showTablature = type === "guitar-tab" ? useGuitarTab(staff) : type === "drum-tab" && staff.isPercussion
      staff.showNumbered = type === "jianpu" && !staff.isPercussion
      staff.showStandardNotation = !staff.showTablature && !staff.showNumbered
      staff.showSlash = false
      usedStandardStaff ||= staff.showStandardNotation
    }
  }
  return usedStandardStaff && type !== defaultScoreType
}
