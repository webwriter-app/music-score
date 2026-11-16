/// <reference types="mocha" />
import "mocha/mocha.js"
import { assert } from "chai"
import { getMochaConfig } from "@webwriter/build/test"
import practicePhrase from "../snippets/practice-phrase.html"
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
  const readMode = () => { document.designMode = "off"; score.removeAttribute("contenteditable") }

  beforeEach(function () {
    document.body.insertAdjacentHTML("beforeend", authored)
    score = document.querySelector("webwriter-music-score") as HTMLElement
    root = score.shadowRoot as ShadowRoot
  })

  afterEach(function () {
    document.designMode = "off"
    score.remove()
  })

  describe("read mode", function () {
    it("renders the score", async function () {
      assert.isTrue(await until(() => root.querySelector("#score svg")), "no svg")
    })
    it("hides the editing layer", async function () {
      await until(() => root.querySelector("#score svg"))
      assert.isTrue(points().hidden)
    })
    it("does not display the editing layer", async function () {
      await until(() => root.querySelector("#score svg"))
      assert.strictEqual(getComputedStyle(points()).display, "none")
    })
    it("makes no edit targets", async function () {
      await until(() => root.querySelector("#score svg"))
      assert.strictEqual(targets().length, 0)
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
    it("hides the layer when edit mode ends", async function () {
      assert.isTrue(await until(() => noteTargets().length > 0))
      readMode()
      assert.isTrue(await until(() => points().hidden === true), "hidden=" + points().hidden)
    })
    it("removes the targets when edit mode ends", async function () {
      assert.isTrue(await until(() => noteTargets().length > 0))
      readMode()
      assert.isTrue(await until(() => targets().length === 0), String(targets().length))
    })
  })

  describe("moving the widget", function () {
    it("keeps the layer hidden after reconnecting in read mode", async function () {
      await until(() => root.querySelector("#score svg"))
      const parent = score.parentNode as Node
      score.remove()
      parent.appendChild(score)
      await until(() => root.querySelector("#score svg"))
      assert.isTrue(points().hidden)
    })
    async function reconnect() {
      await until(() => root.querySelector("#score svg"))
      const parent = score.parentNode as Node
      score.remove()
      parent.appendChild(score)
      await until(() => root.querySelector("#score svg"))
    }
    it("switches to edit mode after reconnecting", async function () {
      await reconnect()
      editMode()
      assert.isTrue(await until(() => points().hidden === false && noteTargets().length > 0), "hidden=" + points().hidden)
    })
    it("switches back to read mode after reconnecting", async function () {
      await reconnect()
      editMode()
      await until(() => points().hidden === false && noteTargets().length > 0)
      readMode()
      assert.isTrue(await until(() => points().hidden === true && targets().length === 0))
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
