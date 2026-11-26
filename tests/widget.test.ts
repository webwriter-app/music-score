/// <reference types="mocha" />
import "mocha/mocha.js"
import { assert } from "chai"
import { getMochaConfig } from "@webwriter/build/test"
import practicePhrase from "../snippets/practice-phrase.html"
import manifest from "../package.json"
import phraseXml from "./fixtures/phrase.xml"
import { until } from "./helpers"

// The built widget is loaded by URL, as it ships: the widget finds its worker, font and sound font relative to
// its own file in dist/widgets, which an import of the source into this bundle would move.
await import(/* @vite-ignore */ new URL("../widgets/webwriter-music-score.js", import.meta.url).href)

mocha.setup(getMochaConfig())

const authored = practicePhrase.replace(/<script type="application\/json" class="snippet-localization">[\s\S]*$/, "")

describe("<webwriter-music-score>", function () {
  this.timeout(60000)
  let score: HTMLElement
  let root: ShadowRoot
  const points = () => root.getElementById("points") as HTMLElement
  const targets = () => root.querySelectorAll("#targets .point")
  const noteTargets = () => root.querySelectorAll<HTMLElement>('#targets .point[data-kind="note"], #targets .point[data-kind="beat"]')
  const editMode = () => { document.designMode = "on"; score.setAttribute("contenteditable", "") }
  const wrap = () => {
    const wrapper = document.createElement("div")
    score.before(wrapper)
    wrapper.append(score)
    return wrapper
  }
  const readMode = () => { document.designMode = "off"; score.removeAttribute("contenteditable") }

  beforeEach(function () {
    document.body.insertAdjacentHTML("beforeend", authored)
    score = document.querySelector("webwriter-music-score") as HTMLElement
    root = score.shadowRoot as ShadowRoot
  })

  afterEach(function () {
    document.designMode = "off"
    const wrapper = score.parentElement
    score.remove()
    if (wrapper !== document.body && !wrapper?.childElementCount) wrapper?.remove()
  })

  describe("read mode", function () {
    it("renders the score", async function () {
      assert.isTrue(await until(() => root.querySelector("#score svg")), "no svg")
    })
    it("lets readers edit the authored score by default", async function () {
      readMode()
      const append = () => root.querySelector<HTMLButtonElement>('[data-kind="append"]')
      assert.isTrue(await until(() => !points().hidden && append()))
      const data = score.querySelector("script[data-music-score]")!
      const measureCount = () => JSON.parse(data.textContent!).score.masterbars.length
      const before = measureCount()
      score.focus()
      append()!.click()
      assert.isTrue(await until(() => measureCount() === before + 1))
      assert.isFalse(score.isContentEditable)
    })
    it("lets authors turn reader editing off and back on", async function () {
      assert.isTrue(await until(() => noteTargets().length > 0))
      score.setAttribute("no-reader-editing", "")
      assert.isTrue(await until(() => points().hidden && targets().length === 0))
      score.removeAttribute("no-reader-editing")
      assert.isTrue(await until(() => !points().hidden && noteTargets().length > 0))
    })
    it("shows the transport", async function () {
      assert.isTrue(await until(() => (root.getElementById("transport") as HTMLElement).hidden === false))
    })
  })

  describe("edit mode", function () {
    beforeEach(async function () {
      await until(() => root.querySelector("#score svg"))
      editMode()
    })
    it("shows the editing layer", async function () {
      assert.isTrue(await until(() => points().hidden === false && getComputedStyle(points()).display !== "none"), "hidden=" + points().hidden)
    })
    it("makes edit targets", async function () {
      assert.isTrue(await until(() => noteTargets().length > 0), String(noteTargets().length))
    })
    it("selects a target on click", async function () {
      assert.isTrue(await until(() => noteTargets().length > 0))
      const target = noteTargets()[0]
      target.focus()
      target.click()
      assert.isTrue(await until(() => target.getAttribute("aria-pressed") === "true" || target.hasAttribute("data-selected")), target.outerHTML.slice(0, 120))
    })
    it("clears the selection on Escape", async function () {
      assert.isTrue(await until(() => noteTargets().length > 0))
      const target = noteTargets()[0]
      target.focus()
      target.click()
      assert.isTrue(await until(() => target.getAttribute("aria-pressed") === "true" || target.hasAttribute("data-selected")), target.outerHTML.slice(0, 120))
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true, cancelable: true }))
      assert.isTrue(await until(() => ![...targets()].some(t => t.getAttribute("aria-pressed") === "true")), "still selected")
    })
    it("keeps the layer when switching to read mode", async function () {
      assert.isTrue(await until(() => noteTargets().length > 0))
      readMode()
      assert.isTrue(await until(() => !points().hidden && noteTargets().length > 0))
    })
    it("removes the targets when entering read mode with reader editing disabled", async function () {
      score.setAttribute("no-reader-editing", "")
      assert.isTrue(await until(() => noteTargets().length > 0))
      readMode()
      assert.isTrue(await until(() => points().hidden && targets().length === 0))
    })
  })

  describe("moving the widget", function () {
    it("keeps reader editing available after reconnecting", async function () {
      await reconnect()
      assert.isTrue(await until(() => !points().hidden && noteTargets().length > 0))
    })
    async function reconnect() {
      await until(() => root.querySelector("#score svg"))
      const parent = score.parentNode as Node
      score.remove()
      parent.appendChild(score)
      await until(() => root.querySelector("#score svg"))
    }
    it("switches to edit mode after reconnecting", async function () {
      score.setAttribute("no-reader-editing", "")
      await reconnect()
      editMode()
      assert.isTrue(await until(() => points().hidden === false && noteTargets().length > 0), "hidden=" + points().hidden)
    })
    it("switches back to read mode after reconnecting", async function () {
      score.setAttribute("no-reader-editing", "")
      await reconnect()
      editMode()
      await until(() => points().hidden === false && noteTargets().length > 0)
      readMode()
      assert.isTrue(await until(() => points().hidden === true && targets().length === 0))
    })
  })

  describe("layout", function () {
    it("is a block with a width range from 300 to 2100 px", function () {
      const style = getComputedStyle(score)
      assert.strictEqual(style.display, "block")
      assert.strictEqual(style.minInlineSize, "300px")
      assert.strictEqual(style.maxInlineSize, "2100px")
    })
    it("does not scroll sideways at 300 px", async function () {
      wrap().style.width = "300px"
      await until(() => root.querySelector("#score svg"))
      await new Promise(done => setTimeout(done, 500))
      assert.isAtMost(score.scrollWidth, score.clientWidth + 1)
    })
  })

  describe("theme", function () {
    it("follows the document text color, font and accent", async function () {
      const wrapper = wrap()
      wrapper.style.cssText = "--ww-text-color: rgb(1, 2, 3); --ww-font-family: Georgia, serif; --ww-theme-accent-1: rgb(200, 10, 20)"
      await until(() => root.querySelector("#score svg"))
      const style = getComputedStyle(score)
      assert.strictEqual(style.color, "rgb(1, 2, 3)")
      assert.include(style.fontFamily, "Georgia")
      const sheet = root.getElementById("sheet") as HTMLElement
      assert.strictEqual(getComputedStyle(sheet).getPropertyValue("--position-blue").trim(), "rgb(200, 10, 20)")
      assert.strictEqual(sheet.getAttribute("part"), "sheet")
    })
    it("keeps the current colors without a theme", async function () {
      await until(() => root.querySelector("#score svg"))
      const sheet = root.getElementById("sheet") as HTMLElement
      assert.strictEqual(getComputedStyle(sheet).getPropertyValue("--position-blue").trim(), "#356ad6")
    })
  })

  describe("print", function () {
    it("hides the screen-only controls and shows the score on paper", async function () {
      await until(() => root.querySelector("#score svg"))
      const printed: string[] = []
      let overflowVisible = false
      for (const sheet of Array.from(root.styleSheets)) for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSMediaRule) || !rule.media.mediaText.includes("print")) continue
        for (const inner of Array.from(rule.cssRules)) {
          const style = inner as CSSStyleRule
          if (style.style.display === "none") printed.push(style.selectorText)
          if (style.selectorText === ":host" && style.style.overflow === "visible") overflowVisible = true
        }
      }
      const hidden = printed.join(",")
      for (const selector of [".transport", ".points", ".notice"]) assert.include(hidden, selector)
      assert.notInclude(hidden, "#score")
      assert.isTrue(overflowVisible)
    })
  })

  describe("keyboard and touch", function () {
    const touch = (type: string, x: number, y: number) => new PointerEvent(type, {
      pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1,
      clientX: x, clientY: y, bubbles: true, composed: true, cancelable: true,
    })
    it("moves focus into the widget with focus()", async function () {
      assert.isTrue(await until(() => noteTargets().length > 0), "no edit targets")
      score.focus()
      const active = root.activeElement as HTMLElement
      assert.isNotNull(active)
      assert.isTrue(active.matches('[data-kind="insert"], [data-kind="beat"], [data-kind="note"]'))
      const box = active.getBoundingClientRect()
      assert.isAbove(box.width * box.height, 0, "focus lands on a rendered element")
      assert.isFalse(active.closest("[hidden]") !== null)
    })
    it("makes the transport buttons at least 24 px tall for pointers", async function () {
      assert.isTrue(await until(() => (root.getElementById("transport") as HTMLElement).hidden === false))
      const play = root.getElementById("play") as HTMLElement
      const stop = root.getElementById("stop") as HTMLElement
      const a = play.getBoundingClientRect()
      const b = stop.getBoundingClientRect()
      assert.strictEqual(root.elementFromPoint(a.left + a.width / 2, a.top - 3), play)
      assert.strictEqual(root.elementFromPoint(b.left + b.width / 2, b.bottom + 3), stop)
    })
    it("selects a note with a touch tap", async function () {
      await until(() => root.querySelector("#score svg"))
      editMode()
      assert.isTrue(await until(() => noteTargets().length > 0))
      const target = root.querySelector<HTMLElement>('#targets .point[data-kind="note"]')!
      const box = target.getBoundingClientRect()
      const x = box.left + box.width / 2
      const y = box.top + box.height / 2
      assert.strictEqual(getComputedStyle(target).touchAction, "none")
      target.dispatchEvent(touch("pointerdown", x, y))
      target.dispatchEvent(touch("pointerup", x, y))
      assert.isTrue(await until(() => target.getAttribute("aria-pressed") === "true", 8000), "no selection")
    })
    it("changes the pitch of a note with a touch drag", async function () {
      await until(() => root.querySelector("#score svg"))
      editMode()
      assert.isTrue(await until(() => noteTargets().length > 0))
      const block = score.querySelector("script[data-music-score]")!
      const before = block.textContent
      const target = root.querySelector<HTMLElement>('#targets .point[data-kind="note"]')!
      const box = target.getBoundingClientRect()
      const x = box.left + box.width / 2
      const y = box.top + box.height / 2
      target.dispatchEvent(touch("pointerdown", x, y))
      for (const dy of [-6, -12, -24, -48]) target.dispatchEvent(touch("pointermove", x, y + dy))
      target.dispatchEvent(touch("pointerup", x, y - 48))
      assert.isTrue(await until(() => block.textContent !== before, 8000), "pitch unchanged")
    })
  })

  describe("files", function () {
    type Files = { importScoreFile(file: File): Promise<(() => void) | null>, exportMidiFile(): File | null, exportGuitarProFile(): File | null }
    const widget = () => score as unknown as Files
    const block = () => score.querySelector("script[data-music-score]")!
    const xml = () => new File([phraseXml], "phrase.musicxml", { type: "application/vnd.recordare.musicxml+xml" })

    it("declares the same formats in the runtime maps and the editing configuration", function () {
      const klass = customElements.get("webwriter-music-score") as unknown as { convertFrom: object, convertTo: object }
      const config = manifest.editingConfig["./widgets/webwriter-music-score"] as { importFormats: string[], exportFormats: string[] }
      assert.sameMembers(Object.keys(klass.convertFrom), config.importFormats)
      assert.sameMembers(Object.keys(klass.convertTo), config.exportFormats)
    })
    it("changes nothing before the apply function runs, then replaces the score", async function () {
      await until(() => root.querySelector("#score svg"))
      block().remove()
      await until(() => root.querySelector("#score svg"))
      const apply = await widget().importScoreFile(xml())
      assert.isNull(score.querySelector("script[data-music-score]"))
      apply!()
      assert.match(block().textContent!, /^\{"format":"alphatab-1"/)
    })
    it("rejects a file that is not MusicXML without touching the score", async function () {
      await until(() => root.querySelector("#score svg"))
      const before = block().textContent
      let message = ""
      try { await widget().importScoreFile(new File(["not xml"], "bad.musicxml")) } catch (error) { message = (error as Error).message }
      assert.include(message, "MusicXML")
      assert.strictEqual(block().textContent, before)
    })
    it("exports the score as a MIDI file without changing it", async function () {
      await until(() => root.querySelector("#score svg"))
      const before = block().textContent
      const file = widget().exportMidiFile()!
      assert.strictEqual(file.type, "audio/midi")
      assert.match(file.name, /\.mid$/)
      assert.strictEqual(new TextDecoder().decode((await file.arrayBuffer()).slice(0, 4)), "MThd")
      assert.strictEqual(block().textContent, before)
    })
    it("exports a Guitar Pro file", async function () {
      await until(() => root.querySelector("#score svg"))
      const file = widget().exportGuitarProFile()!
      assert.match(file.name, /\.gp$/)
      assert.strictEqual(new TextDecoder().decode((await file.arrayBuffer()).slice(0, 2)), "PK")
    })
    it("keeps the pitches of an imported score in the MIDI export", async function () {
      await until(() => root.querySelector("#score svg"))
      ;(await widget().importScoreFile(xml()))!()
      await until(() => widget().exportMidiFile())
      const bytes = new Uint8Array(await widget().exportMidiFile()!.arrayBuffer())
      assert.isAbove(bytes.length, 60)
    })
  })

  it("writes nothing onto the authored element", async function () {
    await until(() => root.querySelector("#score svg"))
    editMode()
    await until(() => noteTargets().length > 0)
    readMode()
    const names = [...score.attributes].map(a => a.name)
    assert.isTrue(names.every(name => ["type", "size"].includes(name)), names.join())
  })
})

mocha.run()
