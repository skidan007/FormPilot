
import type { RequestHandler } from 'express'
import { prisma } from '../lib/prisma.js'

export const requireAuth: RequestHandler = async (
  req,
  res,
  next,
) => {
  const userId = req.session.userId

  if (!userId) {
    res.status(401).json({
      status: 'error',
      message: 'Authentication required',
    })
    return
  }

  try {
    // Confirm the account still exists.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    })

    if (!user) {
      res.status(401).json({
        status: 'error',
        message: 'Authentication required',
      })
      return
    }

    next()
  } catch (error) {
    console.error('Authentication check failed:', error)

    res.status(500).json({
      status: 'error',
      message: 'Unable to verify authentication',
    })
  }
}
