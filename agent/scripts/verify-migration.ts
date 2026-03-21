/**
 * verify-migration.ts
 *
 * Queries Supabase and reports counts of each todo status value,
 * including any remaining legacy values (reminded, archived).
 *
 * Usage:
 *   SUPABASE_URL=https://... SUPABASE_SERVICE_KEY=... npx tsx scripts/verify-migration.ts
 *
 * Environment variables:
 *   SUPABASE_URL          — Your Supabase project URL
 *   SUPABASE_SERVICE_KEY  — Service role key (has full table access)
 */

import { createClient } from '@supabase/supabase-js';

/** All known status values including legacy and cleanup marker. */
const ALL_STATUSES = [
  'pending',
  'in_progress',
  'done',
  'not_confirmed',
  'canceled',
  'reminded',
  'archived',
  'cleanup_deleted',
];

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.error(
      'Missing environment variables. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.',
    );
    process.exit(1);
  }

  const supabase = createClient(url, key);

  console.log('=== Photon Migration Verification Report ===\n');

  // Query total count
  const { count: totalCount, error: totalError } = await supabase
    .from('todos')
    .select('*', { count: 'exact', head: true });

  if (totalError) {
    console.error('Error querying todos:', totalError.message);
    process.exit(1);
  }

  console.log(`Total todos: ${totalCount ?? 0}\n`);

  // Query count for each status value
  console.log('Status breakdown:');
  console.log('-'.repeat(40));

  const legacyStatuses: string[] = [];

  for (const status of ALL_STATUSES) {
    const { count, error } = await supabase
      .from('todos')
      .select('*', { count: 'exact', head: true })
      .eq('status', status);

    if (error) {
      console.error(`  Error querying status '${status}':`, error.message);
      continue;
    }

    const statusCount = count ?? 0;
    const isLegacy = status === 'reminded' || status === 'archived';
    const isCleanup = status === 'cleanup_deleted';
    const marker = isLegacy ? ' ⚠️  LEGACY' : isCleanup ? ' 🧹 CLEANUP' : '';

    console.log(`  ${status.padEnd(20)} ${String(statusCount).padStart(6)}${marker}`);

    if (isLegacy && statusCount > 0) {
      legacyStatuses.push(`${status} (${statusCount})`);
    }
  }

  console.log('-'.repeat(40));

  // Summary
  console.log('\n=== Summary ===');

  if (legacyStatuses.length > 0) {
    console.log(`⚠️  Legacy values still present: ${legacyStatuses.join(', ')}`);
    console.log('   Run migration 004_backfill_status.sql to fix.');
  } else {
    console.log('✅ No legacy status values remaining.');
  }

  // Check for polluted rows
  const { count: ptCount, error: ptError } = await supabase
    .from('todos')
    .select('*', { count: 'exact', head: true })
    .like('task', '%[PT]%')
    .neq('status', 'cleanup_deleted');

  if (!ptError && (ptCount ?? 0) > 0) {
    console.log(`⚠️  ${ptCount} rows still contain [PT] in task text (not cleaned).`);
  } else if (!ptError) {
    console.log('✅ No [PT]-polluted rows remaining.');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
