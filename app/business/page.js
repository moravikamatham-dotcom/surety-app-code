// app/business/page.js
// Business Dashboard - Complete functionality

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { signOut } from '@/lib/auth'

export default function BusinessDashboard() {
  const router = useRouter()
  const supabase = createClient()

  // State
  const [business, setBusiness] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('invoices') // invoices, customers, requests
  
  // Customers
  const [customers, setCustomers] = useState([])
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [newCustomer, setNewCustomer] = useState({
    phone: '',
    name: '',
    email: '',
    address: '',
    creditLimit: '',
    paymentTerms: 30
  })

  // Invoices
  const [invoices, setInvoices] = useState([])
  const [showCreateInvoice, setShowCreateInvoice] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [invoiceItems, setInvoiceItems] = useState([
    { item_name: '', quantity: '', unit_price: '' }
  ])
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])

  // Edit Requests
  const [editRequests, setEditRequests] = useState([])

  useEffect(() => {
    checkAuth()
  }, [])

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    // Get business profile
    const { data: businessData } = await supabase
      .from('businesses')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (!businessData) {
      router.push('/login')
      return
    }

    setBusiness(businessData)
    loadData(businessData.id)
    setupRealtimeSubscriptions(businessData.id)
    setLoading(false)
  }

  async function loadData(businessId) {
    // Load customers
    const { data: customersData } = await supabase
      .from('business_customers')
      .select(`
        *,
        customer:customers(*)
      `)
      .eq('business_id', businessId)

    setCustomers(customersData || [])

    // Load invoices
    const { data: invoicesData } = await supabase
      .from('invoices')
      .select(`
        *,
        customer:customers(customer_name),
        items:invoice_items(*)
      `)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })

    setInvoices(invoicesData || [])

    // Load edit requests
    const { data: requestsData } = await supabase
      .from('invoice_edit_requests')
      .select(`
        *,
        invoice:invoices(invoice_number),
        customer:customers(customer_name)
      `)
      .eq('status', 'pending')
      .in('invoice_id', (invoicesData || []).map(inv => inv.id))

    setEditRequests(requestsData || [])
  }

  function setupRealtimeSubscriptions(businessId) {
    // Subscribe to invoice changes
    const invoiceChannel = supabase
      .channel('invoice-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'invoices',
          filter: `business_id=eq.${businessId}`
        },
        () => {
          loadData(businessId)
        }
      )
      .subscribe()

    // Subscribe to edit request changes
    const requestChannel = supabase
      .channel('request-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'invoice_edit_requests'
        },
        () => {
          loadData(businessId)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(invoiceChannel)
      supabase.removeChannel(requestChannel)
    }
  }

  // Add customer
  async function handleAddCustomer(e) {
    e.preventDefault()

    // First, check if customer exists with this phone
    const formattedPhone = newCustomer.phone.startsWith('+') 
      ? newCustomer.phone 
      : `+91${newCustomer.phone}`

    let { data: existingCustomer } = await supabase
      .from('customers')
      .select('*')
      .eq('phone_number', formattedPhone)
      .single()

    let customerId

    if (!existingCustomer) {
      // Create new customer (they'll need to sign up to access their dashboard)
      const { data: newCustomerData, error } = await supabase
        .from('customers')
        .insert({
          customer_name: newCustomer.name,
          phone_number: formattedPhone,
          email: newCustomer.email,
          address: newCustomer.address,
        })
        .select()
        .single()

      if (error) {
        alert('Error creating customer: ' + error.message)
        return
      }
      customerId = newCustomerData.id
    } else {
      customerId = existingCustomer.id
    }

    // Link customer to business
    const { error: linkError } = await supabase
      .from('business_customers')
      .insert({
        business_id: business.id,
        customer_id: customerId,
        credit_limit: parseFloat(newCustomer.creditLimit) || 0,
        payment_terms_days: parseInt(newCustomer.paymentTerms)
      })

    if (linkError) {
      alert('Error linking customer: ' + linkError.message)
      return
    }

    setShowAddCustomer(false)
    setNewCustomer({
      phone: '',
      name: '',
      email: '',
      address: '',
      creditLimit: '',
      paymentTerms: 30
    })
    loadData(business.id)
  }

  // Create invoice
  async function handleCreateInvoice(e) {
    e.preventDefault()

    // Calculate total
    const total = invoiceItems.reduce((sum, item) => {
      return sum + (parseFloat(item.quantity) * parseFloat(item.unit_price))
    }, 0)

    // Get payment terms for due date
    const { data: bcData } = await supabase
      .from('business_customers')
      .select('payment_terms_days')
      .eq('business_id', business.id)
      .eq('customer_id', selectedCustomerId)
      .single()

    const paymentTerms = bcData?.payment_terms_days || 30
    const dueDate = new Date(invoiceDate)
    dueDate.setDate(dueDate.getDate() + paymentTerms)

    // Create invoice
    const invoiceNumber = `INV-${Date.now()}`
    
    const { data: invoice, error: invError } = await supabase
      .from('invoices')
      .insert({
        business_id: business.id,
        customer_id: selectedCustomerId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate.toISOString().split('T')[0],
        total_amount: total,
        paid_amount: 0,
        status: 'sent'
      })
      .select()
      .single()

    if (invError) {
      alert('Error creating invoice: ' + invError.message)
      return
    }

    // Create invoice items
    const items = invoiceItems.map(item => ({
      invoice_id: invoice.id,
      item_name: item.item_name,
      quantity: parseFloat(item.quantity),
      unit_price: parseFloat(item.unit_price),
      total_price: parseFloat(item.quantity) * parseFloat(item.unit_price)
    }))

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(items)

    if (itemsError) {
      alert('Error creating invoice items: ' + itemsError.message)
      return
    }

    setShowCreateInvoice(false)
    setSelectedCustomerId('')
    setInvoiceItems([{ item_name: '', quantity: '', unit_price: '' }])
    loadData(business.id)
  }

  // Add invoice item row
  function addInvoiceItem() {
    setInvoiceItems([...invoiceItems, { item_name: '', quantity: '', unit_price: '' }])
  }

  // Remove invoice item row
  function removeInvoiceItem(index) {
    setInvoiceItems(invoiceItems.filter((_, i) => i !== index))
  }

  // Update invoice item
  function updateInvoiceItem(index, field, value) {
    const updated = [...invoiceItems]
    updated[index][field] = value
    setInvoiceItems(updated)
  }

  // Mark invoice as paid
  async function markAsPaid(invoiceId, totalAmount) {
    const { error } = await supabase
      .from('invoices')
      .update({ 
        status: 'paid',
        paid_amount: totalAmount
      })
      .eq('id', invoiceId)

    if (error) {
      alert('Error: ' + error.message)
      return
    }

    // Record payment
    await supabase
      .from('payments')
      .insert({
        invoice_id: invoiceId,
        amount: totalAmount,
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: 'Manual'
      })

    loadData(business.id)
  }

  // Approve edit request
  async function approveEditRequest(requestId, invoiceId, requestedItems) {
    // Update invoice items
    const { data: invoice } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single()

    // Delete old items
    await supabase
      .from('invoice_items')
      .delete()
      .eq('invoice_id', invoiceId)

    // Insert new items
    await supabase
      .from('invoice_items')
      .insert(requestedItems.map(item => ({
        invoice_id: invoiceId,
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price
      })))

    // Update invoice total
    const newTotal = requestedItems.reduce((sum, item) => sum + item.total_price, 0)
    await supabase
      .from('invoices')
      .update({ 
        total_amount: newTotal,
        updated_at: new Date().toISOString()
      })
      .eq('id', invoiceId)

    // Mark request as approved
    await supabase
      .from('invoice_edit_requests')
      .update({ 
        status: 'approved',
        reviewed_at: new Date().toISOString()
      })
      .eq('id', requestId)

    loadData(business.id)
  }

  // Reject edit request
  async function rejectEditRequest(requestId) {
    await supabase
      .from('invoice_edit_requests')
      .update({ 
        status: 'rejected',
        reviewed_at: new Date().toISOString()
      })
      .eq('id', requestId)

    loadData(business.id)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-light text-gray-900">Sure-ty</h1>
              <p className="text-sm text-gray-600">{business.business_name}</p>
            </div>
            <button
              onClick={signOut}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex space-x-8">
            <button
              onClick={() => setActiveTab('invoices')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'invoices'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Invoices
            </button>
            <button
              onClick={() => setActiveTab('customers')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'customers'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Customers
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'requests'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Edit Requests
              {editRequests.length > 0 && (
                <span className="ml-2 bg-gray-900 text-white text-xs px-2 py-1 rounded-full">
                  {editRequests.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* INVOICES TAB */}
        {activeTab === 'invoices' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-medium text-gray-900">Invoices</h2>
              <button
                onClick={() => setShowCreateInvoice(true)}
                className="px-6 py-2 bg-gray-900 text-white rounded-xl hover:bg-gray-800"
              >
                Create Invoice
              </button>
            </div>

            {/* Invoices List */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Invoice #
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Customer
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Date
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Due Date
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Amount
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {invoice.invoice_number}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {invoice.customer?.customer_name}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {new Date(invoice.invoice_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {new Date(invoice.due_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                        ₹{invoice.total_amount.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          invoice.status === 'paid' 
                            ? 'bg-green-100 text-green-800'
                            : invoice.status === 'overdue'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {invoice.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {invoice.status !== 'paid' && (
                          <button
                            onClick={() => markAsPaid(invoice.id, invoice.total_amount)}
                            className="text-gray-900 hover:text-gray-700 font-medium"
                          >
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {invoices.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  No invoices yet. Create your first invoice!
                </div>
              )}
            </div>
          </div>
        )}

        {/* CUSTOMERS TAB */}
        {activeTab === 'customers' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-medium text-gray-900">Customers</h2>
              <button
                onClick={() => setShowAddCustomer(true)}
                className="px-6 py-2 bg-gray-900 text-white rounded-xl hover:bg-gray-800"
              >
                Add Customer
              </button>
            </div>

            {/* Customers List */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Name
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Phone
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Email
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Credit Limit
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                      Payment Terms
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {customers.map((bc) => (
                    <tr key={bc.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {bc.customer?.customer_name}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {bc.customer?.phone_number}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {bc.customer?.email || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        ₹{bc.credit_limit?.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {bc.payment_terms_days} days
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {customers.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  No customers yet. Add your first customer!
                </div>
              )}
            </div>
          </div>
        )}

        {/* EDIT REQUESTS TAB */}
        {activeTab === 'requests' && (
          <div>
            <h2 className="text-xl font-medium text-gray-900 mb-6">Edit Requests</h2>

            <div className="space-y-4">
              {editRequests.map((request) => (
                <div key={request.id} className="bg-white rounded-2xl shadow-sm p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {request.invoice?.invoice_number}
                      </h3>
                      <p className="text-sm text-gray-600">
                        Requested by {request.customer?.customer_name}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(request.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex space-x-3">
                      <button
                        onClick={() => approveEditRequest(
                          request.id, 
                          request.invoice_id, 
                          request.requested_items
                        )}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => rejectEditRequest(request.id)}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-2">Original Items</p>
                      <div className="space-y-2">
                        {request.original_items.map((item, i) => (
                          <div key={i} className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                            {item.item_name}: {item.quantity} × ₹{item.unit_price} = ₹{item.total_price}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-2">Requested Changes</p>
                      <div className="space-y-2">
                        {request.requested_items.map((item, i) => (
                          <div key={i} className="text-sm text-gray-900 bg-blue-50 p-3 rounded-lg font-medium">
                            {item.item_name}: {item.quantity} × ₹{item.unit_price} = ₹{item.total_price}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {editRequests.length === 0 && (
                <div className="bg-white rounded-2xl shadow-sm p-12 text-center text-gray-500">
                  No pending edit requests
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8">
            <h3 className="text-xl font-medium text-gray-900 mb-6">Add Customer</h3>
            <form onSubmit={handleAddCustomer} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number *
                </label>
                <input
                  type="tel"
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer({...newCustomer, phone: e.target.value})}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="9876543210"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer({...newCustomer, name: e.target.value})}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={newCustomer.email}
                  onChange={(e) => setNewCustomer({...newCustomer, email: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Credit Limit (₹)
                </label>
                <input
                  type="number"
                  value={newCustomer.creditLimit}
                  onChange={(e) => setNewCustomer({...newCustomer, creditLimit: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Terms (days)
                </label>
                <input
                  type="number"
                  value={newCustomer.paymentTerms}
                  onChange={(e) => setNewCustomer({...newCustomer, paymentTerms: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              <div className="flex space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddCustomer(false)}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800"
                >
                  Add Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Invoice Modal */}
      {showCreateInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-8 my-8">
            <h3 className="text-xl font-medium text-gray-900 mb-6">Create Invoice</h3>
            <form onSubmit={handleCreateInvoice} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Customer *
                  </label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                  >
                    <option value="">Select customer</option>
                    {customers.map((bc) => (
                      <option key={bc.customer.id} value={bc.customer.id}>
                        {bc.customer.customer_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Invoice Date *
                  </label>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-3">
                  <label className="block text-sm font-medium text-gray-700">
                    Invoice Items *
                  </label>
                  <button
                    type="button"
                    onClick={addInvoiceItem}
                    className="text-sm text-gray-900 hover:text-gray-700 font-medium"
                  >
                    + Add Item
                  </button>
                </div>
                <div className="space-y-3">
                  {invoiceItems.map((item, index) => (
                    <div key={index} className="flex space-x-3">
                      <input
                        type="text"
                        placeholder="Item name"
                        value={item.item_name}
                        onChange={(e) => updateInvoiceItem(index, 'item_name', e.target.value)}
                        required
                        className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                      <input
                        type="number"
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={(e) => updateInvoiceItem(index, 'quantity', e.target.value)}
                        required
                        step="0.01"
                        className="w-24 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                      <input
                        type="number"
                        placeholder="Price"
                        value={item.unit_price}
                        onChange={(e) => updateInvoiceItem(index, 'unit_price', e.target.value)}
                        required
                        step="0.01"
                        className="w-32 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                      {invoiceItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeInvoiceItem(index)}
                          className="px-4 py-3 text-red-600 hover:text-red-700"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-xl">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-700">Total:</span>
                  <span className="text-2xl font-medium text-gray-900">
                    ₹{invoiceItems.reduce((sum, item) => {
                      const qty = parseFloat(item.quantity) || 0
                      const price = parseFloat(item.unit_price) || 0
                      return sum + (qty * price)
                    }, 0).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateInvoice(false)
                    setInvoiceItems([{ item_name: '', quantity: '', unit_price: '' }])
                  }}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800"
                >
                  Create Invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}