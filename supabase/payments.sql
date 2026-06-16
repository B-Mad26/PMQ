-- Payment hardening — APPLY ONLY ONCE THE STRIPE WEBHOOK IS LIVE.
-- Until then, the client still flips profiles.premium directly; applying this
-- early would make premium ungrantable (the webhook becomes the only path).
--
-- Stops a signed-in client from granting itself premium: any change to
-- profiles.premium coming from anything other than the service role is reverted.
-- The Stripe webhook uses the service-role key, so it remains able to grant.

create or replace function public.guard_premium()
returns trigger language plpgsql as $$
begin
  if new.premium is distinct from old.premium and coalesce(auth.role(), '') <> 'service_role' then
    new.premium := old.premium;  -- silently keep the old value for non-service callers
  end if;
  return new;
end; $$;

drop trigger if exists profiles_guard_premium on public.profiles;
create trigger profiles_guard_premium before update on public.profiles
  for each row execute function public.guard_premium();
