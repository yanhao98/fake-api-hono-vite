import { Hono } from 'hono'
import { stream } from 'hono/streaming'

const chat = new Hono()

const DEFAULT_OPENAI_MODEL = 'gpt-5.4'
const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview'
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const ERROR_TEST_MODEL = 'error-test'

const mockResponses = [
  '🙂 你好，这里是一条友好的 mock 回复。',
  '👋 已收到你的消息，我先给你一个示例返回。',
  '✨ 没问题，这个请求我先用模拟数据响应。',
  '🤖 嗨，我在这儿，随时可以继续处理。',
  '🛠️ 收到，我先帮你把这次调用顶上。',
  '🚀 可以，先返回一版轻量 mock 内容给你。',
  '📦 这边正常响应中，先附上一条占位消息。',
  '🎯 目标明确，这里先给你一个可测的返回值。',
  '🧪 当前是联调用回复，方便你验证流程。',
  '💡 我先给结论，这条是用于调试的模拟消息。',
  '😎 这个问题能接，我先回你一个 mock 版本。',
  '📡 请求已命中，服务正在稳定返回示例内容。',
  '🫡 明白你的意思了，先快速回一版给你。',
  '🌈 这里是一条带情绪的模拟响应，供你测试。',
  '🔥 状态正常，这里先吐出一条 placeholder 文案。',
  '🍀 一切顺利，先给你一条可用的假数据回复。',
  '🧩 这条返回主要用于补齐接口联调链路。',
  '📬 消息收到，我先按 mock 模式回复你。',
  '🎉 处理完成，这里是一条示例 assistant 消息。',
  '🪄 我先变一条响应出来，你可以直接拿去测。',
  '🦾 这个接口目前工作正常，先返回模拟内容。',
  '🌟 给你一条简洁版本，适合先跑通前后端。',
  '📝 这里先放一条随机文案，方便观察渲染效果。',
  '🔧 当前返回的是 mock 数据，结构尽量贴近真实接口。',
  '🧭 如果你在排查链路，这条响应应该够用了。',
  '💬 OK, here is a mock reply with a bit more personality 🙂',
  '🧪 Sure thing, this endpoint is responding with sample data.',
  '🚦 All set, returning a placeholder assistant message now.',
  '📣 Request received, mock response generated successfully.',
  '✅ Everything looks good, here is a friendly fake reply.',
  '😄 需要更详细一点的话，我也可以继续补充。',
  '📘 这条回复主要用于接口联调和页面展示测试。',
  '🕹️ 先随机回你一句，看看整个交互链路通不通。',
  '📍 接口已命中，当前输出的是演示用内容。',
  '🛎️ 常见联调回复：服务正常，数据已经返回。',
  '🧱 先拿这条当占位，后面再换成更真实的文案。',
  '🎈 现在返回的是 mock 结果，但语气尽量自然一点。',
  '🪐 当前为演示数据，后续可替换成固定或动态模板。',
  '⚡ 测试 through，这次响应已经顺利生成。',
  '📨 消息已接收，正在以模拟助手身份回复你。',
  '🎲 来一条随机回答，方便你验证 UI 和接口表现。',
  '🔗 这里是一条示例消息，用于确认前后端已经打通。',
  '🏁 响应成功返回，祝你这轮调试一切顺利。',
  '🍵 服务在线中，先给你一条温和的占位回复。',
]

type JsonObject = Record<string, unknown>
type StreamWriter = {
  write: (chunk: string) => Promise<unknown>
}

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

async function writeSseEvent(writer: StreamWriter, event: string, data: JsonObject) {
  await writer.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
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

function isErrorTestModel(model: string) {
  return model === ERROR_TEST_MODEL
}

function createRequestId() {
  return createId('req')
}

function buildOpenAIModelError(model: string) {
  return {
    error: {
      message: `The model \`${model}\` does not exist or you do not have access to it.`,
      type: 'invalid_request_error',
      param: null,
      code: 'model_not_found',
    },
  }
}

function buildGeminiModelError(model: string) {
  const modelResource = `models/${model}`

  return {
    error: {
      code: 400,
      message: `${modelResource} is not supported for generateContent. Use ListModels to inspect the available models and supported methods.`,
      status: 'INVALID_ARGUMENT',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'MODEL_NOT_SUPPORTED',
          domain: 'generativelanguage.googleapis.com',
          metadata: {
            model: modelResource,
            method: 'generateContent',
          },
        },
        {
          '@type': 'type.googleapis.com/google.rpc.Help',
          links: [
            {
              description: 'List available Gemini API models',
              url: 'https://ai.google.dev/gemini-api/docs/models',
            },
          ],
        },
      ],
    },
  }
}

