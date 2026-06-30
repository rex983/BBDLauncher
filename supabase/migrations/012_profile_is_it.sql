-- Additive capability on top of `role` — gates the BBD Help Desk ticket queue.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_it boolean NOT NULL DEFAULT false;
