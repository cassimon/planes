import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"

export const Route = createFileRoute("/auth/nomad/callback")({
  component: NomadCallback,
})

function NomadCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Keycloak returns the authorization code in the URL fragment when
    // response_mode=fragment is used.  Parse it before the hash is cleared.
    const hash = window.location.hash.substring(1)
    const params = new URLSearchParams(hash)

    const code = params.get("code")
    const returnedState = params.get("state")

    // --- CSRF state check ---
    const storedState = sessionStorage.getItem("nomad_state")
    if (!returnedState || returnedState !== storedState) {
      setError("Invalid state parameter — possible CSRF attack. Please try again.")
      sessionStorage.removeItem("nomad_state")
      sessionStorage.removeItem("nomad_code_verifier")
      sessionStorage.removeItem("nomad_redirect_uri")
      return
    }

    const code_verifier = sessionStorage.getItem("nomad_code_verifier")
    const redirect_uri = sessionStorage.getItem("nomad_redirect_uri")

    // Clean up session storage now that we've read the values
    sessionStorage.removeItem("nomad_state")
    sessionStorage.removeItem("nomad_code_verifier")
    sessionStorage.removeItem("nomad_redirect_uri")

    if (!code) {
      const errorDesc = params.get("error_description") ?? params.get("error") ?? "No authorization code received."
      setError(errorDesc)
      return
    }

    if (!code_verifier || !redirect_uri) {
      setError("Missing PKCE session data. Please start the login flow again.")
      return
    }

    // Exchange the authorization code for a token via our backend.
    // The backend calls Keycloak's token endpoint and validates the result.
    fetch(`${import.meta.env.VITE_API_URL}/api/v1/login/nomad/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier, redirect_uri }),
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((body) => {
            throw new Error(body?.detail ?? "Token exchange failed")
          })
        }
        return response.json()
      })
      .then((data) => {
        localStorage.setItem("access_token", data.access_token)
        navigate({ to: "/" })
      })
      .catch((err: Error) => {
        console.error("NOMAD token exchange failed:", err)
        setError(err.message ?? "Authentication failed. Please try again.")
      })
  }, [navigate])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600">Authentication Error</h1>
          <p className="mt-4 text-muted-foreground">{error}</p>
          <button
            onClick={() => navigate({ to: "/login" })}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-primary-foreground"
          >
            Return to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Authenticating...</h1>
        <p className="mt-4 text-muted-foreground">
          Please wait while we complete your NOMAD login.
        </p>
      </div>
    </div>
  )
}
