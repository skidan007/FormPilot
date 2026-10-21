
import { useState, type FormEvent } from 'react'
import { apiRequest } from './lib/api'
import './Login.css'

type User = {
  id: string
  email: string
  name?: string | null
}

type AuthResponse = {
  status: string
  message: string
  user: User
}

type LoginProps = {
  onLogin: (user: User) => void
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })

      onLogin(result.user)
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to log in.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <a className="login-brand" href="/">
          <span className="login-brand-mark">F</span>
          FormPilot
        </a>

        <p className="login-eyebrow">WELCOME BACK</p>
        <h1>Sign in to your workspace</h1>
        <p className="login-description">
          Manage your forms and collect responses in one place.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="login-email">Email address</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
          />

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}
