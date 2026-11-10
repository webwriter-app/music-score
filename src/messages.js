import { localeData } from "./locale-data.js"

function optionLabels(source, existing = {}) {
  const labels = { _: source, ...existing }
  for (const [locale, data] of Object.entries(localeData)) {
    const translation = data.options?.[source]
    if (translation) labels[locale] = translation
  }
  return labels
}

export const typeOption = {
  type: "select",
  control: "select",
  label: optionLabels("Type", { de: "Typ", fr: "Type", es: "Tipo" }),
  options: [
    { value: "standard", label: optionLabels("Standard staff", { de: "Notensystem", fr: "Portée standard", es: "Pentagrama estándar" }) },
    { value: "guitar-tab", label: optionLabels("Guitar tab", { de: "Gitarren-Tab", fr: "Tablature de guitare", es: "Tablatura de guitarra" }) },
    { value: "drum-tab", label: optionLabels("Drum tab", { de: "Drum-Tab" }) },
    { value: "jianpu", label: optionLabels("Jianpu", { de: "Jianpu", fr: "Jianpu", es: "Jianpu" }) },
  ],
}

export const sizeOption = {
  type: "select",
  control: "select",
  label: optionLabels("Size", { de: "Größe", fr: "Taille", es: "Tamaño" }),
  options: [
    { value: "compact", label: optionLabels("Compact", { de: "Kompakt", fr: "Compact", es: "Compacto" }) },
    { value: "normal", label: optionLabels("Normal", { de: "Normal", fr: "Normal", es: "Normal" }) },
    { value: "spacious", label: optionLabels("Spacious", { de: "Großzügig", fr: "Spacieux", es: "Espacioso" }) },
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

const fr = {
  importScore: "Importer du MusicXML",
  play: "Lire",
  pause: "Mettre en pause",
  stop: "Arrêter",
  insert: "Modifier le temps. Double-cliquez pour placer une note.",
  note: "Modifier la note. Faites-la glisser verticalement pour changer sa hauteur.",
  selectNote: "Sélectionner une note",
  beat: "Sélectionner un temps. Faites glisser pour sélectionner un passage.",
  duration: "Choisir une valeur de note",
  clef: "Choisir une clé",
  meter: "Choisir une indication de mesure",
  key: "Armure",
  major: "majeur",
  minor: "mineur",
  searchScore: "Rechercher des options de partition",
  scoreChoices: "Options de partition",
  noScoreChoices: "Aucune option correspondante",
  instrument: "Instrument de lecture",
  instrumentFor: "Instrument de lecture pour {part}",
  searchInstruments: "Rechercher des instruments",
  rest: "Silence",
  replaceWithRest: "Remplacer par un silence",
  addPitch: "Ajouter",
  removeNote: "Supprimer la note",
  chord: "Accord",
  dotted: "pointée",
  doubleDotted: "doublement pointée",
  clearPassage: "Effacer le passage",
  meterName: "indication de mesure",
  beam: "Relier par une ligature",
  splitBeam: "Scinder la ligature",
  automaticBeam: "Ligatures automatiques",
  tie: "Lier les notes de même hauteur",
  slur: "Ajouter une liaison de phrasé",
  untie: "Supprimer la liaison de prolongation",
  unslur: "Supprimer la liaison de phrasé",
  triplet: "Triolet · 3:2",
  tuplet: "Groupe irrégulier",
  grace: "Note d’ornement",
  graceNotes: "Notes d’ornement",
  marks: "Articulations et ornements",
  removeMark: "Supprimer {mark}",
  staccato: "Staccato",
  tenuto: "Tenuto",
  accent: "Accent",
  fermata: "Point d’orgue",
  trill: "Trille",
  turn: "Gruppetto",
  text: "Texte de la partition",
  dynamics: "Nuances",
  addText: "Ajouter un texte…",
  removeDynamic: "Supprimer la nuance",
  lyric: "Syllabe des paroles",
  addLyric: "Ajouter une syllabe…",
  title: "Titre de la partition",
  subtitle: "Sous-titre de la partition",
  addTitle: "Ajouter un titre",
  addSubtitle: "Ajouter un sous-titre",
  crescendo: "Crescendo",
  diminuendo: "Diminuendo",
  removeHairpin: "Supprimer le soufflet",
  treble: "Clé de sol",
  bass: "Clé de fa",
  alto: "Clé d’ut troisième ligne",
  tenor: "Clé d’ut quatrième ligne",
  tempo: "Modifier le tempo",
  append: "Ajouter une mesure",
  bpm: "Battements par minute",
  appendDrag: "Cliquez pour ajouter une mesure. Faites glisser la barre finale pour ajouter ou supprimer des mesures.",
  whole: "Ronde",
  half: "Blanche",
  quarter: "Noire",
  eighth: "Croche",
  sixteenth: "Double croche",
  thirtySecond: "Triple croche",
  sixtyFourth: "Quadruple croche",
  wholeRest: "Pause",
  halfRest: "Demi-pause",
  quarterRest: "Soupir",
  eighthRest: "Demi-soupir",
  sixteenthRest: "Quart de soupir",
  thirtySecondRest: "Huitième de soupir",
  sixtyFourthRest: "Seizième de soupir",
  importError: "Impossible d’importer ce fichier MusicXML. Vérifiez son format et réessayez.",
  readError: "Impossible de lire la partition enregistrée dans ce document.",
  renderError: "Impossible de charger la partition ou l’audio.",
  "guitar-tab": "Les parties sans doigtés de guitare jouables utilisent la notation standard.",
  "drum-tab": "La tablature de batterie s’applique aux parties de percussion. Les autres parties utilisent la notation standard.",
  jianpu: "Les parties de percussion utilisent la notation standard.",
}

const es = {
  importScore: "Importar MusicXML",
  play: "Reproducir",
  pause: "Pausar",
  stop: "Detener",
  insert: "Editar pulso. Haz doble clic para colocar una nota.",
  note: "Editar nota. Arrástrala verticalmente para cambiar su altura.",
  selectNote: "Seleccionar nota",
  beat: "Seleccionar pulso. Arrastra para seleccionar un pasaje.",
  duration: "Elegir duración de la nota",
  clef: "Elegir clave",
  meter: "Elegir indicación de compás",
  key: "Armadura",
  major: "mayor",
  minor: "menor",
  searchScore: "Buscar opciones de partitura",
  scoreChoices: "Opciones de partitura",
  noScoreChoices: "No hay opciones coincidentes",
  instrument: "Instrumento de reproducción",
  instrumentFor: "Instrumento de reproducción para {part}",
  searchInstruments: "Buscar instrumentos",
  rest: "Silencio",
  replaceWithRest: "Sustituir por un silencio",
  addPitch: "Añadir",
  removeNote: "Eliminar nota",
  chord: "Acorde",
  dotted: "con puntillo",
  doubleDotted: "con doble puntillo",
  clearPassage: "Borrar pasaje",
  meterName: "indicación de compás",
  beam: "Unir con una barra",
  splitBeam: "Dividir barra",
  automaticBeam: "Barras automáticas",
  tie: "Ligar notas de la misma altura",
  slur: "Añadir ligadura de expresión",
  untie: "Eliminar ligadura de prolongación",
  unslur: "Eliminar ligadura de expresión",
  triplet: "Tresillo · 3:2",
  tuplet: "Grupo irregular",
  grace: "Nota de adorno",
  graceNotes: "Notas de adorno",
  marks: "Articulaciones y ornamentos",
  removeMark: "Eliminar {mark}",
  staccato: "Staccato",
  tenuto: "Tenuto",
  accent: "Acento",
  fermata: "Calderón",
  trill: "Trino",
  turn: "Grupeto",
  text: "Texto de la partitura",
  dynamics: "Dinámica",
  addText: "Añadir texto…",
  removeDynamic: "Eliminar indicación dinámica",
  lyric: "Sílaba de la letra",
  addLyric: "Añadir sílaba…",
  title: "Título de la partitura",
  subtitle: "Subtítulo de la partitura",
  addTitle: "Añadir título",
  addSubtitle: "Añadir subtítulo",
  crescendo: "Crescendo",
  diminuendo: "Diminuendo",
  removeHairpin: "Eliminar regulador",
  treble: "Clave de sol",
  bass: "Clave de fa",
  alto: "Clave de do en tercera",
  tenor: "Clave de do en cuarta",
  tempo: "Editar tempo",
  append: "Añadir un compás",
  bpm: "Pulsaciones por minuto",
  appendDrag: "Haz clic para añadir un compás. Arrastra la barra final para añadir o quitar compases.",
  whole: "Redonda",
  half: "Blanca",
  quarter: "Negra",
  eighth: "Corchea",
  sixteenth: "Semicorchea",
  thirtySecond: "Fusa",
  sixtyFourth: "Semifusa",
  wholeRest: "Silencio de redonda",
  halfRest: "Silencio de blanca",
  quarterRest: "Silencio de negra",
  eighthRest: "Silencio de corchea",
  sixteenthRest: "Silencio de semicorchea",
  thirtySecondRest: "Silencio de fusa",
  sixtyFourthRest: "Silencio de semifusa",
  importError: "No se pudo importar este archivo MusicXML. Comprueba el formato e inténtalo de nuevo.",
  readError: "No se pudo leer la partitura guardada en este documento.",
  renderError: "No se pudo cargar la partitura o el audio.",
  "guitar-tab": "Las partes sin digitaciones de guitarra que se puedan tocar usan la notación estándar.",
  "drum-tab": "La tablatura de batería se aplica a las partes de percusión. Las demás partes usan la notación estándar.",
  jianpu: "Las partes de percusión usan la notación estándar.",
}

const dictionaries = {
  en, de, fr, es,
  ...Object.fromEntries(Object.entries(localeData)
    .filter(([, data]) => data.messages)
    .map(([locale, data]) => [locale, data.messages])),
}

export function* languageAncestors(element) {
  for (let node = element; node;) {
    yield node
    const root = node.getRootNode()
    node = node.parentElement ?? (root?.host ?? null)
  }
}

export function language(element) {
  for (const node of languageAncestors(element)) {
    if (node.hasAttribute("lang")) return node.getAttribute("lang").trim().toLowerCase()
  }
  return ""
}

export function messages(element) {
  const locale = language(element)
  const exact = Object.keys(dictionaries).find(tag => tag.toLowerCase() === locale)
  if (exact) return dictionaries[exact]
  const base = locale.split("-")[0]
  const primary = Object.keys(dictionaries).find(tag => tag.toLowerCase() === base)
  return primary ? dictionaries[primary] : en
}

export function optionFor(element, option) {
  const locale = language(element)
  const base = locale.split("-")[0]
  const label = labels => {
    const exact = Object.keys(labels).find(tag => tag.toLowerCase() === locale)
    const primary = Object.keys(labels).find(tag => tag.toLowerCase() === base)
    return { _: labels[exact ?? primary ?? "_"] }
  }
  return {
    ...option,
    label: label(option.label),
    options: option.options.map(choice => ({ ...choice, label: label(choice.label) })),
  }
}
