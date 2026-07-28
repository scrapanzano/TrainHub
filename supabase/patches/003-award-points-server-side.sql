-- Derive `rewards.points` on the server.
--
-- The app awards points from the client, and the RLS policy `rewards_insert_self`
-- only checks that the row belongs to the caller -- not that the amount is
-- honest.  Anyone with DevTools could award themselves any total.  This trigger
-- overwrites whatever arrives with the value the code is actually worth, so the
-- client's number becomes a hint rather than the source of truth.
--
-- Idempotent: drops and recreates.

create or replace function public.set_reward_points() returns trigger
language plpgsql set search_path = public as $$
begin
  new.points := case
    when new.code like 'workout:%'  then 30
    when new.code like 'checkin:%'  then 10
    when new.code like 'referral:%' then 60
    -- An unknown code is worth nothing rather than whatever was asked for.
    else 0
  end;
  return new;
end;
$$;

drop trigger if exists rewards_set_points on rewards;

create trigger rewards_set_points
  before insert on rewards
  for each row execute function set_reward_points();

-- Confirm the trigger rejects an inflated award.
insert into rewards (member_id, code, title, points)
select id, 'workout:patch-test', 'Patch test', 999999 from profiles where role = 'member' limit 1;

select code, points, points = 30 as points_corrected
from rewards where code = 'workout:patch-test';

delete from rewards
where code = 'workout:patch-test'
  and member_id in (select id from profiles where role = 'member');
