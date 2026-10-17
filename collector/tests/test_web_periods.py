import unittest
from datetime import date
from traini_collector.web import web_period

class WebPeriodTests(unittest.TestCase):
    def test_explicit_sunday_period_remains_the_same_after_monday_rollover(self):
        sunday, monday = date(2026, 10, 18), date(2026, 10, 19)
        for today in [sunday, monday]:
            period = web_period(today, date(2026, 10, 12), sunday)
            self.assertEqual((period.start, period.end), (date(2026, 10, 12), sunday))
            self.assertLessEqual(period.end, today)

    def test_previous_week_request_also_survives_sunday_to_monday_startup(self):
        period=web_period(date(2026,10,19),date(2026,10,5),date(2026,10,11))
        self.assertEqual((period.start,period.end),(date(2026,10,5),date(2026,10,11)))

    def test_future_partial_non_monday_and_old_ranges_fail_before_collection(self):
        today = date(2026, 10, 18)
        for start, end in [(date(2026,10,19),date(2026,10,25)), (date(2026,10,13),today),
                           (date(2026,10,12),date(2026,10,17)), (date(2026,9,28),date(2026,10,4)), (today,None)]:
            with self.subTest(start=start,end=end), self.assertRaises(ValueError):
                web_period(today,start,end)

    def test_midweek_cannot_import_an_incomplete_current_week(self):
        with self.assertRaises(ValueError):
            web_period(date(2026,10,17),date(2026,10,12),date(2026,10,18))
        self.assertEqual(web_period(date(2026,10,18)).start,date(2026,10,5))
