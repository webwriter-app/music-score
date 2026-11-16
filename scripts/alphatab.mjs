// Prepares alphaTab for the widget build: writes the patched renderer to src/assets/alphatab-core.js
// (not tracked) and the patched worker script, the music font and the sound font to dist/vendor.
// Run by `npm run prepublishOnly` and `npm test` before the build.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"

const root = new URL("../", import.meta.url)
const dependency = new URL("./node_modules/@coderline/alphatab/", root)
const dist = new URL("./dist/", root)
const vendor = new URL("./vendor/", dist)
const patchedCore = new URL("./src/assets/alphatab-core.js", root)

// The widget bundle imports the patched renderer from src/assets. The worker script, the
// music font and the sound font are loaded at run time from dist/vendor next to the bundle.
await rm(dist, { recursive: true, force: true })
await Promise.all(["font/", "soundfont/"].map(path => mkdir(new URL(path, vendor), { recursive: true })))

const assets = [
  "font/Bravura.woff2",
  "font/Bravura-OFL.txt",
  "soundfont/sonivox.sf2",
  "soundfont/LICENSE",
  "soundfont/README.md",
]
await Promise.all([
  ...assets.map(path => cp(new URL("dist/" + path, dependency), new URL(path, vendor))),
  cp(new URL("LICENSE", dependency), new URL("LICENSE", vendor)),
])

// alphaTab 1.9.0's browser font fallback appends a temporary div to the body.
// Load a sample containing both text and a music glyph through the font API instead.
const corePath = "alphaTab.core.min.mjs"
const core = await readFile(new URL("dist/" + corePath, dependency), "utf8")
const workerPath = "alphaTab.min.js"
const worker = await readFile(new URL("dist/" + workerPath, dependency), "utf8")
const bodyFontProbe = [
  'W.debug("Font",`Font ${t} not available, creating test element to trigger load`);',
  'const e=document.createElement("div");',
  'e.style.font=i,e.style.opacity="0",e.style.position="absolute",e.style.top="0",e.style.left="0",',
  'e.innerText=`Trigger ${t} load`,document.body.appendChild(e),',
  'setTimeout(()=>{document.body.removeChild(e),document.fonts.check(i)?s(!0):s(!1)},200)',
].join("")
if (core.split(bodyFontProbe).length !== 2) throw new Error("Review the alphaTab font fallback patch for this version")
const nativeFontProbe = 'document.fonts.load(i,"A\uE0A4").then(()=>s(document.fonts.check(i)),()=>s(!1))'

// Disable the on-score credit in the pinned renderer. Keep the license and source notices.
const scoreCredit = /return this\.renderer\.score\.masterBars\.length>[\w$]+\.[\w$]+\|\|this\.renderer\.tracks\.length>[\w$]+\.[\w$]+/g
function withoutScoreCredit(source) {
  if ([...source.matchAll(scoreCredit)].length !== 1) throw new Error("Review the alphaTab score credit patch for this version")
  return source.replace(scoreCredit, "return false")
}

// Reserve the widest opening barline's column on every system. Use alphaTab's own
// glyph measurements so repeats and custom barlines keep their usual ink and spacing.
function alignSystemClefs(source) {
  const barlineRod = /registerHeaderRod\((\w+)\)\{this\.(\w+)\|\|\1\.addHeaderRod\((\w+)\.HeaderRank,0,this\.width,0\)\}/g
  if ([...source.matchAll(barlineRod)].length !== 1) throw new Error("Review the alphaTab system clef alignment patch for this version")
  return source.replace(barlineRod, (_, info, isRight, glyph) => `registerHeaderRod(${info}) {
    if (this.${isRight}) return;
    const width = this.renderer.isFirstOfStaff
      ? Math.max(this.width, ${glyph}.webwriterOpeningBarlineWidth(this.renderer))
      : this.width;
    ${info}.addHeaderRod(${glyph}.HeaderRank, 0, width, 0);
  }
  static webwriterOpeningBarlineWidths = new WeakMap();
  static webwriterOpeningBarlineWidth(renderer) {
    const score = renderer.bar.staff.track.score;
    const smuflMetrics = renderer.smuflMetrics;
    const cached = this.webwriterOpeningBarlineWidths.get(score);
    if (cached?.smuflMetrics === smuflMetrics) return cached.width;

    let width = 0;
    const styles = new Set();
    for (const track of score.tracks) {
      for (const staff of track.staves) {
        for (const bar of staff.bars) {
          const style = 2 * bar.getActualBarLineLeft(true) + Number(bar.masterBar.isRepeatStart);
          if (styles.has(style)) continue;
          styles.add(style);
          const glyph = new this(false, false);
          glyph.renderer = { bar, smuflMetrics, index: 0, isFirstOfStaff: true, drawnLineCount: 0, height: 0 };
          glyph.doLayout();
          width = Math.max(width, glyph.width);
        }
      }
    }
    this.webwriterOpeningBarlineWidths.set(score, { smuflMetrics, width });
    return width;
  }`)
}

