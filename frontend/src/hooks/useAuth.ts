import { useQuery, useQueryClient } from "@tanstack/react-query"

import { type UserPublic, UsersService } from "@/client"
import { isLoggedIn } from "@/lib/auth"
import { logout } from "@/lib/keycloakInstance"

const useAuth = () => {
  const queryClient = useQueryClient()

  const { data: user } = useQuery<UserPublic | null, Error>({
    queryKey: ["currentUser"],
    queryFn: UsersService.readUserMe,
    enabled: isLoggedIn(),
    retry: false,
  })

  const handleLogout = () => {
    // Clear cached queries then hand off to Keycloak logout (which redirects).
    queryClient.clear()
    logout()
  }

  return {
    logout: handleLogout,
    user,
  }
}

export { isLoggedIn }
export default useAuth