function buildAnthropicModelError(model: string, requestId: string) {
  return {
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message: `Unsupported model: ${model}. See the models documentation for valid model IDs.`,
    },
    request_id: requestId,
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

  if (isErrorTestModel(model)) {
    const requestId = createRequestId()
    c.header('x-request-id', requestId)
    return c.json(buildOpenAIModelError(model), 404)
  }

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
  const fullPromptText = [instructions, promptText].filter(Boolean).join('\n')
  const responsePayload = buildOpenAIResponsesPayload(body, model, responseText, fullPromptText)

  if (isErrorTestModel(model)) {
    const requestId = createRequestId()
    c.header('x-request-id', requestId)
    return c.json(buildOpenAIModelError(model), 404)
  }

  if (body.stream !== true) {
    return c.json(responsePayload)
  }

  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (s) => {
    const message = responsePayload.output[0]
    const contentPart = message.content[0]
    const inProgressResponse = {
      ...responsePayload,
      status: 'in_progress',
      completed_at: null,
      output: [],
      usage: null,
    }
    const inProgressMessage = {
      id: message.id,
      type: message.type,
      status: 'in_progress',
      content: [],
      phase: message.phase,
      role: message.role,
    }
    const emptyContentPart = {
      type: contentPart.type,
      annotations: contentPart.annotations,
      logprobs: contentPart.logprobs,
      text: '',
    }
    let sequenceNumber = 0

    await writeSseEvent(s, 'response.created', {
      type: 'response.created',
      response: inProgressResponse,
      sequence_number: sequenceNumber++,
    })

    await writeSseEvent(s, 'response.in_progress', {
      type: 'response.in_progress',
      response: inProgressResponse,
      sequence_number: sequenceNumber++,
    })

    await writeSseEvent(s, 'response.output_item.added', {
      type: 'response.output_item.added',
      item: inProgressMessage,
      output_index: 0,
      sequence_number: sequenceNumber++,
    })

    await writeSseEvent(s, 'response.content_part.added', {
      type: 'response.content_part.added',
      content_index: 0,
      item_id: message.id,
      output_index: 0,
      part: emptyContentPart,
      sequence_number: sequenceNumber++,
    })

    for (const char of responseText) {
      await writeSseEvent(s, 'response.output_text.delta', {
        type: 'response.output_text.delta',
        content_index: 0,
        delta: char,
        item_id: message.id,
        output_index: 0,
        sequence_number: sequenceNumber++,
      })
    }

    await writeSseEvent(s, 'response.output_text.done', {
      type: 'response.output_text.done',
      content_index: 0,
      item_id: message.id,
      output_index: 0,
      text: responseText,
      sequence_number: sequenceNumber++,
    })

    await writeSseEvent(s, 'response.content_part.done', {
      type: 'response.content_part.done',
      content_index: 0,
      item_id: message.id,
      output_index: 0,
      part: contentPart,
      sequence_number: sequenceNumber++,
    })

    await writeSseEvent(s, 'response.output_item.done', {
      type: 'response.output_item.done',
      item: message,
      output_index: 0,
      sequence_number: sequenceNumber++,
    })

    await writeSseEvent(s, 'response.completed', {
      type: 'response.completed',
      response: responsePayload,
      sequence_number: sequenceNumber++,
    })
  })

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

  if (isErrorTestModel(model)) {
    return c.json(buildGeminiModelError(model), 400)
  }

  return c.json(buildGeminiPayload(model, responseText, [systemPrompt, promptText].filter(Boolean).join('\n')))
})

chat.post('/v1/messages', async (c) => {
  const body = (await c.req.json()) as JsonObject
  const model = typeof body.model === 'string' ? body.model : DEFAULT_ANTHROPIC_MODEL
  const systemPrompt = typeof body.system === 'string' ? body.system : extractText(body.system)
  const promptText = body.messages !== undefined ? getLastPrompt(body.messages) : ''
  const responseText = buildMockText(c.req.method, c.req.url, model)

  if (isErrorTestModel(model)) {
    const requestId = createRequestId()
    c.header('request-id', requestId)
    return c.json(buildAnthropicModelError(model, requestId), 400)
  }

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
