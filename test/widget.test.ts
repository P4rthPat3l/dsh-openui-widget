/**
 * Behaviour tests for the OpenUI widget plugin. Each test is named after the
 * acceptance criterion it proves. Run with `npm test`.
 *
 * The browser artifact is loaded for real, so this file installs a DOM first:
 * the OpenUI React library touches `document` while its modules initialise.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { renderToString } from 'react-dom/server'
import React from 'react'
import type { ComponentType } from 'react'
import { apply, GUIDE_TOOL, RENDER_TOOL } from '../index.ts'
import type { ToolDefinition, WidgetValue } from '../index.ts'
import type { ClientContext, WidgetProps } from '../client/index.ts'

/** Give the artifact the globals a browser would provide. */
function installDom(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
  const target = globalThis as unknown as Record<string, unknown>
  const provided: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    SVGElement: dom.window.SVGElement,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => { callback(Date.now()) }, 0),
    cancelAnimationFrame: (handle: number) => { clearTimeout(handle) },
  }
  for (const [key, value] of Object.entries(provided)) {
    Object.defineProperty(target, key, { value, configurable: true, writable: true })
  }
}

installDom()

const pkgRequire = createRequire(new URL('../package.json', import.meta.url))

/** Capture both tools the host half registers, narrowed by their wire names. */
function captureTools(): { render: ToolDefinition<WidgetValue>; guide: ToolDefinition<string> } {
  let render: ToolDefinition<WidgetValue> | undefined
  let guide: ToolDefinition<string> | undefined
  apply({
    tools: {
      register: definition => {
        if (definition.name === RENDER_TOOL) render = definition as ToolDefinition<WidgetValue>
        if (definition.name === GUIDE_TOOL) guide = definition as ToolDefinition<string>
        return undefined
      },
    },
  })
  assert.ok(render, `${RENDER_TOOL} must be registered`)
  assert.ok(guide, `${GUIDE_TOOL} must be registered`)
  return { render, guide }
}

/** The artifact's export surface, validated before use. */
interface ClientModule {
  readonly inject: readonly string[]
  apply(ctx: ClientContext): void
}

function isClientModule(value: unknown): value is ClientModule {
  if (typeof value !== 'object' || value === null) return false
  const record: Record<string, unknown> = { ...value }
  return Array.isArray(record.inject) && typeof record.apply === 'function'
}

/** Load the built browser artifact and capture its slot registration. */
async function registeredView(): Promise<{
  exports: ClientModule
  options: Readonly<Record<string, unknown>>
  component: ComponentType<WidgetProps>
}> {
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let entry: { id: string; factory: (require: NodeRequire) => unknown } | undefined
  new Function('window', code)({ __ModuleLoader__: { load: (module: typeof entry) => { entry = module } } })
  assert.ok(entry, 'the artifact must register one loader entry')
  const exported: unknown = entry.factory(pkgRequire)
  assert.ok(isClientModule(exported), 'the artifact must export apply and inject')
  let captured: { options: Readonly<Record<string, unknown>>; component: ComponentType<WidgetProps> } | undefined
  exported.apply({
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => { captured = { options, component } },
    },
  })
  assert.ok(captured, 'the client half must register a slot occupant')
  return { exports: exported, options: captured.options, component: captured.component }
}

const SIMPLE = [
  'root = Card([header, body])',
  'header = CardHeader("Revenue", "Last 30 days")',
  'body = TextContent("Revenue grew 12% this month.")',
].join('\n')

const CHART = [
  'root = Card([header, chart])',
  'header = CardHeader("MRR by month")',
  'chart = BarChart(["Jul", "Aug", "Sep"], [series])',
  'series = Series("Revenue", [380, 410, 440])',
].join('\n')

const view = await registeredView()

/** Render the widget for one tool-call phase. */
function draw(props: WidgetProps): string {
  return renderToString(React.createElement(view.component, props))
}