// Use the current meter's header width at each system start, while leaving the
// renderer's decision about which time signatures to draw intact.
function reserveSystemTimeSignatures(source) {
  const headerGroup = /addPreBeatGlyph\((\w+)\)\{\1\.renderer=this,this\.(\w+)\.addGlyph\(\1\)\}/g
  const signatures = /(\w+\.isPrimaryForElement\(this\.staff,\w+\))&&\((!this\.bar\.previousBar\|\|this\.bar\.previousBar&&this\.bar\.masterBar\.timeSignatureNumerator[^()]*)\)&&this\.(\w+)\(\)/g
  const groups = [...source.matchAll(headerGroup)]
  if (groups.length !== 1 || [...source.matchAll(signatures)].length !== 4) {
    throw new Error("Review the alphaTab system time signature patch for this version")
  }
  const [, , group] = groups[0]
  return source.replace(signatures, (_, primaryStaff, visible, createGlyph) => `if (${primaryStaff}) {
    const visible = ${visible};
    if (visible || this.isFirstOfStaff) {
      this.${createGlyph}();
      if (!visible) this.${group}.glyphs.at(-1).glyphs = null;
    }
  }`)
}

// Reserve space for the selectable clefs and the range through which changing clef
// can move a bar's notes. The normal layout still makes room for larger markings.
function stabilizeClefSpacing(source) {
  const clef = [...source.matchAll(/new (\w+)\(0,this\.getScoreY\(\w+\),this\.bar\.clef,this\.bar\.clefOttava\)/g)]
  const accidentals = [...source.matchAll(/(\w+)\.computeStepsWithoutAccidentals\(this\.bar,\w+\)/g)]
  const overflows = /calculateOverflows\((\w+),(\w+)\)\{super\.calculateOverflows\(\1,\2\),this\.bar\.isEmpty\|\|this\.calculateBeamingOverflows\(\1,\2\)\}(?=get flagsSubElement\(\)\{return 2\})/g
  if (clef.length !== 1 || accidentals.length !== 1 || [...source.matchAll(overflows)].length !== 1) {
    throw new Error("Review the alphaTab vertical clef spacing patch for this version")
  }
  return source.replace(overflows, (original, _top, bottom) => `${original.slice(0, -1)};
    if (this.bar.staff.isPercussion) return;
    const clefs = [[4, 6], [3, 2], [1, 4], [2, 2]]; // Treble, bass, alto, tenor.
    for (const [clef, step] of clefs) {
      const glyph = new ${clef[0][1]}(0, this.getScoreY(step), clef, this.bar.clefOttava);
      glyph.renderer = this;
      glyph.doLayout();
      this.registerOverflowTop(-glyph.getBoundingBoxTop());
      this.registerOverflowBottom(glyph.getBoundingBoxBottom() - ${bottom});
    }
    const { maxStepsBeat, maxSteps, minSteps } = this.accidentalHelper;
    if (maxStepsBeat && this.staff.system.allStaves.length === 1) {
      const reference = { octave: 0, degree: 0 };
      const current = ${accidentals[0][1]}.calculateNoteSteps(this.bar.clef, reference);
      const bass = ${accidentals[0][1]}.calculateNoteSteps(3, reference);
      const treble = ${accidentals[0][1]}.calculateNoteSteps(4, reference);
      const clearance = this.smuflMetrics.oneStaffSpace * 2.75;
      this.registerOverflowTop(clearance - this.getScoreY(maxSteps + bass - current));
      this.registerOverflowBottom(this.getScoreY(minSteps + treble - current) + clearance - ${bottom});
    }
  }`)
}

