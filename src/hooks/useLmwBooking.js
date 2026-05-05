import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Place a Lower Murray Water order from the dashboard.
 *
 *   const { placeOrder, submitting, error, lastReceipt } = useLmwBooking()
 *   await placeOrder({
 *     start_at_local: '2026-05-10T07:00',  // local Australia/Melbourne
 *     hours: 12,
 *     flow_lps: 15,
 *     shift_no: 1,
 *   })
 *
 * Returns the receipt number on success and throws/sets error on failure.
 * The caller is expected to refresh useLmwOrders / useLmwAllocation after.
 */
export function useLmwBooking() {
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState(null)
  const [lastReceipt, setLastReceipt] = useState(null)

  const placeOrder = useCallback(async ({ start_at_local, hours, flow_lps, shift_no = 1 }) => {
    setSubmitting(true)
    setError(null)
    try {
      const { data, error: invErr } = await supabase.functions.invoke('lmw-place-order', {
        body: { start_at_local, hours, flow_lps, shift_no },
      })
      if (invErr) throw invErr
      if (!data?.ok) throw new Error(data?.error || 'Booking failed')
      setLastReceipt(data.receipt_no)
      return data
    } catch (e) {
      setError(e)
      throw e
    } finally {
      setSubmitting(false)
    }
  }, [])

  return { placeOrder, submitting, error, lastReceipt }
}
