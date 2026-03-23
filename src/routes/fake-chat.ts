import { Hono } from 'hono'
import { stream } from 'hono/streaming'

const chat = new Hono()

const DEFAULT_OPENAI_MODEL = 'gpt-5.4'
const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview'
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'

const mockResponses = [
  '你好！有什么可以帮助你的吗？',
  '你好！很高兴见到你。',
  'Hello! How can I help you today?',
  '嗨！我是 AI 助手，有什么我可以帮你的吗？',
  '收到，我来帮你处理这个问题。',
  '当然可以，你继续说。',
  '没问题，我已经准备好了。',
  '我在，随时可以开始。',
  '可以的，我先帮你看一下。',
  '这个我能处理，我们一步一步来。',
  '好的，我先给你一个简洁版本。',
  '行，我直接给你结果。',
  '收到，这里先给你一个 mock 回复。',
  '明白了，我来快速处理一下。',
  '这件事可以搞定，我先从关键点开始。',
  '我已经理解你的意思了，继续。',
  '好的，这里是一个模拟返回结果。',
  '可以，先这样返回一版给你。',
  '我来帮你补齐这个接口。',
  '这个请求已收到，我这边正常响应。',
  '处理完成，这是一条示例回复。',
  '一切正常，这里返回 mock 数据。',
  '这边先给你一个稳定的测试响应。',
  '可以，把这个当作占位返回就行。',
  'OK, I got it. Here is a mock response for testing.',
  'Sure thing. This endpoint is responding with mock data.',
  'All set. Returning a sample assistant message.',
  'Request received. Mock response generated successfully.',
  'Everything looks good. Here is a placeholder reply.',
  '好的呀，需要我再详细一点也可以。',
  '没问题，这条回复主要用于联调测试。',
  '这里先返回一条随机文案，方便你验证流程。',
  '接口已命中，当前返回的是模拟内容。',
  '联调中常用的一条回复：服务正常，数据已返回。',
  '如果你只是测试链路，这条响应应该够用了。',
  '先这样回给你，后面要换成更像真人的也行。',
  '这个返回是 mock 的，但结构会尽量贴近真实接口。',
  '当前为演示数据，后续可以替换成固定模板或动态模板。',
  '测试 through，响应已生成。',
  '消息收到，正在以 mock 模式回复你。',
  '来啦，这是一条随机生成的模拟回答。',
  '这里是一条示例消息，用于验证前后端联通。',
  '响应成功返回，祝你调试顺利。',
  '服务在线，这里给你一条友好的占位回复。',
]

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

function getRandomResponse() {
  return mockResponses[Math.floor(Math.random() * mockResponses.length)]
}

function buildMockText(requestMethod: string, requestUrl: string, model: string) {
  const url = new URL(requestUrl)
  const requestPath = `${url.pathname}${url.search}`
  return `${getRandomResponse()} 收到的请求：${requestMethod.toUpperCase()} ${requestPath} model=${model}`
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
  const responseText = buildMockText(c.req.method, c.req.url, model)
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
  const responseText = buildMockText(c.req.method, c.req.url, model)

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
  const responseText = buildMockText(c.req.method, c.req.url, model)

  return c.json(buildGeminiPayload(model, responseText, [systemPrompt, promptText].filter(Boolean).join('\n')))
})

chat.post('/v1/messages', async (c) => {
  const body = (await c.req.json()) as JsonObject
  const model = typeof body.model === 'string' ? body.model : DEFAULT_ANTHROPIC_MODEL
  const systemPrompt = typeof body.system === 'string' ? body.system : extractText(body.system)
  const promptText = body.messages !== undefined ? getLastPrompt(body.messages) : ''
  const responseText = buildMockText(c.req.method, c.req.url, model)

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
