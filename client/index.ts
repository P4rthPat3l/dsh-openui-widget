/**
 * Client half: draw the `openui_render` tool result with the real OpenUI chat
 * library, so widgets use OpenUIs own components and stylesheet.
 */
import React, { createElement as h } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { Renderer } from '@openuidev/react-lang'
import type { Library } from '@openuidev/react-lang'
import { openuiChatLibrary } from '@openuidev/react-ui/genui-lib'
import uiCss from '@openuidev/react-ui/index.css'

/** Wire name of the render tool this view belongs to. */
const RENDER_TOOL = 'openui_render'

/**
 * The library the widget draws with. It is the same library the host captured
 * into `library.generated.ts`, so validation and rendering share one vocabulary.
 */
const library: Library = openuiChatLibrary as unknown as Library

/** Frame styles only; component styling comes from OpenUIs own stylesheet. */
const FRAME_CSS = `
.dsh-openui-widget { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.dsh-openui-error { font-size: 12px; line-height: 1.55; color: var(--dsw-alias-state-error-primary); white-space: pre-wrap; }
.dsh-openui-status { font-size: 12px; color: var(--dsw-alias-label-secondary); }
`

const STYLES = `${FRAME_CSS}\n${uiCss}`

/** The stored display payload, narrowed from the tool result's untyped meta. */
interface Presentation {
  readonly spec: string
}

/** The parts of a tool result this view reads. */
interface ToolBlock {
  readonly isError?: boolean
  readonly meta?: unknown
  readonly content?: readonly unknown[]
}

/** Props supplied by the Chat tool row; only these two are used. */
export interface WidgetProps {
  readonly phase?: string
  readonly block?: ToolBlock
}

/** The client services this plugin needs. */
export interface ClientContext {
  readonly slots: {
    inject(name: string, callback: () => unknown): unknown
    register(options: Readonly<Record<string, unknown>>, component: ComponentType<WidgetProps>): unknown
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

/** Read the persisted payload; anything unexpected means no widget. */
function readMeta(block: ToolBlock | undefined): Presentation | null {
  const meta = block?.meta
  if (!isRecord(meta)) return null
  const spec = meta.spec
  if (typeof spec !== 'string' || spec === '') return null
  return { spec }
}

/** Text the tool produced, used for an error the widget cannot draw. */
function resultText(block: ToolBlock | undefined): string {
  const content = block?.content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(part => part !== '')
    .join('\n')
    .trim()
}

function Widget(props: WidgetProps): ReactNode {
  const style = h('style', null, STYLES)
  const frame = (children: ReactNode): ReactNode => h('div', { className: 'dsh-openui-widget' }, style, children)

  if (props.phase !== 'result') {
    return frame(h('div', { className: 'dsh-openui-status' },
      props.phase === 'preparing' ? 'Preparing the widget program...' : 'Drawing the widget...'))
  }

  const block = props.block
  if (block?.isError === true) {
    return frame(h('div', { className: 'dsh-openui-error' },
      resultText(block) || 'The widget program could not be parsed.'))
  }

  const meta = readMeta(block)
  if (meta === null) {
    return frame(h('div', { className: 'dsh-openui-error' },
      'This session recorded the tool result without a widget payload.'))
  }

  return frame(h(Renderer, { response: meta.spec, library, isStreaming: false }))
}

/** Services used by the client half. */
export const inject = ['slots']

/**
 * Claim the tool result view for this plugin's tool only.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: RENDER_TOOL,
  }, Widget))
}
