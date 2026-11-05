"""Private Garmin/coaching backups. All mutations run under the collector lock."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOME_DATA = Path.home() / "Projects/Traini-data"
MEMBER = re.compile(r"(?:activities/[1-9][0-9]*\.fit|normalized/[1-9][0-9]*\.json)")
ARCHIVE = re.compile(r"traini-v1-\d{8}T\d{12}Z-[0-9a-f]{8}\.zip")
MAX_FILE = 64 * 1024 * 1024
MAX_DB = 192 * 1024 * 1024
MAX_TOTAL = 4 * 1024 ** 3
DAY = 86400
HASH = re.compile(r"[a-f0-9]{64}")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(path):
    path = path.expanduser().absolute()
    if any(p.is_symlink() for p in (path, *path.parents)) or '..' in path.parts:
        raise ValueError("Unsafe filesystem path")
    return path


def private_target(path):
    path = safe_path(path)
    if path == ROOT or ROOT in path.parents or (path / '.git').exists() or any((p / '.git').exists() for p in path.parents):
        raise ValueError("Private data must stay outside Git")
    return path


def regular(path, limit):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    with os.fdopen(os.open(path, flags), 'rb') as f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_size > limit:
            raise ValueError("Unexpected file type or size")
        data = f.read(limit + 1)
        if len(data) != st.st_size:
            raise ValueError("File changed while reading")
        return data


@contextlib.contextmanager
def exclusive(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'rb+') as lock:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("Unsafe lock")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def database(action, data=None, output=None):
    args = ['node', '--env-file-if-exists=.env.local', 'scripts/maintenance/database.mjs', action]
    if output is not None:
        args.append(str(output))
    result = subprocess.run(args, cwd=ROOT, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=240)
    if result.returncode or len(result.stdout) > MAX_DB:
        raise ValueError("Database capture/restore failed; check CLI login, owner and schema")
    return result.stdout


def limits(args):
    if not (1 <= args.fit_days <= 36500 and 1 <= args.normalized_days <= 36500 and
            1 <= args.temp_days <= 365 and 30 <= args.request_days <= 3650 and 2 <= args.keep <= 30):
        raise ValueError("Invalid retention policy")


def inventory(data, now, args):
    files, candidates, temporary = {}, set(), []
    for folder, days in [('activities', args.fit_days), ('normalized', args.normalized_days), ('', args.temp_days)]:
        directory = safe_path(data / folder)
        if not directory.is_dir():
            raise ValueError("Collector directory is incomplete")
        for path in directory.iterdir():
            name = path.relative_to(data).as_posix()
            st = path.lstat()
            if MEMBER.fullmatch(name):
                if not stat.S_ISREG(st.st_mode):
                    raise ValueError("Unsafe collector file")
                files[name] = path
                if now - st.st_mtime >= days * DAY:
                    candidates.add(name)
            elif re.fullmatch(r'\.traini-[a-zA-Z0-9_-]{8}', path.name) and stat.S_ISREG(st.st_mode):
                if now - st.st_mtime >= args.temp_days * DAY:
                    temporary.append(path)
    manifest = data / 'parse-state.json'
    if manifest.exists() or manifest.is_symlink():
        entries = json.loads(regular(manifest, MAX_FILE))['files']
        for name in entries:
            # The standalone uploader may retry the last parse without reparsing.
            candidates.discard('activities/' + name)
            candidates.discard('normalized/' + Path(name).stem + '.json')
    return files, candidates, temporary


def inspect_archive(z):
    entries = z.infolist()
    names = {i.filename for i in entries}
    if len(names) != len(entries) or not {'manifest.json','database.json'} <= names or sum(i.file_size for i in entries) > MAX_TOTAL:
        raise ValueError("Invalid archive inventory")
    for item in entries:
        if item.filename not in ('manifest.json','database.json') and not MEMBER.fullmatch(item.filename):
            raise ValueError("Unexpected archive member")
        if item.file_size > (MAX_DB if item.filename == 'database.json' else MAX_FILE):
            raise ValueError("Archive member too large")
    manifest = json.loads(z.read('manifest.json'))
    if manifest.get('version') != 1 or set(manifest['sha256']) != names - {'manifest.json'}:
        raise ValueError("Incomplete archive manifest")
    for name, expected in manifest['sha256'].items():
        if not HASH.fullmatch(expected) or digest(z.read(name)) != expected:
            raise ValueError("Archive checksum mismatch")
    return manifest


def archive_name(now):
    return now.strftime('traini-v1-%Y%m%dT%H%M%S%fZ-') + uuid.uuid4().hex[:8] + '.zip'


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def uploaded_files(files, candidates, snapshot):
    activities = {str(row['garmin_activity_id']): row for row in json.loads(snapshot['tables']['activities'])}
    matches = {}
    for name in candidates:
        path = files[name]
        key = 'source_sha256' if name.startswith('activities/') else 'normalized_sha256'
        value = digest(regular(path, MAX_FILE))
        if activities.get(path.stem, {}).get(key) == value:
            matches[name] = value
    return matches


def maintain(args, capture=database, verify=database, now=None):
    limits(args)
    now = now or datetime.now(timezone.utc)
    data, store = private_target(args.data), private_target(args.store)
    if data == store or data in store.parents or store in data.parents or not data.is_dir():
        raise ValueError("Choose separate data and backup directories")
    if args.action == 'preview':
        files, eligible, temporary = inventory(data, now.timestamp(), args)
        snapshot = capture('capture')
        db = json.loads(snapshot)
        matching = uploaded_files(files, eligible, db)
        archives = [p for p in store.iterdir() if ARCHIVE.fullmatch(p.name)] if store.exists() else []
        db_eligible = int(capture('preview-failed', snapshot, args.request_days)) if args.prune_failed else None
        return dict(failed_requests_eligible=db_eligible, files=len(files), age_eligible=len(eligible),
                    uploaded_files_eligible=len(matching), expired_temp=len(temporary),
                    eligible_bytes=sum(files[name].stat().st_size for name in matching),
                    archives=len(archives), would_rotate=max(0,len(archives)+1-args.keep))
    store.mkdir(mode=0o700, parents=True, exist_ok=True)
    if store.stat().st_mode & 0o077:
        raise ValueError("Backup directory must be private (0700)")
    with exclusive(store / '.maintenance.lock'), exclusive(data / '.sync.lock'), contextlib.ExitStack() as resources:
        files, candidates, temporary = inventory(data, now.timestamp(), args)
        prior = sorted(p for p in store.iterdir() if ARCHIVE.fullmatch(p.name))
        next_name = archive_name(now)
        if prior and prior[-1].name[:32] >= next_name[:32]:
            raise ValueError("Backup clock must advance before rotation")
        previous = None
        if prior:
            previous = resources.enter_context(zipfile.ZipFile(safe_path(prior[-1])))
            inspect_archive(previous)
        snapshot = capture('capture')
        db = json.loads(snapshot)
        if previous and json.loads(previous.read('database.json'))['owner'] != db['owner']:
            raise ValueError("Previous archive belongs to a different owner")
        archived = set(previous.namelist()) - {'database.json','manifest.json'} if previous else set()
        with tempfile.NamedTemporaryFile(dir=store, prefix='.building-', suffix='.zip') as temp:
            hashes = {'database.json': digest(snapshot)}
            with zipfile.ZipFile(temp, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=3) as z:
                for name in sorted(set(files) | archived):
                    contents = regular(files[name], MAX_FILE) if name in files else previous.read(name)
                    # A replaced original must not silently overwrite the only archival copy.
                    if name.startswith('activities/') and name in archived and digest(contents) != digest(previous.read(name)):
                        raise ValueError("Original FIT differs from retained archive")
                    z.writestr(name, contents)
                    hashes[name] = digest(contents)
                z.writestr('database.json', snapshot)
                z.writestr('manifest.json', json.dumps({'version':1, 'created':now.isoformat(), 'sha256':hashes}))
            temp.flush()
            os.fsync(temp.fileno())
            with zipfile.ZipFile(temp.name) as z:
                inspect_archive(z)
                verify('verify', z.read('database.json'))
            destination = store / next_name
            # Publish with no overwrite only after both verification stages.
            os.link(temp.name, destination)
            fsync_dir(store)
        removed = rotated = failed_requests = 0
        if args.action == 'maintain':
            if args.prune_failed:
                failed_requests = int(capture('prune-failed', snapshot, args.request_days))
            for name, value in uploaded_files(files, candidates, db).items():
                if hashes[name] == value:
                    files[name].unlink()
                    removed += 1
            # A killed writer may leave private staging archives. Only this
            # tool's names, while holding its lock and after a verified backup.
            for path in store.iterdir():
                if re.fullmatch(r'\.building-[a-zA-Z0-9_-]{8}\.zip', path.name) and path.is_file() and not path.is_symlink() and now.timestamp()-path.stat().st_mtime >= args.temp_days*DAY:
                    temporary.append(path)
            for path in temporary:
                path.unlink()
                removed += 1
            for old in prior[:max(0,len(prior)+1-args.keep)]:
                safe_path(old).unlink()
                rotated += 1
            fsync_dir(store)
        return dict(verified=True, archive=destination.name, files=len(hashes)-1, removed=removed, rotated=rotated, failed_requests_removed=failed_requests)


def recover(archive, target=None, verifier=database):
    archive = safe_path(archive)
    with zipfile.ZipFile(archive) as z:
        inspect_archive(z)
        snapshot = z.read('database.json')
        if target is None:
            verifier('verify', snapshot)
            return dict(verified=True)
        target = private_target(target)
        if target.exists() or not target.parent.is_dir():
            raise ValueError("Restore destination must be new, with an existing parent")
        with tempfile.TemporaryDirectory(dir=target.parent) as staging:
            restored = Path(staging) / 'restored'
            restored.mkdir(mode=0o700)
            verifier('verify', snapshot, restored / 'coaching.sql')
            for name in z.namelist():
                if MEMBER.fullmatch(name):
                    path = restored / 'garmin' / name
                    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    path.write_bytes(z.read(name))
            # Reserve a new destination exclusively; refuse even an empty existing directory.
            target.mkdir(mode=0o700)
            try:
                os.replace(restored, target)
            except BaseException:
                target.rmdir()
                raise
        return dict(restored=True)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['preview','backup','maintain','verify','restore'])
    p.add_argument('--data',type=Path,default=HOME_DATA/'garmin')
    p.add_argument('--store',type=Path,default=HOME_DATA/'backups')
    p.add_argument('--archive',type=Path)
    p.add_argument('--to',type=Path)
    p.add_argument('--prune-failed',action='store_true',help='Include expired, unreferenced failed generation requests in maintain or preview')
    p.add_argument('--request-days',type=int,default=90)
    for name,default in [('fit-days',180),('normalized-days',90),('temp-days',7),('keep',3)]:
        p.add_argument('--'+name,type=int,default=default)
    return p


if __name__ == '__main__':
    os.umask(0o077)
    args = parser().parse_args()
    try:
        if args.action in ('verify','restore'):
            if not args.archive or (args.action=='restore' and not args.to):
                raise ValueError("Supply --archive and, for restore, --to")
            result = recover(args.archive, args.to if args.action=='restore' else None)
        else:
            result = maintain(args)
        print(json.dumps(result))
    except BlockingIOError:
        sys.exit('Collector or maintenance in progress; no cleanup performed.')
    except (OSError, ValueError, KeyError, RuntimeError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        sys.exit('Maintenance failed: '+ (str(error) if type(error) is ValueError else type(error).__name__))
