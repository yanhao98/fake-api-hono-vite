import { Hono } from 'hono'
import { stream } from 'hono/streaming'

const chat = new Hono()

// Helper functions
function generateChatId() {
  return 'chatcmpl-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

function getCurrentTimestamp() {
  return Math.floor(Date.now() / 1000)
}

// Mock response text
const mockResponses = [
  '你好！有什么可以帮助你的吗？',
  '你好！很高兴见到你。',
  'Hello! How can I help you today?',
  '嗨！我是 AI 助手，有什么我可以帮你的吗？'
]

function getRandomResponse() {
  return mockResponses[Math.floor(Math.random() * mockResponses.length)]
}

// OpenAI Chat Completions endpoint
chat.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json()
  console.log('Request:', {
    url: c.req.url,
    headers: c.req.header(),
    body: c.req.json(),
  })
  const { stream: isStream, model, messages } = body

  const chatId = generateChatId()
  const timestamp = getCurrentTimestamp()
  const responseText = getRandomResponse()

  // Non-streaming response
  if (!isStream) {
    return c.json({
      id: chatId,
      object: 'chat.completion',
      created: timestamp,
      model: model || 'gpt-35-turbo',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: responseText
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 17,
        total_tokens: 27
      }
    })
  }

  // Streaming response
  return stream(c, async (stream) => {
    // Set headers for SSE
    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')

    // First chunk with role
    await stream.write('data: ' + JSON.stringify({
      choices: [{
        delta: { content: '', role: 'assistant' },
        finish_reason: null,
        index: 0,
        logprobs: null
      }],
      created: timestamp,
      id: chatId,
      model: model || 'gpt-35-turbo',
      object: 'chat.completion.chunk',
      system_fingerprint: 'fp_' + Math.random().toString(36).substring(2, 16)
    }) + '\n\n')

    // Send each character as a separate chunk
    for (const char of responseText) {
      await stream.write('data: ' + JSON.stringify({
        choices: [{
          delta: { content: char },
          finish_reason: null,
          index: 0,
          logprobs: null
        }],
        created: timestamp,
        id: chatId,
        model: model || 'gpt-35-turbo',
        object: 'chat.completion.chunk',
        system_fingerprint: 'fp_' + Math.random().toString(36).substring(2, 16)
      }) + '\n\n')

      // Add small delay to simulate streaming
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    // Final chunk with finish_reason
    await stream.write('data: ' + JSON.stringify({
      choices: [{
        delta: {},
        finish_reason: 'stop',
        index: 0,
        logprobs: null
      }],
      created: timestamp,
      id: chatId,
      model: model || 'gpt-35-turbo',
      object: 'chat.completion.chunk',
      system_fingerprint: 'fp_' + Math.random().toString(36).substring(2, 16)
    }) + '\n\n')

    // Content filter chunk (optional, matching Azure OpenAI format)
    await stream.write('data: ' + JSON.stringify({
      choices: [{
        content_filter_offsets: { check_offset: 40, start_offset: 40, end_offset: 156 },
        content_filter_results: {
          hate: { filtered: false, severity: 'safe' },
          self_harm: { filtered: false, severity: 'safe' },
          sexual: { filtered: false, severity: 'safe' },
          violence: { filtered: false, severity: 'safe' }
        },
        finish_reason: null,
        index: 0
      }],
      created: 0,
      id: '',
      model: '',
      object: ''
    }) + '\n\n')

    // Usage information chunk
    await stream.write('data: ' + JSON.stringify({
      id: chatId,
      object: 'chat.completion.chunk',
      created: timestamp + 3,
      model: model || 'gpt-3.5-turbo',
      choices: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: Math.ceil(responseText.length / 2),
        total_tokens: 10 + Math.ceil(responseText.length / 2)
      }
    }) + '\n\n')

    // Final [DONE] message
    await stream.write('data: [DONE]\n\n')
  })
})

// Mock models list
const mockModels = [
  {
    id: 'gpt-5-nano',
    object: 'model',
    created: 1687882411,
    owned_by: 'openai'
  },
  {
    id: 'gpt-3.5-turbo',
    object: 'model',
    created: 1677610602,
    owned_by: 'openai'
  }
]

// OpenAI Models endpoint
chat.get('/v1/models', (c) => {
  return c.json({
    object: 'list',
    data: mockModels
  })
})

export default chat