// A final system with no room for another comparable measure is complete, just
// like a system that alphaTab wrapped. Sparse systems keep their natural width.
function justifyCompleteFinalSystem(source) {
  const threshold = /if\((\w+)\.isLast&&!(\w+)&&this\.(\w+)>0\)\{const \w+=Math\.max\(0,Math\.min\(1,(\w+)\.lastSystemFillThreshold\)\);/g
  if ([...source.matchAll(threshold)].length !== 1) throw new Error("Review the alphaTab final system alignment patch for this version")
  return source.replace(threshold, (original, system, justify, maxWidth, display) => `${original}
    const last = ${system}.masterBarsRenderers.at(-1);
    const barsPerSystem = this.getBarsPerSystem(${system}.index);
    const nextWidth = last.maxContentWidth + last.maxFixedOverhead - last.layoutingInfo.preBeatSize + ${display}.staffPaddingLeft;
    if (barsPerSystem > 0 ? ${system}.masterBarsRenderers.length >= barsPerSystem : ${system}.width + nextWidth > this.${maxWidth}) ${justify} = true;
  `)
}

// Name the groups so a printed direction can be clicked even when its ink
// extends past the beat it belongs to.
function markDirectionGlyphs(source) {
  const paintEffect = /applyBeat\((\w+),0,(\w+)\.beat,!1\);try\{(\2\.paint\(\w+\+this\.x,\w+\+this\.y,\1\))\}finally/g
  if ([...source.matchAll(paintEffect)].length !== 1) throw new Error("Review the alphaTab direction hit area patch for this version")
  return source.replace(paintEffect, (_, canvas, glyph, paint) => `applyBeat(${canvas},0,${glyph}.beat,!1);
    const effect = this.info.effectId;
    const direction = effect === "EffectText" ? "text" : effect === "EffectDynamics" ? "dynamics" : effect === "EffectLyrics" ? "lyric" : null;
    const beatId = ${glyph}.beat?.id;
    const grouped = direction && Number.isSafeInteger(beatId);
    try {
      if (grouped) ${canvas}.beginGroup("ww-direction-" + direction + " ww-beat-" + beatId);
      ${paint};
      if (grouped) ${canvas}.endGroup();
    } finally`)
}

function markHeadings(source) {
  const layoutHeading = /(\w+)\.doLayout\(\),this\.headerGlyphs\.set\((\w+),\1\)/g
  if ([...source.matchAll(layoutHeading)].length !== 1) throw new Error("Review the alphaTab heading hit area patch for this version")
  return source.replace(layoutHeading, (original, glyph, element) => `${original}, (() => {
    const heading = ${element} === 0 ? "title" : ${element} === 1 ? "subtitle" : null;
    if (!heading) return;
    const paint = ${glyph}.paint;
    ${glyph}.paint = function(x, y, canvas) {
      canvas.beginGroup("ww-heading-" + heading);
      try { paint.call(this, x, y, canvas); }
      finally { canvas.endGroup(); }
    };
  })()`)
}

function patchScoreRenderer(source) {
  source = withoutScoreCredit(source)
  source = alignSystemClefs(source)
  source = reserveSystemTimeSignatures(source)
  source = stabilizeClefSpacing(source)
  // A dynamic can start on a rest when the editor explicitly places it there.
  const restDynamics = /(stylesheet\.hideDynamics\|\|(\w+)\.isEmpty\|\|\2\.voice\.isEmpty)\|\|\2\.isRest(?=\)return!1;if\(void 0!==\2\.showDynamics\))/g
  if ([...source.matchAll(restDynamics)].length !== 1) throw new Error("Review the alphaTab rest dynamics patch for this version")
  source = source.replace(restDynamics, "$1||($2.isRest&&$2.showDynamics!==true)")
  const lyricEffect = source.match(/\b(\w+)=\{effectId:"EffectLyrics"/)?.[1]
  const lyricPlacement = `{effect:${lyricEffect},mode:2}`
  if (!lyricEffect || source.split(lyricPlacement).length !== 2) throw new Error("Review the alphaTab lyric placement patch for this version")
  source = source.replace(lyricPlacement, `{effect:${lyricEffect},mode:3}`)
  source = markDirectionGlyphs(source)
  source = markHeadings(source)
  return justifyCompleteFinalSystem(source)
}

// A score can put separate drum parts on different channels using bank 128.
// Collect their note keys as well so AlphaSynth loads the necessary drum samples.
function loadDrumsOnSeparateChannels(source) {
  const sequencer = /(createStateFromFile\((\w+)\)\{[^{}]+?\bconst (\w+)=\2\.events),/g
  const drumKey = /(\w+)\.channel===(\w+)\.PercussionChannel&&this\.percussionKeys\.add\(\1\.noteKey\)/g
  if ([...source.matchAll(sequencer)].length !== 1 || [...source.matchAll(drumKey)].length !== 1) {
    throw new Error("Review the alphaTab percussion bank patch for this version")
  }
  source = source.replace(sequencer, (_, start, _file, events) => `${start};
    const drumChannels = new Set(${events}.filter(event =>
      event.type === 176 && event.controller === 0 && event.value === 1
    ).map(event => event.channel));
    const `)
  return source.replace(drumKey, (_, note, synth) =>
    `(${note}.channel===${synth}.PercussionChannel||drumChannels.has(${note}.channel))&&this.percussionKeys.add(${note}.noteKey)`)
}

await Promise.all([
  writeFile(patchedCore, loadDrumsOnSeparateChannels(patchScoreRenderer(core.replace(bodyFontProbe, nativeFontProbe)))),
  writeFile(new URL(workerPath, vendor), loadDrumsOnSeparateChannels(patchScoreRenderer(worker))),
])
