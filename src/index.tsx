import { Hono } from 'hono'
import { renderer } from './renderer'
import fakeChat from './routes/fake-chat'

const app = new Hono()

app.use(renderer)

app.get('/', (c) => {
  return c.render(<h1>Hello!</h1>)
})

// Mount chat completions routes
app.route('/', fakeChat)

export default app
