
import 'express-session'

declare module 'express-session' {
  interface SessionData {
    sessionCheck?: boolean
    userId?: string
  }
}
