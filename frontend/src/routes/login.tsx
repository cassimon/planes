import { zodResolver } from "@hookform/resolvers/zod"
import {
  createFileRoute,
  Link as RouterLink,
  useNavigate,
} from "@tanstack/react-router"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { useEffect, useRef, useState } from "react"
import Keycloak from "keycloak-js"

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
  const navigate = useNavigate()
  const userRegistrationEnabled = isUserRegistrationEnabled()
  const nomadOAuthEnabled = isNomadOAuthEnabled()
  const [isLoadingNomad, setIsLoadingNomad] = useState(false)
  const keycloakRef = useRef<Keycloak | null>(null)

  // On mount: initialize keycloak-js so redirect-back from Keycloak is processed
  // automatically (keycloak.init handles the auth-code exchange internally).
  useEffect(() => {
    if (!nomadOAuthEnabled) return
    let active = true

    ;(async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/v1/auth/config`)
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

        if (authenticated && keycloak.token) {
          localStorage.setItem("access_token", keycloak.token)
          navigate({ to: "/" })
        } else {
          keycloakRef.current = keycloak
        }
      } catch (err) {
        if (active) console.error("Keycloak init failed:", err)
      }
    })()

    return () => {
      active = false
    }
  }, [nomadOAuthEnabled, navigate])

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

  const handleNomadLogin = () => {
    setIsLoadingNomad(true)
    keycloakRef.current?.login({ redirectUri: window.location.href })
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
