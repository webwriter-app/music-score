import { localeData } from "../assets/locale-data"

type OptionLabels = Record<string, string>

function optionLabels(source: string): OptionLabels {
  const labels: OptionLabels = { _: source }
  for (const [locale, data] of Object.entries(localeData)) {
    const translation = data.options[source]
    if (translation) labels[locale] = translation
  }
  return labels
}

export const typeOption = {
  type: "select",
  control: "select",
  label: optionLabels("Type"),
  options: [
    { value: "standard", label: optionLabels("Standard staff") },
    { value: "guitar-tab", label: optionLabels("Guitar tab") },
    { value: "drum-tab", label: optionLabels("Drum tab") },
    { value: "jianpu", label: optionLabels("Jianpu") },
  ],
}

export const sizeOption = {
  type: "select",
  control: "select",
  label: optionLabels("Size"),
  options: [
    { value: "compact", label: optionLabels("Compact") },
    { value: "normal", label: optionLabels("Normal") },
    { value: "spacious", label: optionLabels("Spacious") },
  ],
}

export type Messages = Record<string, string>

const readerEditingLabels = optionLabels("Allow reader editing")
const dictionaryTags = new Map(Object.keys(localeData).map(tag => [tag.toLowerCase(), tag]))

export function* languageAncestors(element: Element): Generator<Element> {
  for (let node: Element | null = element; node;) {
    yield node
    const root = node.getRootNode()
    node = node.parentElement ?? ((root as ShadowRoot).host ?? null)
  }
}

export function language(element: Element): string {
  for (const node of languageAncestors(element)) {
    if (node.hasAttribute("lang")) return node.getAttribute("lang")!.trim().toLowerCase()
  }
  return ""
}

export function messages(element: Element): Messages {
  const locale = language(element)
  const tag = dictionaryTags.get(locale) ?? dictionaryTags.get(locale.split("-")[0])
  return localeData[tag ?? "en"].messages
}

type SelectOption = {
  type: string
  control: string
  label: OptionLabels
  options: { value: string, label: OptionLabels }[]
}

function localizedLabel(locale: string, labels: OptionLabels) {
  const base = locale.split("-")[0]
  const exact = Object.keys(labels).find(tag => tag.toLowerCase() === locale)
  const primary = Object.keys(labels).find(tag => tag.toLowerCase() === base)
  return { _: labels[exact ?? primary ?? "_"] }
}

export function readerEditingLabel(element: Element) {
  return localizedLabel(language(element), readerEditingLabels)
}

export function optionFor(element: Element, option: SelectOption) {
  const locale = language(element)
  return {
    ...option,
    label: localizedLabel(locale, option.label),
    options: option.options.map(choice => ({ ...choice, label: localizedLabel(locale, choice.label) })),
  }
}
