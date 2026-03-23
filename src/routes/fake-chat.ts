import { Hono } from 'hono'
import { stream } from 'hono/streaming'

const chat = new Hono()

const DEFAULT_OPENAI_MODEL = 'gpt-5.4'
const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview'
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'

type JsonObject = Record<string, unknown>

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createId(prefix: string, separator = '_') {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}${separator}${crypto.randomUUID().replace(/-/g, '')}`
  }

  return `${prefix}${separator}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`
}

function getUnixTimestamp() {
  return Math.floor(Date.now() / 1000)
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4) || 1)
}

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join('\n').trim()
  }

  if (!isRecord(value)) {
    return ''
  }

  if (typeof value.text === 'string') {
    return value.text
  }

  if ('parts' in value) {
    return extractText(value.parts)
  }

  if ('content' in value) {
    return extractText(value.content)
  }

  return ''
}

function getLastPrompt(items: unknown): string {
  if (!Array.isArray(items)) {
    return ''
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]

    if (!isRecord(item)) {
      continue
    }

    if (!('role' in item) || item.role === 'user') {
      const text = extractText(item)
      if (text) {
        return text
      }
    }
  }

  return ''
}

function getChatSystemPrompt(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return ''
  }

  return messages
    .filter((message) => isRecord(message) && message.role === 'system')
    .map((message) => extractText(message))
    .filter(Boolean)
    .join('\n')
}

function extractEmojiSuffix(stylePrompt: string) {
  const emojiMatches = Array.from(stylePrompt.matchAll(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu), (match) => match[0])
  const uniqueEmoji = [...new Set(emojiMatches)]

  if (uniqueEmoji.length === 0) {
    return '😊✨'
  }

  return uniqueEmoji.slice(0, 8).join('')
}

function shouldAddEmoji(stylePrompt: string) {
  return /emoji|emojis|表情|颜文字/i.test(stylePrompt) || /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(stylePrompt)
}

function solveSimpleMath(prompt: string) {
  const match = prompt.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/)

  if (!match) {
    return null
  }

  const left = Number(match[1])
  const right = Number(match[3])
  const operator = match[2]

  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null
  }

  let result: number | null = null

  if (operator === '+') {
    result = left + right
  } else if (operator === '-') {
    result = left - right
  } else if (operator === '*') {
    result = left * right
  } else if (operator === '/' && right !== 0) {
    result = left / right
  }

  if (result === null || !Number.isFinite(result)) {
    return null
  }

  const formatted = Number.isInteger(result) ? String(result) : result.toFixed(2).replace(/\.00$/, '')
  return `${match[1]} ${operator} ${match[3]} = ${formatted}`
}

function buildMockText(prompt: string, stylePrompt = '') {
  const trimmedPrompt = prompt.trim()
  const trimmedStyle = stylePrompt.trim()
  const mathAnswer = solveSimpleMath(trimmedPrompt)

  let baseText = '这是一个 mock 响应。'

  if (mathAnswer) {
    baseText = mathAnswer
  } else if (trimmedPrompt) {
    baseText = `已收到你的消息：${trimmedPrompt}`
  }

  if (!shouldAddEmoji(trimmedStyle)) {
    return baseText
  }

  return `${baseText} ${extractEmojiSuffix(trimmedStyle)}`.trim()
}

function buildUsage(promptText: string, responseText: string) {
  const promptTokens = estimateTokens(promptText)
  const completionTokens = estimateTokens(responseText)

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  }
}

function buildOpenAIChatResponse(model: string, responseText: string, usage: ReturnType<typeof buildUsage>) {
  return {
    id: createId('chatcmpl', '-'),
    object: 'chat.completion',
    created: getUnixTimestamp(),
    model,
    system_fingerprint: createId('fp'),
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: responseText,
          refusal: null,
        },
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage,
    service_tier: 'default',
  }
}

function buildOpenAIResponsesPayload(body: JsonObject, model: string, responseText: string, promptText: string) {
  const createdAt = getUnixTimestamp()
  const outputTokens = estimateTokens(responseText)
  const inputTokens = estimateTokens(promptText)
  const messageId = createId('msg')

  return {
    id: createId('resp'),
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    background: body.background ?? false,
    completed_at: createdAt,
    error: null,
    frequency_penalty: body.frequency_penalty ?? 0,
    incomplete_details: null,
    instructions: typeof body.instructions === 'string' ? body.instructions : null,
    max_output_tokens: typeof body.max_output_tokens === 'number' ? body.max_output_tokens : null,
    max_tool_calls: typeof body.max_tool_calls === 'number' ? body.max_tool_calls : null,
    model,
    output: [
      {
        id: messageId,
        type: 'message',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            annotations: [],
            logprobs: [],
            text: responseText,
          },
        ],
        phase: 'final_answer',
        role: 'assistant',
      },
    ],
    parallel_tool_calls: body.parallel_tool_calls ?? true,
    presence_penalty: body.presence_penalty ?? 0,
    previous_response_id: typeof body.previous_response_id === 'string' ? body.previous_response_id : null,
    prompt_cache_key: createId('cache'),
    prompt_cache_retention: null,
    reasoning: {
      effort: isRecord(body.reasoning) && typeof body.reasoning.effort === 'string' ? body.reasoning.effort : 'none',
      summary: null,
    },
    safety_identifier: typeof body.safety_identifier === 'string' ? body.safety_identifier : null,
    service_tier: 'default',
    store: body.store ?? false,
    temperature: typeof body.temperature === 'number' ? body.temperature : 1,
    text: {
      format:
        isRecord(body.text) && isRecord(body.text.format) && typeof body.text.format.type === 'string'
          ? { type: body.text.format.type }
          : { type: 'text' },
      verbosity: isRecord(body.text) && typeof body.text.verbosity === 'string' ? body.text.verbosity : 'medium',
    },
    tool_choice: typeof body.tool_choice === 'string' ? body.tool_choice : 'auto',
    tool_usage: {
      image_gen: {
        input_tokens: 0,
        input_tokens_details: {
          image_tokens: 0,
          text_tokens: 0,
        },
        output_tokens: 0,
        output_tokens_details: {
          image_tokens: 0,
          text_tokens: 0,
        },
        total_tokens: 0,
      },
      web_search: {
        num_requests: 0,
      },
    },
    tools: Array.isArray(body.tools) ? body.tools : [],
    top_logprobs: typeof body.top_logprobs === 'number' ? body.top_logprobs : 0,
    top_p: typeof body.top_p === 'number' ? body.top_p : 1,
    truncation: typeof body.truncation === 'string' ? body.truncation : 'disabled',
    usage: {
      input_tokens: inputTokens,
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens: outputTokens,
      output_tokens_details: {
        reasoning_tokens: 0,
      },
      total_tokens: inputTokens + outputTokens,
    },
    user: typeof body.user === 'string' ? body.user : null,
    metadata: isRecord(body.metadata) ? body.metadata : {},
  }
}

function buildGeminiPayload(model: string, responseText: string, promptText: string) {
  const promptTokenCount = estimateTokens(promptText)
  const candidatesTokenCount = estimateTokens(responseText)

  return {
    candidates: [
      {
        content: {
          parts: [
            {
              text: responseText,
            },
          ],
          role: 'model',
        },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount,
      candidatesTokenCount,
      totalTokenCount: promptTokenCount + candidatesTokenCount,
      promptTokensDetails: [
        {
          modality: 'TEXT',
          tokenCount: promptTokenCount,
        },
      ],
      candidatesTokensDetails: [
        {
          modality: 'TEXT',
          tokenCount: candidatesTokenCount,
        },
      ],
      thoughtsTokenCount: 0,
    },
    modelVersion: model,
    responseId: createId('resp').replace(/^resp_/, ''),
    createTime: new Date().toISOString(),
  }
}

function buildAnthropicPayload(model: string, responseText: string, promptText: string) {
  const inputTokens = estimateTokens(promptText)
  const outputTokens = estimateTokens(responseText)

  return {
    id: createId('msg'),
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: responseText,
      },
    ],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: outputTokens,
    },
  }
}

chat.post('/v1/chat/completions', async (c) => {
  const body = (await c.req.json()) as JsonObject
  const model = typeof body.model === 'string' ? body.model : DEFAULT_OPENAI_MODEL
  const messages = Array.isArray(body.messages) ? body.messages : []
  const systemPrompt = getChatSystemPrompt(messages)
  const promptText = getLastPrompt(messages)
  const responseText = buildMockText(promptText, systemPrompt)
  const usage = buildUsage([systemPrompt, promptText].filter(Boolean).join('\n'), responseText)

  if (body.stream !== true) {
    return c.json(buildOpenAIChatResponse(model, responseText, usage))
  }

  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (s) => {
    const chatId = createId('chatcmpl', '-')
    const timestamp = getUnixTimestamp()
    const fingerprint = createId('fp')

    await s.write(
      `data: ${JSON.stringify({
        id: chatId,
        object: 'chat.completion.chunk',
        created: timestamp,
        model,
        system_fingerprint: fingerprint,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: '' },
            logprobs: null,
            finish_reason: null,
          },
        ],
      })}\n\n`,
    )

    for (const char of responseText) {
      await s.write(
        `data: ${JSON.stringify({
          id: chatId,
          object: 'chat.completion.chunk',
          created: timestamp,
          model,
          system_fingerprint: fingerprint,
          choices: [
            {
              index: 0,
              delta: { content: char },
              logprobs: null,
              finish_reason: null,
            },
          ],
        })}\n\n`,
      )
    }

    await s.write(
      `data: ${JSON.stringify({
        id: chatId,
        object: 'chat.completion.chunk',
        created: timestamp,
        model,
        system_fingerprint: fingerprint,
        choices: [
          {
            index: 0,
            delta: {},
            logprobs: null,
            finish_reason: 'stop',
          },
        ],
      })}\n\n`,
    )

    await s.write(
      `data: ${JSON.stringify({
        id: chatId,
        object: 'chat.completion.chunk',
        created: timestamp,
        model,
        choices: [],
        usage,
      })}\n\n`,
    )

    await s.write('data: [DONE]\n\n')
  })
})

chat.post('/v1/responses', async (c) => {
  const body = (await c.req.json()) as JsonObject
  const model = typeof body.model === 'string' ? body.model : DEFAULT_OPENAI_MODEL
  const instructions = typeof body.instructions === 'string' ? body.instructions : ''
  const promptText = body.input !== undefined ? getLastPrompt(body.input) : ''
  const responseText = buildMockText(promptText, instructions)

  return c.json(buildOpenAIResponsesPayload(body, model, responseText, [instructions, promptText].filter(Boolean).join('\n')))
})

chat.post('/v1beta/models/*', async (c) => {
  const path = new URL(c.req.url).pathname
  const match = path.match(/^\/v1beta\/models\/([^/]+):generateContent$/)

  if (!match) {
    return c.json(
      {
        error: {
          code: 404,
          message: 'Mock route not found.',
          status: 'NOT_FOUND',
        },
      },
      404,
    )
  }

  const body = (await c.req.json()) as JsonObject
  const model = decodeURIComponent(match[1] ?? DEFAULT_GEMINI_MODEL)
  const systemPrompt = extractText(body.systemInstruction)
  const promptText = body.contents !== undefined ? getLastPrompt(body.contents) : ''
  const responseText = buildMockText(promptText, systemPrompt)

  return c.json(buildGeminiPayload(model, responseText, [systemPrompt, promptText].filter(Boolean).join('\n')))
})

chat.post('/v1/messages', async (c) => {
  const body = (await c.req.json()) as JsonObject
  const model = typeof body.model === 'string' ? body.model : DEFAULT_ANTHROPIC_MODEL
  const systemPrompt = typeof body.system === 'string' ? body.system : extractText(body.system)
  const promptText = body.messages !== undefined ? getLastPrompt(body.messages) : ''
  const responseText = buildMockText(promptText, systemPrompt)

  return c.json(buildAnthropicPayload(model, responseText, [systemPrompt, promptText].filter(Boolean).join('\n')))
})

const mockModels = [
  {
    id: 'gpt-5.4',
    object: 'model',
    created: 1741737600,
    owned_by: 'openai',
  },
  {
    id: 'gpt-5.4-mini',
    object: 'model',
    created: 1741737600,
    owned_by: 'openai',
  },
  {
    id: 'gpt-5.4-nano',
    object: 'model',
    created: 1741737600,
    owned_by: 'openai',
  },
  {
    id: 'gemini-3-flash-preview',
    object: 'model',
    created: 1741651200,
    owned_by: 'google',
  },
  {
    id: 'claude-sonnet-4-6',
    object: 'model',
    created: 1753920000,
    owned_by: 'anthropic',
  },
]

chat.get('/v1/models', (c) => {
  return c.json({
    object: 'list',
    data: mockModels,
  })
})

export default chat
