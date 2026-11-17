## What changed

## Checks
- [ ] Tests added or updated
- [ ] New tables and columns have `COMMENT`s (DB-14)
- [ ] Site-owned tables have `site_id`, forced RLS, composite `(site_id, id)` keys and an isolation fixture
- [ ] No secrets, keys or employer material; nothing calls home
- [ ] Screens pass axe at 1280 and 390 × 844
- [ ] New dependencies are on the allow-list (or an approved condition) and recorded in `docs/dependencies.md`
- [ ] CHANGELOG updated
