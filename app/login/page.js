// app/login/page.js
// Login page - supports business (email/password) and customer (phone OTP)

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [userType, setUserType] = useState('business') // 'business' or 'customer'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()

  // Business login with email/password
  async function handleBusinessLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Check if user is a business
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', data.user.id)
      .single()

    if (roleData?.role === 'business') {
      router.push('/business')
    } else {
      setError('This account is not registered as a business')
      await supabase.auth.signOut()
    }

    setLoading(false)
  }

  // Customer login - send OTP
  async function handleSendOTP(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Format phone number (must include country code)
    const formattedPhone = phone.startsWith('+') ? phone : `+91${phone}`

    const { error } = await supabase.auth.signInWithOtp({
      phone: formattedPhone,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setOtpSent(true)
    setLoading(false)
  }

  // Customer login - verify OTP
  async function handleVerifyOTP(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const formattedPhone = phone.startsWith('+') ? phone : `+91${phone}`

    const { data, error } = await supabase.auth.verifyOtp({
      phone: formattedPhone,
      token: otp,
      type: 'sms',
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Check if user is a customer
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', data.user.id)
      .single()

    if (roleData?.role === 'customer') {
      router.push('/customer')
    } else {
      setError('This account is not registered as a customer')
      await supabase.auth.signOut()
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-light text-gray-900 mb-2">Sure-ty</h1>
          <p className="text-gray-600">Sign in to your account</p>
        </div>

        {/* User Type Toggle */}
        <div className="bg-white rounded-2xl p-2 mb-6 flex shadow-sm">
          <button
            onClick={() => setUserType('business')}
            className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all ${
              userType === 'business'
                ? 'bg-gray-900 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Business
          </button>
          <button
            onClick={() => setUserType('customer')}
            className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all ${
              userType === 'customer'
                ? 'bg-gray-900 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Customer
          </button>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-2xl shadow-sm p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* BUSINESS LOGIN */}
          {userType === 'business' && (
            <form onSubmit={handleBusinessLogin} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  placeholder="you@company.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gray-900 text-white py-3 px-4 rounded-xl font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          )}

          {/* CUSTOMER LOGIN */}
          {userType === 'customer' && !otpSent && (
            <form onSubmit={handleSendOTP} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  placeholder="9876543210"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Enter your 10-digit mobile number
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gray-900 text-white py-3 px-4 rounded-xl font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Sending OTP...' : 'Send OTP'}
              </button>
            </form>
          )}

          {userType === 'customer' && otpSent && (
            <form onSubmit={handleVerifyOTP} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Enter OTP
                </label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  required
                  maxLength={6}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent text-center text-2xl tracking-widest"
                  placeholder="000000"
                />
                <p className="text-xs text-gray-500 mt-2">
                  OTP sent to {phone}
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gray-900 text-white py-3 px-4 rounded-xl font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Verifying...' : 'Verify OTP'}
              </button>

              <button
                type="button"
                onClick={() => setOtpSent(false)}
                className="w-full text-gray-600 text-sm hover:text-gray-900"
              >
                Change phone number
              </button>
            </form>
          )}

          {/* Signup Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Don't have an account?{' '}
              <Link href="/signup" className="text-gray-900 font-medium hover:underline">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}