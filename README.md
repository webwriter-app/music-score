# Music Score (`@webwriter/music-score@1.1.0`)
[License: MIT](LICENSE) | Version: 1.1.0

Import, edit, and play scores in a WebWriter document.

## Snippets
[Snippets](https://webwriter.app/docs/snippets/snippets/) are examples and templates using the package's widgets.

| Name | Import Path |
| :--: | :---------: |
| Practice Phrase | `@webwriter/music-score/snippets/practice-phrase.html` |
| Bach Prelude | `@webwriter/music-score/snippets/bach-prelude.html` |
| Guitar Tab | `@webwriter/music-score/snippets/guitar-tab.html` |
| Drum Tab | `@webwriter/music-score/snippets/drum-tab.html` |
| Jianpu | `@webwriter/music-score/snippets/jianpu.html` |



## `WebwriterMusicScore` (`<webwriter-music-score>`)
Create, import and play scores. A score is stored as alphaTab JSON in a
`<script type="application/json" slot="data" data-music-score>` child; without it the widget starts with a blank score.
MusicXML files (`.musicxml`, `.xml`, `.mxl`, up to 8 MiB) are imported through the `importMusicXML` action.

Music Score bundles alphaTab 1.9.0 under the Mozilla Public License 2.0 (https://www.mozilla.org/MPL/2.0/).
The bundled JavaScript keeps the upstream copyright and license notices. `scripts/alphatab.mjs` reproduces the changes
applied to the pinned release (https://github.com/CoderLine/alphaTab/releases/tag/v1.9.0).

### Usage

Use with a CDN (e.g. [jsdelivr](https://jsdelivr.com)):
```html
<script type="importmap">
{
  "imports": {
    "@webwriter/widget/permissions": "https://cdn.jsdelivr.net/npm/@webwriter/widget@1.6.0/permissions.js"
  }
}
</script>
<script type="module" src="https://cdn.jsdelivr.net/npm/@webwriter/music-score@1.0.0/dist/widgets/webwriter-music-score.js"></script>
<webwriter-music-score></webwriter-music-score>
```

Or use with a bundler (e.g. [Vite](https://vite.dev)):

```
npm install @webwriter/music-score
```

```html
<script type="module" src="@webwriter/music-score/widgets/webwriter-music-score.js"></script>
<webwriter-music-score></webwriter-music-score>
```

## Fields
| Name (Attribute Name) | Type | Description | Default | Reflects |
| :-------------------: | :--: | :---------: | :-----: | :------: |
| `WebwriterMusicScore.convertFrom` | `object` | - | `{ ".musicxml": "importScoreFile", ".mxl": "importScoreFile", ".xml": "importScoreFile" }` | ✗ |
| `WebwriterMusicScore.convertTo` | `object` | - | `{ "audio/midi": "exportMidiFile", ".gp": "exportGuitarProFile" }` | ✗ |
| `options` | - | - | - | ✗ |
| `allowReaderEditing` | `boolean` | Whether readers can edit this score. Defaults to true. | - | ✗ |
| `actions` | - | - | - | ✗ |
| `type` | `string` | - | - | ✗ |
| `size` | `keyof typeof scoreScales` | - | - | ✗ |
| `innerHTML` | - | - | `template` | ✗ |

*Fields including [properties](https://developer.mozilla.org/en-US/docs/Glossary/Property/JavaScript) and [attributes](https://developer.mozilla.org/en-US/docs/Glossary/Attribute) define the current state of the widget and offer customization options.*

## Methods
| Name | Description | Parameters |
| :--: | :---------: | :-------: |
| `focus` | - | `options: FocusOptions`
| `importMusicXML` | - | `[file]: File[]`
| `importScoreFile` | Parses a whole MusicXML file first, then returns the function that replaces the score. | `file: File`
| `exportMidiFile` | - | -
| `exportGuitarProFile` | - | -

*[Methods](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Method_definitions) allow programmatic access to the widget.*

## Events
| Name | Description |
| :--: | :---------: |
| optionschange | - |

*[Events](https://developer.mozilla.org/en-US/docs/Web/Events) are dispatched by the widget after certain triggers.*

## CSS parts
| Name | Description |
| :--: | :---------: |
| sheet | The paper the score is engraved on (a white sheet with black ink). |
| notice | The status line that reports an unreadable score or a notation change. Theme: the interface follows `--ww-text-color` and `--ww-font-family` of the document. The selection, the playback cursor and the focus ring use `--ww-theme-accent-1` (give it enough contrast on white). The engraving fonts stay fixed, because alphaTab measures the score with them. Files: MusicXML (`.musicxml`, `.xml`, `.mxl`) can be imported through `convertFrom`; the whole file is parsed before the score is replaced. The score exports as a MIDI file (`audio/midi`: notes, tempo, instruments and repeats; engraving, lyrics and text are dropped) and as a Guitar Pro 7 file (`.gp`). alphaTab has no MusicXML writer, so MusicXML is import only. There are no signals: nothing in this widget has a value that another widget could use. Keyboard: when score editing is available, every note, rest, beat and score text is a tab stop. Enter or Space selects it, arrow keys move, and typing opens the entry field. Touch: tap selects, a drag moves a note or changes its pitch. Print: the score prints without controls. |

*[CSS parts](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_shadow_parts) allow freely styling internals of the widget with CSS.*

## Editing config
| Name | Value |
| :--: | :---------: |
| `label` | `[object Object]` |
| `importFormats` | `.musicxml,.mxl,.xml` |
| `exportFormats` | `audio/midi,.gp` |

*The [editing config](https://webwriter.app/docs/packages/configuring/#editingconfig) defines how explorable authoring tools such as [WebWriter](https://webwriter.app) treat the widget.*

*No public slots, or custom CSS properties.*


---
*Generated with @webwriter/build@1.15.0*