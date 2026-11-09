export const typeOption = {
  type: "select",
  control: "select",
  label: { _: "Type", de: "Typ" },
  options: [
    { value: "standard", label: { _: "Standard staff", de: "Notensystem" } },
    { value: "guitar-tab", label: { _: "Guitar tab", de: "Gitarren-Tab" } },
    { value: "drum-tab", label: { _: "Drum tab", de: "Drum-Tab" } },
    { value: "jianpu", label: { _: "Jianpu", de: "Jianpu" } },
  ],
}

export const sizeOption = {
  type: "select",
  control: "select",
  label: { _: "Size", de: "Größe" },
  options: [
    { value: "compact", label: { _: "Compact", de: "Kompakt" } },
    { value: "normal", label: { _: "Normal", de: "Normal" } },
    { value: "spacious", label: { _: "Spacious", de: "Großzügig" } },
  ],
}

const en = {
  importScore: "Import MusicXML", play: "Play", pause: "Pause", stop: "Stop",
  insert: "Edit beat. Double-click to place a note.", note: "Edit note. Drag vertically to change pitch.",
  selectNote: "Select note",
  beat: "Select beat. Drag to select a passage.",
  duration: "Choose note duration", clef: "Choose clef", meter: "Choose time signature", key: "Key signature",
  major: "major", minor: "minor",
  searchScore: "Search score choices", scoreChoices: "Score choices", noScoreChoices: "No matching choices",
  instrument: "Playback instrument", instrumentFor: "Playback instrument for {part}", searchInstruments: "Search instruments",
  rest: "Rest", replaceWithRest: "Replace with rest", addPitch: "Add", removeNote: "Remove note",
  chord: "Chord", dotted: "dotted", doubleDotted: "double-dotted",
  clearPassage: "Clear passage", meterName: "time signature",
  beam: "Beam together", splitBeam: "Split beam", automaticBeam: "Automatic beaming",
  tie: "Tie matching pitches", slur: "Slur phrase", untie: "Remove tie", unslur: "Remove slur",
  triplet: "Triplet · 3:2", tuplet: "Tuplet", grace: "Grace note", graceNotes: "Grace notes",
  marks: "Articulations & ornaments", removeMark: "Remove {mark}",
  staccato: "Staccato", tenuto: "Tenuto", accent: "Accent", fermata: "Fermata", trill: "Trill", turn: "Turn",
  text: "Score text", dynamics: "Dynamics", addText: "Add note...", removeDynamic: "Remove dynamic",
  lyric: "Lyric syllable", addLyric: "Add syllable...",
  title: "Score title", subtitle: "Score subtitle", addTitle: "Add title", addSubtitle: "Add subtitle",
  crescendo: "Crescendo", diminuendo: "Diminuendo", removeHairpin: "Remove hairpin",
  treble: "Treble clef", bass: "Bass clef", alto: "Alto clef", tenor: "Tenor clef",
  tempo: "Edit tempo", append: "Add a measure", bpm: "Beats per minute",
  appendDrag: "Click to add a measure. Drag the end bar to add or remove measures.",
  whole: "Whole note", half: "Half note", quarter: "Quarter note", eighth: "Eighth note",
  sixteenth: "Sixteenth note", thirtySecond: "Thirty-second note", sixtyFourth: "Sixty-fourth note",
  wholeRest: "Whole rest", halfRest: "Half rest", quarterRest: "Quarter rest", eighthRest: "Eighth rest",
  sixteenthRest: "Sixteenth rest", thirtySecondRest: "Thirty-second rest", sixtyFourthRest: "Sixty-fourth rest",
  importError: "Could not import this MusicXML file. Check the format and try again.",
  readError: "Could not read the score saved in this document.",
  renderError: "The score or audio could not load.",
  "guitar-tab": "Parts without playable guitar fingerings use standard notation.",
  "drum-tab": "Drum tab applies to percussion parts. Other parts use standard notation.",
  jianpu: "Percussion parts use standard notation.",
}