test('AC-001: the guide names the component catalog and the root component', async () => {
  const text = await captureTools().guide.execute({})
  assert.equal(typeof text, 'string')
  assert.match(text, /Card\(/)
  assert.match(text, /BarChart/)
  assert.ok(text.length > 20_000, 'the guide carries the full vocabulary')
})

test('AC-002: a valid program is accepted and projected for the client view', async () => {
  const tool = captureTools().render
  const value = await tool.execute({ spec: SIMPLE })
  assert.equal(value.spec, SIMPLE)
  assert.equal(value.components, 3)
  assert.deepEqual(tool.output.presentationMeta?.({}, value), { v: 1, spec: SIMPLE, components: 3 })
  assert.deepEqual(tool.output.render({}, value), [{ type: 'text', text: 'Rendered a widget with 3 statements.' }])
})

test('AC-003: a chart program with a nested series is accepted', async () => {
  const value = await captureTools().render.execute({ spec: CHART })
  assert.equal(value.components, 4)
})

test('AC-004: an unknown component is rejected and the real catalog is named', async () => {
  await assert.rejects(
    () => captureTools().render.execute({ spec: 'root = Card([x])\nx = Nope("a")' }),
    /Unknown component "Nope".*Available components: Card, TextContent/s,
  )
})

test('AC-005: an empty program is rejected before parsing', async () => {
  await assert.rejects(() => captureTools().render.execute({ spec: '   ' }), /spec must be a non-empty OpenUI Lang program/)
})

test('AC-006: an oversized program is rejected with the limit', async () => {
  const huge = `root = Card([t])\nt = TextContent("${'x'.repeat(60_000)}")`
  await assert.rejects(() => captureTools().render.execute({ spec: huge }), /the limit is 60000/)
})

test('AC-007: a program without a root statement is rejected', async () => {
  await assert.rejects(() => captureTools().render.execute({ spec: 'a = TextContent("hello")' }), /no root component was produced/)
})

test('AC-008: the artifact claims only its own tool key', () => {
  assert.deepEqual(view.exports.inject, ['slots'])
  assert.deepEqual(view.options, { name: 'tool.call.toolview', key: 'openui_render' })
  assert.equal(RENDER_TOOL, 'openui_render')
})

test('AC-009: a settled result draws the program with OpenUIs own components', () => {
  const html = draw({ phase: 'result', block: { isError: false, meta: { v: 1, spec: SIMPLE }, content: [] } })
  assert.match(html, /Revenue grew 12% this month\./)
  assert.match(html, /Last 30 days/)
  assert.match(html, /class="[^"]*openui/)
})

test('AC-010: the OpenUI stylesheet ships inside the artifact', async () => {
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(code.length > 1_000_000, 'the artifact carries the library and its styles')
  const html = draw({ phase: 'result', block: { isError: false, meta: { v: 1, spec: SIMPLE }, content: [] } })
  assert.match(html, /<style>/)
})

test('AC-011: a tool error shows the model-facing reason', () => {
  const html = draw({
    phase: 'result',
    block: { isError: true, content: [{ type: 'text', text: 'The widget program is invalid:\n- Unknown component "Nope"' }] },
  })
  assert.match(html, /dsh-openui-error/)
  assert.match(html, /Unknown component/)
})

test('AC-012: a result without a widget payload degrades to a message, never a blank row', () => {
  const html = draw({ phase: 'result', block: { isError: false, content: [{ type: 'text', text: 'Rendered.' }] } })
  assert.match(html, /without a widget payload/)
})

test('AC-013: a running call shows a status row instead of an empty widget', () => {
  assert.match(draw({ phase: 'preparing', block: {} }), /Preparing the widget program/)
  assert.match(draw({ phase: 'start', block: {} }), /Drawing the widget/)
})

test('AC-014: the host rejects a component argument the library does not define', async () => {
  await assert.rejects(
    () => captureTools().render.execute({ spec: 'root = Card([header])\nheader = CardHeader("Title", "Sub", "extra")' }),
    /invalid/i,
  )
})

test('AC-015: the render description states when to draw a widget, when not to, and covers component demos', () => {
  const description = captureTools().render.description
  assert.match(description, /Use this when the answer is better scanned than read/)
  assert.match(description, /preview, demo, mock, or explore UI components/)
  assert.match(description, /Do not use it for a single fact/)
  assert.match(description, /One widget per answer/)
  assert.match(description, /\d+ components covering charts/)
  assert.match(description, new RegExp(GUIDE_TOOL))
  assert.ok(description.length < 2_000, 'the decision policy must stay cheap: it rides on every request')
})

test('AC-016: the published package needs nothing installed beside it', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  assert.deepEqual(manifest.dependencies ?? {}, {}, 'a consumer must install only this package')
})

test('AC-017: the guide description serves a component demo agent', () => {
  const { guide } = captureTools()
  assert.match(guide.description, /component demo/)
  assert.match(guide.description, new RegExp(RENDER_TOOL))
})
