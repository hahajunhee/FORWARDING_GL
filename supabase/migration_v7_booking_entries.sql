-- Migration v7: booking_entries JSONB column
-- Run this in Supabase SQL Editor

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_entries JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN bookings.booking_entries IS
  'Array of {no, ctr_type, ctr_qty} objects — multiple booking numbers per row';
