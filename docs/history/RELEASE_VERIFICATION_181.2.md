# Release verification — v181.2.260902

## Scope

- Ryder Cup Trifecta shows **Teams**, **Matchups**, and **Groups** during setup.
- Groups builds each 2-v-2 foursome incrementally.
- Matchups retains the singles pairing swap for every completed foursome.
- Failed foursome persistence is visible to the organizer.

## Staging order

1. Install the v181.2 changed files on Staging.
2. Apply `0147_ryder_cup_trifecta_draft_groups.sql` to the Staging database with RLS enabled.
3. Run the Staging integration workflow.
4. Create a Ryder Cup Trifecta session and verify:
   - Teams, Matchups and Groups are present.
   - Players can be assigned one at a time in Groups.
   - Each completed group has two players from each Cup team.
   - Changing a group does not reset **Swap who plays whom**.
   - Add foursome either saves or displays a database error; it never fails silently.
5. Confirm the scorecard still produces two Singles matches and one Four-Ball match per complete foursome.

## Database verification

```sql
select id, applied_at
from public.schema_migrations
where id = '0147_ryder_cup_trifecta_draft_groups';
```

Expected: exactly one row.
