import { zodResolver } from "@hookform/resolvers/zod"
import {
  createFileRoute,
  Link as RouterLink,
} from "@tanstack/react-router"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { useState } from "react"

import type { Body_login_login_access_token as AccessToken } from "@/client"
import { AuthLayout } from "@/components/Common/AuthLayout"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { PasswordInput } from "@/components/ui/password-input"
import { Button } from "@/components/ui/button"
import useAuth from "@/hooks/useAuth"
import { 
  isUserRegistrationEnabled, 
  redirectIfAuthenticated,
  isNomadOAuthEnabled 
} from "@/lib/auth"

const formSchema = z.object({
  username: z.email(),
  password: z
    .string()
    .min(1, { message: "Password is required" })
    .min(8, { message: "Password must be at least 8 characters" }),
}) satisfies z.ZodType<AccessToken>

type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/login")({
  component: Login,
  beforeLoad: redirectIfAuthenticated,
  head: () => ({
    meta: [
      {
        title: "Log In - FastAPI Template",
      },
    ],
  }),
})

function Login() {
  const { loginMutation } = useAuth()
  const userRegistrationEnabled = isUserRegistrationEnabled()
  const nomadOAuthEnabled = isNomadOAuthEnabled()
  const [isLoadingNomad, setIsLoadingNomad] = useState(false)
  
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      username: "",
      password: "",
    },
  })

  const onSubmit = (data: FormData) => {
    if (loginMutation.isPending) return
    loginMutation.mutate(data)
  }

  const handleNomadLogin = async () => {
    setIsLoadingNomad(true)
    try {
      // Fetch base params from backend (realm URL, client_id, redirect_uri)
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/api/v1/login/nomad/authorize`
      )
      if (!response.ok) throw new Error("Failed to get authorize params")
      const { realm_url, client_id, redirect_uri } = await response.json()

      // --- PKCE (RFC 7636) ---
      // Generate a cryptographically random code_verifier
      const verifierBytes = new Uint8Array(96)
      crypto.getRandomValues(verifierBytes)
      const code_verifier = btoa(String.fromCharCode(...verifierBytes))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

      // Compute SHA-256 of verifier → base64url = code_challenge
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(code_verifier),
      )
      const code_challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

      // CSRF state + nonce for replay protection
      const state = crypto.randomUUID()
      const nonce = crypto.randomUUID()

      // Persist for the callback page (same origin, clears on tab close)
      sessionStorage.setItem("nomad_state", state)
      sessionStorage.setItem("nomad_code_verifier", code_verifier)
      sessionStorage.setItem("nomad_redirect_uri", redirect_uri)

      // Build authorize URL identical to real NOMAD Oasis
      const params = new URLSearchParams({
        client_id,
        redirect_uri,
        state,
        response_mode: "fragment",
        response_type: "code",
        scope: "openid",
        nonce,
        code_challenge,
        code_challenge_method: "S256",
      })
      window.location.href = `${realm_url}/protocol/openid-connect/auth?${params}`
    } catch (error) {
      console.error("Failed to initiate NOMAD login:", error)
      setIsLoadingNomad(false)
    }
  }

  return (
    <AuthLayout>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-bold">Login to your account</h1>
          </div>

          <div className="grid gap-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="email-input"
                      placeholder="user@example.com"
                      type="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center">
                    <FormLabel>Password</FormLabel>
                    <RouterLink
                      to="/recover-password"
                      className="ml-auto text-sm underline-offset-4 hover:underline"
                    >
                      Forgot your password?
                    </RouterLink>
                  </div>
                  <FormControl>
                    <PasswordInput
                      data-testid="password-input"
                      placeholder="Password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <LoadingButton type="submit" loading={loginMutation.isPending}>
              Log In
            </LoadingButton>
            
            {nomadOAuthEnabled && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or continue with
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleNomadLogin}
                  disabled={isLoadingNomad}
                >
                  {isLoadingNomad ? "Redirecting..." : "Login with NOMAD"}
                </Button>
              </>
            )}
          </div>

          {userRegistrationEnabled ? (
            <div className="text-center text-sm">
              Don't have an account yet?{" "}
              <RouterLink to="/signup" className="underline underline-offset-4">
                Sign up
              </RouterLink>
            </div>
          ) : null}
        </form>
      </Form>
    </AuthLayout>
  )
}
