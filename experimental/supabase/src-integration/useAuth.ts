import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabaseClient, isSupabaseConfigured } from './supabase'

type AuthState = 'local' | 'loading' | 'signed_out' | 'signed_in'

export function useAuth() {
  const [state, setState] = useState<AuthState>(isSupabaseConfigured ? 'loading' : 'local')
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const client = getSupabaseClient()
    if (!client) return undefined

    let mounted = true
    void client.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setUser(data.session?.user ?? null)
      setState(data.session ? 'signed_in' : 'signed_out')
    })

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setState(session ? 'signed_in' : 'signed_out')
    })

    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  const sendMagicLink = useCallback(async (email: string) => {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase 未配置')
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const client = getSupabaseClient()
    if (!client) return
    const { error } = await client.auth.signOut()
    if (error) throw error
  }, [])

  return { state, user, sendMagicLink, signOut }
}
