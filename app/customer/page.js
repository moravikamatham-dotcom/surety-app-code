// app/customer/page.js
// Customer Dashboard - View invoices and request edits

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { signOut } from '@/lib/auth'

export default function CustomerDashboard() {
  const router = useRouter()
  const supabase = createClient()

  const [customer, setCustomer] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editedItems, setEditedItems] = useState([])
  const [myRequests, setMyRequests] = useState([])

  useEffect(() => {
    checkAuth()
  }, [])

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    // Get customer profile
    const { data: customerData } = await supabase
      .from('customers')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (!customerData) {
      router.push('/login')
      return
    }

    setCustomer(customerData)
    loadData(customerData.id)
    setupRealtimeSubscriptions(customerData.id)
    setLoading(false)
  }

  async function loadData(customerId) {
    // Load invoices
    const { data: invoicesData } = await supabase
      .from('invoices')
      .select(`
        *,
        business:businesses(business_name),
        items:invoice_items(*)
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })

    setInvoices(invoicesData || [])

    // Load my edit requests
    const { data: requestsData } = await supabase
      .from('invoice_edit_requests')
      .select(`
        *,
        invoice:invoices(invoice_number, business:businesses(business_name))
      `)
      .eq('requested_by', customerId)
      .order('created_at', { ascending: false })

    setMyRequests(requestsData || [])
  }

  function setupRealtimeSubscriptions(customerId) {
    // Subscribe to invoice changes
    const invoiceChannel = supabase
      .channel('customer-invoice-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'invoices',
          filter: `customer_id=eq.${customerId}`
        },
        () => {
          loadData(customerId)
        }
      )
      .subscribe()

    // Subscribe to edit request updates
    const requestChannel = supabase
      .channel('customer-request-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'invoice_edit_requests',
          filter: `requested_by=eq.${customerId}`
        },
        () => {
          loadData(customerId)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(invoiceChannel)
      supabase.removeChannel(requestChannel)
    }
  }

  function openEditModal(invoice) {
    setSelectedInvoice(invoice)
    // Clone the items for editing
    setEditedItems(JSON.parse(JSON.stringify(invoice.items)))
    setShowEditModal(true)
  }

  function updateEditedItem(index, field, value) {
    const updated = [...editedItems]
    updated[index][field] = value
    
    // Recalculate total_price
    if (field === 'quantity' || field === 'unit_price') {
      const qty = parseFloat(updated[index].quantity) || 0
      const price = parseFloat(updated[index].unit_price) || 0
      updated[index].total_price = qty * price
    }
    
    setEditedItems(updated)
  }

  async function submitEditRequest() {
    if (!selectedInvoice) return

    // Create edit request
    const { error } = await supabase
      .from('invoice_edit_requests')
      .insert({
        invoice_id: selectedInvoice.id,
        requested_by: customer.id,
        original_items: selectedInvoice.items,
        requested_items: editedItems,
        status: 'pending'
      })

    if (error) {
      alert('Error submitting request: ' + error.message)
      return
    }

    setShowEditModal(false)
    setSelectedInvoice(null)
    setEditedItems([])
    loadData(customer.id)
    alert('Edit request submitted successfully!')
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
              <p className="text-sm text-gray-600">{customer.customer_name}</p>
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

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <p className="text-sm text-gray-600 mb-2">Total Invoices</p>
            <p className="text-3xl font-light text-gray-900">{invoices.length}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <p className="text-sm text-gray-600 mb-2">Pending Payment</p>
            <p className="text-3xl font-light text-gray-900">
              {invoices.filter(inv => inv.status !== 'paid').length}
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <p className="text-sm text-gray-600 mb-2">Total Due</p>
            <p className="text-3xl font-light text-gray-900">
              ₹{invoices
                .filter(inv => inv.status !== 'paid')
                .reduce((sum, inv) => sum + inv.total_amount, 0)
                .toLocaleString()}
            </p>
          </div>
        </div>

        {/* Invoices */}
        <div className="mb-8">
          <h2 className="text-xl font-medium text-gray-900 mb-6">My Invoices</h2>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                    Invoice #
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">
                    Business
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
                      {invoice.business?.business_name}
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
                          onClick={() => openEditModal(invoice)}
                          className="text-gray-900 hover:text-gray-700 font-medium"
                        >
                          Request Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {invoices.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                No invoices yet
              </div>
            )}
          </div>
        </div>

        {/* My Edit Requests */}
        <div>
          <h2 className="text-xl font-medium text-gray-900 mb-6">My Edit Requests</h2>
          <div className="space-y-4">
            {myRequests.map((request) => (
              <div key={request.id} className="bg-white rounded-2xl shadow-sm p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium text-gray-900">
                      {request.invoice?.invoice_number}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {request.invoice?.business?.business_name}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Requested on {new Date(request.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`px-4 py-2 rounded-full text-sm font-medium ${
                    request.status === 'approved'
                      ? 'bg-green-100 text-green-800'
                      : request.status === 'rejected'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {request.status}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Original</p>
                    <div className="space-y-1">
                      {request.original_items.map((item, i) => (
                        <div key={i} className="text-sm text-gray-600">
                          {item.item_name}: {item.quantity} × ₹{item.unit_price}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Requested</p>
                    <div className="space-y-1">
                      {request.requested_items.map((item, i) => (
                        <div key={i} className="text-sm text-gray-900 font-medium">
                          {item.item_name}: {item.quantity} × ₹{item.unit_price}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {myRequests.length === 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-12 text-center text-gray-500">
                No edit requests yet
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Invoice Modal */}
      {showEditModal && selectedInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-8">
            <h3 className="text-xl font-medium text-gray-900 mb-6">
              Request Edit: {selectedInvoice.invoice_number}
            </h3>

            <div className="space-y-4 mb-6">
              <p className="text-sm text-gray-600">
                Modify the quantities or prices below. The business will review your request.
              </p>

              {editedItems.map((item, index) => (
                <div key={index} className="bg-gray-50 p-4 rounded-xl">
                  <div className="flex items-center space-x-4">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700 mb-2">
                        {item.item_name}
                      </p>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs text-gray-600">Quantity</label>
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateEditedItem(index, 'quantity', e.target.value)}
                            step="0.01"
                            className="w-full px-3 py-2 mt-1 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-600">Unit Price</label>
                          <input
                            type="number"
                            value={item.unit_price}
                            onChange={(e) => updateEditedItem(index, 'unit_price', e.target.value)}
                            step="0.01"
                            className="w-full px-3 py-2 mt-1 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-600">Total</label>
                          <p className="w-full px-3 py-2 mt-1 bg-gray-100 rounded-lg text-gray-900 font-medium">
                            ₹{item.total_price.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-gray-50 p-4 rounded-xl mb-6">
              <div className="flex justify-between items-center">
                <span className="font-medium text-gray-700">New Total:</span>
                <span className="text-2xl font-medium text-gray-900">
                  ₹{editedItems.reduce((sum, item) => sum + (item.total_price || 0), 0).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowEditModal(false)
                  setSelectedInvoice(null)
                  setEditedItems([])
                }}
                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submitEditRequest}
                className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800"
              >
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}