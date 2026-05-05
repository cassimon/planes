import { redirect } from "@tanstack/react-router"

import { ApiError, UsersService } from "@/client"

const ACCESS_TOKEN_KEY = "access_token"

const clearStoredAccessToken = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
}

export const isLoggedIn = () => {
  return localStorage.getItem(ACCESS_TOKEN_KEY) !== null
}

const isAuthError = (error: unknown) => {
  return error instanceof ApiError && [401, 403].includes(error.status)
}

export const ensureAuthenticated = async () => {
  if (!isLoggedIn()) {
    throw redirect({ to: "/login" })
  }

  try {
    await UsersService.readUserMe()
  } catch (error) {
    if (isAuthError(error)) {
      clearStoredAccessToken()
      throw redirect({ to: "/login" })
    }
    throw error
  }
}

export const redirectIfAuthenticated = async () => {
  if (!isLoggedIn()) {
    return
  }

  try {
    await UsersService.readUserMe()
    throw redirect({ to: "/" })
  } catch (error) {
    if (isAuthError(error)) {
      clearStoredAccessToken()
      return
    }
    throw error
  }
}

const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback
  }

  switch (value.trim().toLowerCase()) {
    case "true":
    case "1":
    case "yes":
    case "on":
      return true
    case "false":
    case "0":
    case "no":
    case "off":
      return false
    default:
      return fallback
  }
}

export const isUserRegistrationEnabled = () => {
  return parseBooleanEnv(import.meta.env.VITE_USERS_OPEN_REGISTRATION, true)
}

export const isNomadOAuthEnabled = () => {
  return parseBooleanEnv(import.meta.env.VITE_NOMAD_OAUTH_ENABLED, false)
}