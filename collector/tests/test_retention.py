import json
import os
import plistlib
import sys
import tempfile
import unittest
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/maintenance'))
import retention
import schedule


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.data = self.base / 'garmin'
        self.store = self.base / 'backups'
        for folder in ('activities','normalized'):
            (self.data/folder).mkdir(parents=True)
        self.now = datetime.now(timezone.utc)
        self.args = retention.parser().parse_args(['maintain','--data',str(self.data),'--store',str(self.store),'--keep','2'])
        self.files = {'activities/123.fit':b'fixture FIT','normalized/123.json':b'{"test": true}'}
        for name, content in self.files.items():
            p=self.data/name
            p.write_bytes(content)
            os.utime(p,(0,0))
        self.snapshot = json.dumps({'owner':'test','tables':{'activities': json.dumps([{
            'garmin_activity_id':'123','source_sha256':retention.digest(self.files['activities/123.fit']),
            'normalized_sha256':retention.digest(self.files['normalized/123.json'])}])}}).encode()

    def run_job(self, days=0, verify=None):
        return retention.maintain(self.args, lambda *_:self.snapshot, verify or self.verify, self.now+timedelta(days=days))

    def verify(self, mode, data, output=None):
        self.assertEqual(mode,'verify')
        self.assertEqual(data,self.snapshot)
        if output:
            output.write_text('verified fixture')

    def test_rotation_carries_offloaded_originals_and_restore_refuses_overwrite(self):
        self.assertEqual(self.run_job()['removed'],2)
        self.run_job(1)
        r=self.run_job(2)
        self.assertEqual(r['rotated'],1)
        archives=sorted(self.store.glob('*.zip'))
        self.assertEqual(len(archives),2)
        target=self.base/'restored'
        retention.recover(archives[-1],target,self.verify)
        for name,data in self.files.items():
            self.assertEqual((target/'garmin'/name).read_bytes(),data)
        with self.assertRaises(ValueError):
            retention.recover(archives[-1],target,self.verify)

    def test_failed_capture_or_restore_never_publishes_or_removes(self):
        def fail(*_):
            raise ValueError('fixture failure')
        for capture,verify in [(fail,self.verify),(lambda *_:self.snapshot,fail)]:
            with self.assertRaises(ValueError):
                retention.maintain(self.args,capture,verify,self.now)
        self.assertTrue(all((self.data/n).exists() for n in self.files))
        self.assertEqual(list(self.store.glob('*.zip')),[])

    def test_lock_and_preview(self):
        self.args.action='preview'
        self.assertEqual(self.run_job()['age_eligible'],2)
        self.assertFalse(self.store.exists())
        self.args.action='maintain'
        with retention.exclusive(self.data/'.sync.lock'), self.assertRaises(BlockingIOError):
            self.run_job()
        self.assertTrue((self.data/'activities/123.fit').exists())

    def test_hashes_manifest_credentials_and_temp_age(self):
        (self.data/'activities/123.fit').write_bytes(b'changed')
        os.utime(self.data/'activities/123.fit',(0,0))
        (self.data/'parse-state.json').write_text('{"files":{"123.fit":{}}}')
        secret=self.data/'garmin_tokens.json'
        secret.write_text('dummy')
        stale=self.data/'normalized/.traini-aB12cD34'
        stale.touch()
        os.utime(stale,(0,0))
        self.assertEqual(self.run_job()['removed'],1)
        self.assertTrue(secret.exists())
        with zipfile.ZipFile(next(self.store.glob('*.zip'))) as z:
            self.assertNotIn(secret.name,z.namelist())
        (self.data/'parse-state.json').unlink()
        self.assertEqual(self.run_job(1)['removed'],1)
        self.assertTrue((self.data/'activities/123.fit').exists())

    def test_corrupt_archive_and_symlinks_fail_closed(self):
        self.args.action='backup'
        r=self.run_job()
        (self.store/r['archive']).write_bytes(b'broken')
        self.args.action='maintain'
        with self.assertRaises(zipfile.BadZipFile):
            self.run_job(1)
        (self.store/r['archive']).unlink()
        p=self.data/'activities/123.fit'
        p.unlink()
        p.symlink_to(self.data/'normalized/123.json')
        with self.assertRaises(ValueError):
            self.run_job()

    def test_boundary_and_unknown_files(self):
        for key, days in [('activities/123.fit',180),('normalized/123.json',90)]:
            seconds=self.now.timestamp()-days*86400+1
            os.utime(self.data/key,(seconds,seconds))
        extra=self.data/'activities/notes.txt'
        extra.touch()
        self.assertEqual(self.run_job()['removed'],0)
        self.assertEqual(self.run_job(1)['removed'],2)
        self.assertTrue(extra.exists())

    def test_path_traversal_and_failed_restore_leave_no_destination(self):
        self.args.action='backup'
        r=self.run_job()
        archive=self.store/r['archive']
        with zipfile.ZipFile(archive,'a') as z:
            z.writestr('../outside','bad')
        with self.assertRaises(ValueError):
            retention.recover(archive,self.base/'new',self.verify)
        self.assertFalse((self.base/'new').exists())
        self.assertFalse((self.base/'outside').exists())

    def test_launch_agent_is_local_and_weekly(self):
        from unittest.mock import patch
        with patch('shutil.which',return_value='/usr/bin/tool'):
            spec=schedule.definition(3,1,['--keep','2'])
        self.assertEqual(plistlib.loads(plistlib.dumps(spec))['StartCalendarInterval'],{'Weekday':1,'Hour':3,'Minute':0})
        self.assertIn('run',spec['ProgramArguments'])
        self.assertEqual(set(spec['EnvironmentVariables']),{'PATH'})
