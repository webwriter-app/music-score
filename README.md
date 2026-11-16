# Music Score (`@webwriter/music-score@0.1.0`)
[License: MIT](LICENSE) | Version: 0.1.0

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
<link href="https://cdn.jsdelivr.net/npm/@webwriter/music-score/widgets/webwriter-music-score.css" rel="stylesheet">
<script type="module" src="https://cdn.jsdelivr.net/npm/@webwriter/music-score/widgets/webwriter-music-score.js"></script>
<webwriter-music-score></webwriter-music-score>
```

Or use with a bundler (e.g. [Vite](https://vite.dev)):

```
npm install @webwriter/music-score
```

```html
<link href="@webwriter/music-score/widgets/webwriter-music-score.css" rel="stylesheet">
<script type="module" src="@webwriter/music-score/widgets/webwriter-music-score.js"></script>
<webwriter-music-score></webwriter-music-score>
```

## Fields
| Name (Attribute Name) | Type | Description | Default | Reflects |
| :-------------------: | :--: | :---------: | :-----: | :------: |
| `options` | - | - | - | ✗ |
| `actions` | - | - | - | ✗ |
| `type` | `string` | - | - | ✗ |
| `size` | `keyof typeof scoreScales` | - | - | ✗ |
| `innerHTML` | - | - | `template` | ✗ |

*Fields including [properties](https://developer.mozilla.org/en-US/docs/Glossary/Property/JavaScript) and [attributes](https://developer.mozilla.org/en-US/docs/Glossary/Attribute) define the current state of the widget and offer customization options.*

## Methods
| Name | Description | Parameters |
| :--: | :---------: | :-------: |
| `importMusicXML` | - | `[file]: File[]`

*[Methods](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Method_definitions) allow programmatic access to the widget.*

## Events
| Name | Description |
| :--: | :---------: |
| optionschange | - |

*[Events](https://developer.mozilla.org/en-US/docs/Web/Events) are dispatched by the widget after certain triggers.*

## Editing config
| Name | Value |
| :--: | :---------: |
| `label` | `[object Object]` |

*The [editing config](https://webwriter.app/docs/packages/configuring/#editingconfig) defines how explorable authoring tools such as [WebWriter](https://webwriter.app) treat the widget.*

*No public slots, custom CSS properties, or CSS parts.*


---
*Generated with @webwriter/build@1.9.1*