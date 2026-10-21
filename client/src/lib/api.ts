
const API_BASE_URL = '/api'

type ApiError = {
  message?: string
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const data: unknown = await response.json()

  if (!response.ok) {
    const error = data as ApiError
    throw new Error(error.message || 'Something went wrong')
  }

  return data as T
}
