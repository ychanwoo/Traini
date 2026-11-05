"""Install or inspect the personal macOS maintenance schedule."""
import argparse
import datetime
import json
import os
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from retention import HOME_DATA, ROOT, private_target

LABEL = 'dev.traini.coaching-maintenance'
PLIST = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')


def definition(hour, weekday, options):
    node = shutil.which('node')
    npx = shutil.which('npx')
    if not node or not npx:
        raise ValueError('Node and npx are required')
    return {
        'Label': LABEL,
        'WorkingDirectory': str(ROOT),
        'ProgramArguments': [sys.executable, str(Path(__file__).resolve()), 'run', *options],
        'EnvironmentVariables': {'PATH': os.pathsep.join(dict.fromkeys([str(Path(node).parent),str(Path(npx).parent),'/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin']))},
        'StartCalendarInterval': {'Weekday':weekday,'Hour':hour,'Minute':0},
        'ProcessType':'Background',
    }


def run_job(options):
    # Keep the most recent 32 aggregate outcomes in one private file.
    cmd = [sys.executable, str(ROOT/'scripts/maintenance/retention.py'), 'maintain', *options]
    result = subprocess.run(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    record = {'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':result.returncode}
    if result.returncode == 0:
        record['result'] = json.loads(result.stdout)
    else:
        record['reason'] = 'busy' if 'in progress' in result.stderr else 'maintenance_failed'
    directory = private_target(HOME_DATA / 'maintenance')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = private_target(directory/'runs.json')
    history = json.loads(path.read_text()) if path.exists() else []
    with tempfile.NamedTemporaryFile('w',dir=directory,delete=False) as f:
        json.dump([*history[-31:],record], f)
        temp = f.name
    os.replace(temp,path)
    return result.returncode


def main():
    os.umask(0o077)
    if sys.argv[1:2] == ['run']:
        return run_job(sys.argv[2:])
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['install','uninstall','status','preview'])
    parser.add_argument('--weekday',type=int,choices=range(7),default=1)
    parser.add_argument('--hour',type=int,choices=range(24),default=3)
    parser.add_argument('--prune-failed',action='store_true')
    parser.add_argument('--fit-days',type=int,choices=range(1,36501),metavar='DAYS',default=180)
    parser.add_argument('--normalized-days',type=int,choices=range(1,36501),metavar='DAYS',default=90)
    parser.add_argument('--temp-days',type=int,choices=range(1,366),metavar='DAYS',default=7)
    parser.add_argument('--keep',type=int,choices=range(2,31),metavar='COUNT',default=3)
    parser.add_argument('--request-days', type=int,choices=range(30,3651),metavar='DAYS',default=90)
    args=parser.parse_args()
    options=[]
    for key in ('fit_days','normalized_days','temp_days','keep','request_days'):
        options.extend(['--'+key.replace('_','-'),str(getattr(args,key))])
    if args.prune_failed:
        options.append('--prune-failed')
    spec=definition(args.hour,args.weekday,options)
    if args.action=='preview':
        print(plistlib.dumps(spec).decode())
        return 0
    if platform.system()!='Darwin':
        parser.error('launchd is available on macOS')
    domain='gui/'+str(os.getuid())
    service=domain+'/'+LABEL
    if args.action=='status':
        active=subprocess.run(['launchctl','print',service],capture_output=True).returncode==0
        print('Scheduled' if active else 'Inactive')
        return 0
    if PLIST.is_symlink():
        raise ValueError('Unsafe LaunchAgent path')
    if args.action=='uninstall':
        if PLIST.exists():
            if subprocess.run(['launchctl','print',service],capture_output=True).returncode==0:
                subprocess.run(['launchctl','bootout',service],check=True)
            PLIST.unlink()
        return 0
    PLIST.parent.mkdir(parents=True,exist_ok=True)
    with PLIST.open('xb') as f:
        plistlib.dump(spec,f)
    try:
        subprocess.run(['launchctl','bootstrap',domain,str(PLIST)],check=True)
    except BaseException:
        PLIST.unlink()
        raise
    print('Weekly maintenance scheduled in local time.')
    return 0


if __name__=='__main__':
    sys.exit(main())
