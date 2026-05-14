import { createFileRoute, useNavigate } from "@tanstack/react-router"
import Keycloak from "keycloak-js"
import { useEffect, useState } from "react"

import { AuthLayout } from "@/components/Common/AuthLayout"
import { Button } from "@/components/ui/button"
import { setKeycloak, getKeycloak } from "@/lib/keycloakInstance"
import { redirectIfAuthenticated } from "@/lib/auth"

export const Route = createFileRoute("/login")({
  component: Login,
  beforeLoad: redirectIfAuthenticated,
  head: () => ({
    meta: [{ title: "Sign In" }],
  }),
})

function Login() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialise keycloak-js on mount.
  // If the page is loaded after a Keycloak redirect (auth-code in URL),
  // keycloak.init() silently exchanges the code and sets authenticated = true.
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/api/v1/auth/config`,
        )
        if (!res.ok) {
          if (active) setError("Auth configuration unavailable.")
          return
        }
        const cfg = await res.json()
        const keycloak = new Keycloak({
          url: cfg.keycloak_url,
          realm: cfg.keycloak_realm,
          clientId: cfg.keycloak_client_id,
        })
        const authenticated = await keycloak.init({
          onLoad: "check-sso",
          checkLoginIframe: false,
        })
        if (!active) return
        setKeycloak(keycloak)
        if (authenticated) navigate({ to: "/" })
      } catch (err) {
        console.error("Keycloak init failed:", err)
        if (active) setError("Could not reach the NOMAD auth service.")
      }
    })()
    return () => {
      active = false
    }
  }, [navigate])

  const handleLogin = () => {
    setLoading(true)
    // Redirect to NOMAD Keycloak; after login Keycloak redirects back to /
    // where keycloak.init() (running on the login page) processes the code.
    getKeycloak()?.login({ redirectUri: window.location.origin + "/" })
  }

  return (
    <AuthLayout>
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-2xl font-bold">Sign in to Plains</h1>
        <p className="text-sm text-muted-foreground">
          Use your NOMAD account to continue.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={handleLogin} disabled={loading} className="w-full">
          {loading ? "Redirecting…" : "Login with NOMAD"}
        </Button>
      </div>
    </AuthLayout>
  )
}
