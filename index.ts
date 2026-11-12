/**
 * Host half: exposes the OpenUI guide and validates widget programs.
 *
 * The component vocabulary is the real `openuiChatLibrary` from
 * `@openuidev/react-ui`, captured at build time into `library.generated.ts`, so
 * the host validates against the same eighty-four components the client draws
 * without importing React or the browser library.
 *
 * The guide is its own tool rather than part of the render tool's description:
 * the full vocabulary is about 53 KB, and a tool description is sent on every
 * request whether or not a widget is wanted.
 */
import { createParser } from '@openuidev/lang-core'
import type { LibraryJSONSchema } from '@openuidev/lang-core'
import { LIBRARY_PROMPT, LIBRARY_ROOT, LIBRARY_SCHEMA } from './library.generated.ts'

/** Stable Loader identity. */
export const name = 'openui-widget'

/** Services used by the tools. */
export const inject: readonly string[] = ['tools']

/** Wire name of the render tool; the client view claims this key. */
export const RENDER_TOOL = 'openui_render'

/** Wire name of the guide tool. */
export const GUIDE_TOOL = 'openui_catalog'

/** Longest program accepted, in characters. */
const MAX_SPEC_CHARS = 60_000

/** One text block as the model reads it. */
interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** The canonical value of one accepted program. */
export interface WidgetValue {
  readonly spec: string
  readonly components: number
}

/** Output declaration: JSON Schema plus the two pure projections. */
interface ToolOutput<Value> {
  readonly schema: Readonly<Record<string, unknown>>
  render(args: Readonly<Record<string, unknown>>, value: Value): readonly TextBlock[]
  presentationMeta?(args: Readonly<Record<string, unknown>>, value: Value): Readonly<Record<string, unknown>>
}

/** The shape the tool registry accepts. */
export interface ToolDefinition<Value> {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly output: ToolOutput<Value>
  execute(args: Readonly<Record<string, unknown>>): Promise<Value>
}

/** The slice of the plugin context this half uses. */
export interface PluginContext {
  readonly tools: {
    register(definition: ToolDefinition<never> | ToolDefinition<WidgetValue> | ToolDefinition<string>): unknown
  }
}

/** True for a plain object, the shape every JSON value check starts from. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

/** Number of components the guide names and the render tool accepts. */
function catalogSize(schema: unknown): number {
  if (!isRecord(schema)) return 0
  const properties = schema.properties
  return isRecord(properties) ? Object.keys(properties).length : 0
}

/** Breadth of the vocabulary, stated so an agent knows a component demo is possible. */
const CATALOG_SIZE = catalogSize(LIBRARY_SCHEMA)

const RENDER_DESCRIPTION = [
  'Draw a widget in the chat instead of answering in prose.',
  '',
  `The widget is drawn from the OpenUI chat library: ${String(CATALOG_SIZE)} components covering charts, tables, cards, callouts, icons, forms, images, and code blocks.`,
  '',
  'Use this when the answer is better scanned than read: a comparison across options, a trend or breakdown over time, a few numbers side by side, a table of values, a checklist of several items, or a small dashboard. Use it too when the user asks for a chart, table, dashboard, visual, or summary card.',
  '',
  'Use it when the user asks to see, preview, demo, mock, or explore UI components. A component demo is one widget that shows real components: a gallery of variants, a mock screen, or one component with its states.',
  '',
  'Do not use it for a single fact, a short explanation, or a conversational reply, and not when the user asked for a file or document to download. One widget per answer is enough, and never wrap a one-line answer in one.',
  '',
  `Before the first widget in a conversation, call ${GUIDE_TOOL} for the component catalog, argument order, and worked examples. Do not guess component names or argument order.`,
  '',
  `Then write an OpenUI Lang program whose entry statement is root = ${LIBRARY_ROOT}(...), one statement per line. The widget is display-only: components render, they do not call tools or send messages. Do not also describe the widget in prose. If the program is invalid the tool returns the parse errors; fix them and call again.`,
].join('\n')

const GUIDE_DESCRIPTION = [
  'Return the OpenUI Lang guide: syntax, rules, the full component catalog with argument order, and worked examples.',
  '',
  `Call this once before the first ${RENDER_TOOL} call in a conversation. It is long, so do not call it again unless you need a component's exact arguments. Use it to plan a component demo, a variant gallery, or a mock screen: it names every component the render tool accepts.`,
].join('\n')

const RENDER_OUTPUT: Readonly<Record<string, unknown>> = {
  type: 'object',
  additionalProperties: false,
  required: ['spec', 'components'],
  properties: {
    spec: { type: 'string', description: 'The accepted OpenUI Lang program.' },
    components: { type: 'integer', description: 'Number of statements accepted.' },
  },
}

/** Describe one parse problem in a form the model can act on. */
function describeProblem(problem: unknown): string {
  if (isRecord(problem) && typeof problem.message === 'string') return problem.message
  return String(problem)
}

/** Collect everything that makes a program unusable. */
function problemsOf(result: ReturnType<ReturnType<typeof createParser>['parse']>): readonly string[] {
  const problems: string[] = []
  if (result.root === null) {
    problems.push(`no root component was produced; start with root = ${LIBRARY_ROOT}([...])`)
  }
  if (result.meta.incomplete) problems.push('the program is truncated')
  for (const error of result.meta.errors) problems.push(describeProblem(error))
  for (const reference of result.meta.unresolved) problems.push(`"${reference}" is used but never defined`)
  return problems
}

/**
 * Register the guide and render tools.
 * @param ctx - agent-scoped services.
 */
export function apply(ctx: PluginContext): void {
  const parser = createParser(LIBRARY_SCHEMA as LibraryJSONSchema)

  const guide: ToolDefinition<string> = {
    name: GUIDE_TOOL,
    description: GUIDE_DESCRIPTION,
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return LIBRARY_PROMPT
    },
  }

  const render: ToolDefinition<WidgetValue> = {
    name: RENDER_TOOL,
    description: RENDER_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['spec'],
      properties: {
        spec: { type: 'string', description: 'The complete OpenUI Lang program, one statement per line.' },
      },
    },
    output: {
      schema: RENDER_OUTPUT,
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered a widget with ${String(value.components)} statements.`,
      }],
      presentationMeta: (_args, value) => ({ v: 1, spec: value.spec, components: value.components }),
    },
    async execute(args) {
      const spec = args.spec
      if (typeof spec !== 'string' || spec.trim() === '') throw new Error('spec must be a non-empty OpenUI Lang program')
      if (spec.length > MAX_SPEC_CHARS) {
        throw new Error(`spec is ${String(spec.length)} characters; the limit is ${String(MAX_SPEC_CHARS)}. Split it into fewer components.`)
      }
      let result: ReturnType<typeof parser.parse>
      try {
        result = parser.parse(spec)
      } catch (error) {
        throw new Error(`OpenUI Lang could not be parsed: ${error instanceof Error ? error.message : String(error)}`)
      }
      const problems = problemsOf(result)
      if (problems.length > 0) {
        throw new Error(`The widget program is invalid:\n- ${problems.slice(0, 8).join('\n- ')}`)
      }
      return { spec, components: result.meta.statementCount }
    },
  }

  ctx.tools.register(guide)
  ctx.tools.register(render)
}
