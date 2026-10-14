"""Calendar periods for collection and Monday–Sunday training weeks."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class CollectionPeriod:
    start: date
    end: date
    mode: str


def today_in_zone(timezone: ZoneInfo, now: datetime | None = None) -> date:
    instant = now if now is not None else datetime.now(UTC)
    if instant.tzinfo is None:
        raise ValueError("현재 시각에는 시간대 정보가 필요합니다.")
    return instant.astimezone(timezone).date()


def training_week(day: date) -> tuple[date, date]:
    monday = day - timedelta(days=day.weekday())
    return monday, monday + timedelta(days=6)


def previous_training_week(today: date) -> tuple[date, date]:
    monday, _ = training_week(today)
    return monday - timedelta(days=7), monday - timedelta(days=1)


def date_range(end: date, days: int, start: date | None = None) -> tuple[date, date]:
    if days < 1 or days > 366:
        raise ValueError("조회 일수는 1~366일로 설정해 주세요.")
    start = start or end - timedelta(days=days - 1)
    if start > end:
        raise ValueError("시작일은 종료일보다 늦을 수 없습니다.")
    if (end - start).days > 365:
        raise ValueError("한 번에 최대 366일을 조회할 수 있습니다.")
    return start, end


def select_period(today: date, *, start: date | None = None,
                  end: date | None = None, days: int | None = None,
                  previous_week: bool = False) -> CollectionPeriod:
    if previous_week and (start is not None or end is not None or days is not None):
        raise ValueError("--previous-week는 --start, --end, --days와 함께 사용할 수 없습니다.")
    if start is not None and days is not None:
        raise ValueError("--start와 --days 중 하나만 지정해 주세요.")
    if start is None and end is None and days is None:
        week_start, week_end = previous_training_week(today)
        return CollectionPeriod(week_start, week_end, "previous_week")
    range_start, range_end = date_range(end or today, days if days is not None else 7, start)
    return CollectionPeriod(range_start, range_end, "custom" if start is not None or end is not None else "recent")