const de = {
  importScore: "MusicXML importieren", play: "Abspielen", pause: "Pausieren", stop: "Stopp",
  insert: "Schlag bearbeiten. Doppelklick setzt eine Note.", note: "Note bearbeiten. Senkrechtes Ziehen ändert die Tonhöhe.",
  selectNote: "Note auswählen",
  beat: "Schlag auswählen. Ziehen, um eine Passage auszuwählen.",
  duration: "Notenwert wählen", clef: "Notenschlüssel wählen", meter: "Taktart wählen", key: "Tonart",
  major: "Dur", minor: "Moll",
  searchScore: "Partituroptionen suchen", scoreChoices: "Partituroptionen", noScoreChoices: "Keine passenden Optionen",
  instrument: "Wiedergabeinstrument", instrumentFor: "Wiedergabeinstrument für {part}", searchInstruments: "Instrumente suchen",
  rest: "Pause", replaceWithRest: "Durch Pause ersetzen", addPitch: "Hinzufügen", removeNote: "Note entfernen",
  chord: "Akkord", dotted: "punktiert", doubleDotted: "doppelt punktiert",
  clearPassage: "Passage leeren", meterName: "Takt",
  beam: "Mit Balken verbinden", splitBeam: "Balken trennen", automaticBeam: "Automatische Balken",
  tie: "Gleiche Töne halten", slur: "Phrasierungsbogen setzen", untie: "Haltebogen entfernen", unslur: "Phrasierungsbogen entfernen",
  triplet: "Triole · 3:2", tuplet: "N-Tole", grace: "Vorschlag", graceNotes: "Vorschläge",
  marks: "Artikulation und Verzierungen", removeMark: "{mark} entfernen",
  staccato: "Staccato", tenuto: "Tenuto", accent: "Akzent", fermata: "Fermate", trill: "Triller", turn: "Doppelschlag",
  text: "Partiturtext", dynamics: "Dynamik", addText: "Text hinzufügen...", removeDynamic: "Dynamik entfernen",
  lyric: "Liedsilbe", addLyric: "Silbe eingeben...",
  title: "Partiturtitel", subtitle: "Partituruntertitel", addTitle: "Titel hinzufügen", addSubtitle: "Untertitel hinzufügen",
  crescendo: "Crescendo", diminuendo: "Diminuendo", removeHairpin: "Dynamikgabel entfernen",
  treble: "Violinschlüssel", bass: "Bassschlüssel", alto: "Altschlüssel", tenor: "Tenorschlüssel",
  tempo: "Tempo bearbeiten", append: "Takt hinzufügen", bpm: "Schläge pro Minute",
  appendDrag: "Klicken fügt einen Takt hinzu. Am Schlussstrich ziehen fügt Takte hinzu oder entfernt sie.",
  whole: "Ganze Note", half: "Halbe Note", quarter: "Viertelnote", eighth: "Achtelnote",
  sixteenth: "Sechzehntelnote", thirtySecond: "Zweiunddreißigstelnote", sixtyFourth: "Vierundsechzigstelnote",
  wholeRest: "Ganze Pause", halfRest: "Halbe Pause", quarterRest: "Viertelpause", eighthRest: "Achtelpause",
  sixteenthRest: "Sechzehntelpause", thirtySecondRest: "Zweiunddreißigstelpause", sixtyFourthRest: "Vierundsechzigstelpause",
  importError: "Diese MusicXML-Datei konnte nicht importiert werden. Prüfe das Dateiformat.",
  readError: "Die gespeicherte Partitur konnte nicht gelesen werden.",
  renderError: "Partitur oder Audio konnten nicht geladen werden.",
  "guitar-tab": "Stimmen ohne spielbare Gitarrengriffe erscheinen in Standardnotation.",
  "drum-tab": "Die Schlagzeugtabulatur gilt für Schlagzeugstimmen. Andere Stimmen erscheinen in Standardnotation.",
  jianpu: "Schlagzeugstimmen erscheinen in Standardnotation.",
}

export const importLabel = { _: en.importScore, de: de.importScore }

export function messages(element) {
  const lang = element.closest("[lang]")?.lang || element.ownerDocument.documentElement.lang
  return lang.toLowerCase().split("-")[0] === "de" ? de : en
}
