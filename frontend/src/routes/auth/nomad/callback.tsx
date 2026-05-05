import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"

export const Route = createFileRoute("/auth/nomad/callback")({
  component: NomadCallback,
})

function NomadCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Extract access token from URL fragment (implicit flow)
    const hash = window.location.hash.substring(1)
    const params = new URLSearchParams(hash)
    const accessToken = params.get("access_token")

    if (accessToken) {
      // Send token to backend for validation and user creation
      fetch(`${import.meta.env.VITE_API_URL}/api/v1/login/nomad/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ access_token: accessToken }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Token validation failed")
          }
          return response.json()
        })
        .then((data) => {
          // Store the token
          localStorage.setItem("access_token", data.access_token)
          // Redirect to home
          navigate({ to: "/" })
        })
        .catch((err) => {
          console.error("Failed to validate NOMAD token:", err)
          setError("Authentication failed. Please try again.")
        })
    } else {
      setError("No access token received from NOMAD.")
    }
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
