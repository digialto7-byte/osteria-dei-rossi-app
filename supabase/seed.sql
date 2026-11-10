-- Local seed: fake data only (docs/client-facts.md: no client facts are approved).
-- Owners need an auth user, so create the demo tenant and its owner with the admin script:
--   npm run create-tenant -- --name "Osteria Demo" --vat IT00000000000 \
--     --owner-email owner@example.test --owner-name "Titolare Demo"

-- Reservations B1 (docs/plans/2026-11-08-reservations.md §3.7): fake local Vault values, equal to the .env.example fakes, so that the public booking page and its
-- tests work on a fresh stack. They are not secrets. Staging and production values are created by hand (docs/guides/cron-vault-secrets.md); never reuse these.
-- reservation_gate_key_next exists only during a gate key rotation, so it is not seeded.
select vault.create_secret('replace-me-local-reservation-gate-key-0000', 'reservation_gate_key', 'local fake: the route gate key (same value as RESERVATION_GATE_KEY)');
select vault.create_secret('replace-me-local-reservation-hash-salt-0000', 'reservation_hash_salt', 'local fake: the daily salt of the throttle hashes');
