# Supabase Upsert Gotchas

## `ignoreDuplicates: true` does not return conflicting rows

When using Supabase's `.upsert()` with `{ ignoreDuplicates: true }`, PostgreSQL translates this to `INSERT ... ON CONFLICT DO NOTHING`. Combined with `RETURNING *`, this only returns **newly inserted** rows — conflicting (existing) rows are silently skipped and NOT returned.

**Consequence:** Calling `.upsert({ ignoreDuplicates: true }).select('*').single()` will throw `PGRST116` ("The result contains 0 rows") if the row already exists.

**Correct pattern for "get or create":**
- Use `.upsert()` **without** `ignoreDuplicates` (default is `false`), which translates to `ON CONFLICT DO UPDATE SET` and always returns the row.
- Or use `.upsert({ ignoreDuplicates: true }).select('*').maybeSingle()` and follow up with a `.select()` if the result is null.

**Discovered in:** `db-schema-migration` feature review, `agent/src/db.ts:getOrCreateUser()`.
