import contextlib
import fcntl
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import requests

from traini_collector.parsing import ParsingBusyError, parse_activities
from traini_collector.upload import (SupabaseActivityStore, UploadError, activity_row,
                                     read_manifest, upload_activities, verified_document)
from traini_collector.upload_cli import main
from test_fit import LA, encoded_fit, session

OWNER = '11111111-1111-4111-8111-111111111111'
BASE = 'https://kmmutfcgshellvjgpick.supabase.co'


class MemoryStore:
    owner_id = OWNER

    def __init__(self):
        self.rows = {}
        self.fail = set()
        self.verifications = 0

    def verify_owner(self):
        self.verifications += 1

    def save(self, row):
        key = row['garmin_activity_id']
        if key in self.fail:
            raise UploadError('temporarily_unavailable')
        previous = self.rows.get(key)
        self.rows[key] = row
        return 'inserted' if previous is None else 'unchanged' if previous == row else 'updated'


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name) / 'garmin'
        (self.data / 'activities').mkdir(parents=True)
        self.fit = self.data / 'activities/101.fit'
        self.fit.write_bytes(encoded_fit())
        self.logs = []
        self.store = MemoryStore()
        self.parse()

    def tearDown(self):
        self.temp.cleanup()

    def parse(self):
        parse_activities(self.data, LA, lambda _: None)

    def upload(self, store='default'):
        return upload_activities(self.data, self.store if store == 'default' else store, self.logs.append)

    def state(self):
        return json.loads((self.data / 'upload-state.json').read_text())

    def manifest(self):
        path = self.data / 'parse-state.json'
        return path, json.loads(path.read_text())

    def write_manifest(self, value):
        (self.data / 'parse-state.json').write_text(json.dumps(value))

    def test_insert_repeat_update_and_remote_deletion_recovery(self):
        original = self.fit.read_bytes()
        self.assertEqual(self.upload().inserted, 1)
        self.assertEqual(self.upload().unchanged, 1)
        self.fit.write_bytes(encoded_fit([session(total_distance=10000)]))
        self.parse()
        self.assertEqual(self.upload().updated, 1)
        self.assertEqual(len(self.store.rows), 1)
        self.assertEqual(self.store.rows['101']['distance_meters'], 10000)
        self.store.rows.clear()
        self.assertEqual(self.upload().inserted, 1)
        self.assertEqual(self.state()['status'], 'complete')
        self.assertEqual(self.state()['owner_id'], OWNER)
        self.assertNotIn('SUPABASE', json.dumps(self.state()))
        self.assertNotEqual(self.fit.read_bytes(), original)  # Only the test replaced the source.

    def test_dry_run_does_not_access_supabase_or_overwrite_upload_checkpoint(self):
        self.upload()
        checkpoint = (self.data / 'upload-state.json').read_bytes()
        with patch('requests.Session', side_effect=AssertionError('network not allowed')):
            result = self.upload(None)
        self.assertEqual(result.validated, 1)
        self.assertEqual((self.data / 'upload-state.json').read_bytes(), checkpoint)
        self.assertTrue((self.data / 'upload-validation.json').exists())

    def test_parser_failures_excluded_and_network_failure_isolated_then_retried(self):
        (self.data / 'activities/102.fit').write_bytes(encoded_fit())
        (self.data / 'activities/103.fit').write_bytes(b'bad')
        self.parse()
        self.store.fail.add('101')
        result = self.upload()
        self.assertEqual((result.inserted, result.failed, result.excluded), (1, 1, 1))
        self.assertEqual(self.state()['files']['103.fit']['status'], 'excluded')
        self.store.fail.clear()
        result = self.upload()
        self.assertEqual((result.inserted, result.unchanged, result.failed), (1, 1, 0))
        self.assertEqual(self.state()['status'], 'partial')

    def test_manifest_must_be_complete_and_counts_consistent(self):
        _, original = self.manifest()
        for change in ({'status': 'running'}, {'version': True}, {'finished_at': None},
                       {'counts': {'found': 1, 'processed': 0, 'skipped': 0, 'failed': 0}}):
            self.write_manifest({**original, **change})
            with self.assertRaisesRegex(UploadError, 'invalid_manifest'):
                self.upload()
        self.assertEqual(self.store.verifications, 0)

    def test_changed_parser_or_sdk_requires_reparse(self):
        _, original = self.manifest()
        for change in ({'parser_version': 999}, {'schema_version': True}, {'decoder_version': 'different'}):
            self.write_manifest({**original, **change})
            with self.assertRaisesRegex(UploadError, 'reparse_required'):
                self.upload()

    def test_changed_source_and_normalized_hash_block_upload(self):
        self.fit.write_bytes(encoded_fit([session(total_distance=1)]))
        self.assertEqual(self.upload().failed, 1)
        self.assertEqual(self.state()['files']['101.fit']['error_code'], 'source_changed')
        self.parse()
        (self.data / 'normalized/101.json').write_text('{}')
        self.assertEqual(self.upload().failed, 1)
        self.assertEqual(self.state()['files']['101.fit']['error_code'], 'normalized_changed')
        self.assertEqual(self.store.rows, {})

    def test_matching_forged_hash_cannot_inject_owner_or_altered_metrics(self):
        output = self.data / 'normalized/101.json'
        value = json.loads(output.read_text())
        value['user_id'] = 'attacker'
        value['distance_meters'] = 99999
        output.write_text(json.dumps(value))
        _, manifest = self.manifest()
        manifest['files']['101.fit']['normalized_sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
        self.write_manifest(manifest)
        self.assertEqual(self.upload().failed, 1)
        self.assertEqual(self.state()['files']['101.fit']['error_code'], 'reparse_required')
        self.assertEqual(self.store.rows, {})

    def test_invalid_paths_ids_and_symlinks_are_rejected(self):
        _, original = self.manifest()
        for change in ({'normalized_file': '../escape.json'}, {'activity_id': '../101'}, {'activity_id': '001'}):
            manifest = json.loads(json.dumps(original))
            manifest['files']['101.fit'].update(change)
            self.write_manifest(manifest)
            self.assertEqual(self.upload().failed, 1)
        self.write_manifest(original)
        output = self.data / 'normalized/101.json'
        output.unlink()
        output.symlink_to(self.fit)
        self.assertEqual(self.upload().failed, 1)
        self.assertEqual(self.store.rows, {})

    def test_row_projection_preserves_units_nulls_and_uses_only_fixed_owner(self):
        manifest, _ = read_manifest(self.data)
        entry = manifest['files']['101.fit']
        doc = verified_document(self.data, '101.fit', entry, LA)
        row = activity_row(doc, OWNER, entry['normalized_sha256'])
        self.assertEqual(row['user_id'], OWNER)
        self.assertEqual(row['duration_seconds'], 1800)
        self.assertEqual(row['elapsed_time_seconds'], 2000)
        self.assertIsNone(row['moving_time_seconds'])
        self.assertEqual(row['average_cadence_steps_per_minute'], 171)
        self.assertEqual(row['average_heart_rate'], 145)
        for key in ('raw_payload', 'started_at_local', 'id', 'created_at', 'training_week_starts_on'):
            self.assertNotIn(key, row)

    def test_shared_lock_prevents_upload_or_authentication(self):
        with (self.data / '.sync.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(ParsingBusyError):
                self.upload()
        self.assertEqual(self.store.verifications, 0)

    def test_interruption_and_lost_checkpoint_recover_without_duplicates(self):
        with patch.object(self.store, 'save', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.upload()
        self.assertEqual(self.state()['files']['101.fit']['status'], 'pending')
        self.upload()
        (self.data / 'upload-state.json').write_text('lost report')
        self.assertEqual(self.upload().unchanged, 1)
        self.assertEqual(len(self.store.rows), 1)

    def test_local_files_are_not_modified_and_report_is_private(self):
        paths = [self.fit, self.data / 'normalized/101.json', self.data / 'parse-state.json']
        before = [(p.read_bytes(), p.stat().st_mtime_ns) for p in paths]
        self.upload()
        self.assertEqual(before, [(p.read_bytes(), p.stat().st_mtime_ns) for p in paths])
        self.assertEqual((self.data / 'upload-state.json').stat().st_mode & 0o777, 0o600)

    def test_cli_dry_run_works_without_cloud_credentials(self):
        with patch('sys.argv', ['traini-upload', '--data-dir', str(self.data), '--dry-run']), \
             patch.dict('os.environ', {}, clear=True), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 0)


class StoreTests(unittest.TestCase):
    def response(self, status=200, data=None):
        return SimpleNamespace(status_code=status, json=lambda: data)

    def test_configuration_pins_project_https_and_canonical_owner(self):
        for url in ('http://kmmutfcgshellvjgpick.supabase.co', 'https://other.supabase.co', BASE + '/bad', BASE + '?key=secret'):
            with self.assertRaisesRegex(UploadError, 'invalid_configuration'):
                SupabaseActivityStore(url, 'secret', OWNER)
        with self.assertRaisesRegex(UploadError, 'invalid_configuration'):
            SupabaseActivityStore(BASE, 'secret', 'attacker')

    def test_owner_profile_verified_and_never_implicitly_created(self):
        with patch('requests.Session') as factory:
            client = factory.return_value
            client.request.side_effect = [self.response(data={'id': OWNER}), self.response(data=[{'id': OWNER}])]
            store = SupabaseActivityStore(BASE, 'private-key', OWNER)
            store.verify_owner()
            self.assertEqual(client.request.call_count, 2)
            self.assertTrue(all(call.args[0] == 'GET' for call in client.request.call_args_list))
            client.request.side_effect = [self.response(data={'id': OWNER}), self.response(data=[])]
            with self.assertRaisesRegex(UploadError, 'profile_missing'):
                store.verify_owner()

    def test_transient_failure_retries_without_following_redirects(self):
        with patch('requests.Session') as factory, patch('traini_collector.upload.time.sleep'):
            factory.return_value.request.side_effect = [requests.ConnectionError('secret'), self.response(503), self.response(data='inserted')]
            store = SupabaseActivityStore(BASE, 'secret', OWNER)
            self.assertEqual(store.save({'user_id': OWNER}), 'inserted')
            self.assertEqual(factory.return_value.request.call_count, 3)
            for call in factory.return_value.request.call_args_list:
                self.assertFalse(call.kwargs['allow_redirects'])
                self.assertEqual(call.kwargs['timeout'], (5, 30))

    def test_auth_schema_validation_and_redirect_failures_are_sanitized(self):
        for status, code in ((401, 'access_denied'), (403, 'access_denied'), (404, 'schema_not_ready'),
                             (400, 'database_rejected'), (302, 'database_rejected')):
            with patch('requests.Session') as factory:
                factory.return_value.request.return_value = self.response(status, {'message': 'private-key'})
                store = SupabaseActivityStore(BASE, 'private-key', OWNER)
                with self.assertRaisesRegex(UploadError, code) as error:
                    store.save({'user_id': OWNER})
                self.assertNotIn('private-key', str(error.exception))
                self.assertEqual(factory.return_value.request.call_count, 1)

    def test_owner_mismatch_never_sends_and_invalid_outcomes_rejected(self):
        with patch('requests.Session') as factory:
            store = SupabaseActivityStore(BASE, 'secret', OWNER)
            with self.assertRaisesRegex(UploadError, 'owner_mismatch'):
                store.save({'user_id': 'attacker'})
            factory.return_value.request.assert_not_called()
            for invalid in ('unknown', [], {}, None):
                factory.return_value.request.return_value = self.response(data=invalid)
                with self.assertRaisesRegex(UploadError, 'invalid_response'):
                    store.save({'user_id': OWNER})

    def test_retries_are_bounded_on_permanent_connection_failure(self):
        with patch('requests.Session') as factory, patch('traini_collector.upload.time.sleep'):
            factory.return_value.request.side_effect = requests.ConnectionError('private diagnostic')
            store = SupabaseActivityStore(BASE, 'secret', OWNER)
            with self.assertRaisesRegex(UploadError, 'connection_failed'):
                store.save({'user_id': OWNER})
            self.assertEqual(factory.return_value.request.call_count, 3)
