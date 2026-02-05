// app/page.js
// Home page - redirects to login

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    checkUser()
  }, [])

  async function checkUser() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      // Get user role and redirect to appropriate dashboard
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single()

      if (roleData?.role === 'business') {
        router.push('/business')
      } else if (roleData?.role === 'customer') {
        router.push('/customer')
      } else {
        router.push('/login')
      }
    } else {
      router.push('/login')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-4xl font-light text-gray-800 mb-4">Sure-ty</h1>
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>
  )
}