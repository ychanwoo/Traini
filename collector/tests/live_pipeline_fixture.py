"""Synthetic FIT -> real parser -> disposable owner's Supabase; never log in to Garmin."""
import os
import tempfile
from datetime import datetime, time, timedelta, UTC
from pathlib import Path
from zoneinfo import ZoneInfo
from test_fit import encoded_fit, session
from traini_collector.sync import sync_activities
from traini_collector.parsing import parse_activities
from traini_collector.upload import SupabaseActivityStore, upload_activities

zone = ZoneInfo(os.environ.get("TRAINI_TIMEZONE", "America/Los_Angeles"))
today = datetime.now(zone).date()
end = today - timedelta(days=today.weekday()+1)
start = end - timedelta(days=6)
started = datetime.combine(end, time(7), zone).astimezone(UTC)
contents = encoded_fit([session(start_time=started, timestamp=started+timedelta(seconds=2000))])

class FixtureClient:
    def get_activities_by_date(self, *_args, **_kwargs):
        return [{"activityId": 101, "startTimeGMT": started.isoformat(), "startTimeLocal": started.astimezone(zone).isoformat(), "activityType": {"typeKey": "running"}}]
    def download_activity(self, *_args, **_kwargs):
        return contents

with tempfile.TemporaryDirectory(prefix="traini-pipeline-") as folder:
    data = Path(folder)
    client = FixtureClient()
    first = sync_activities(client, start, end, data, "fixture", lambda _: None, timezone=zone)
    assert first.downloaded == 1
    assert parse_activities(data, zone, lambda _: None).processed == 1
    store = SupabaseActivityStore(os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"], os.environ["TRAINI_FIXTURE_OWNER"])
    try:
        assert upload_activities(data, store, lambda _: None).inserted == 1
        assert sync_activities(client, start, end, data, "fixture", lambda _: None, timezone=zone).skipped == 1
        assert parse_activities(data, zone, lambda _: None).skipped == 1
        assert upload_activities(data, store, lambda _: None).unchanged == 1
        assert (data / "activities/101.fit").read_bytes() == contents
    finally:
        store.close()
print("Synthetic FIT pipeline persisted once and safely reused.")
