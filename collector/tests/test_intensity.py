import json
import unittest
from datetime import timedelta
from garmin_fit_sdk import Encoder, Profile
from traini_collector.intensity import normalize_intensity, decode_intensity
from test_fit import START, session


class IntensityTests(unittest.TestCase):
    def test_laps_have_explicit_units_and_no_private_fields(self):
        m={'session_mesgs':[session(total_distance=800,total_training_effect=3.2,total_anaerobic_training_effect=2.4)],
           'lap_mesgs':[{'start_time':START,'total_elapsed_time':190,'total_timer_time':190,'total_distance':800,
                         'avg_heart_rate':170,'intensity':'active','start_position_lat':123,'device_serial_number':123}]}
        d=normalize_intensity(m)
        self.assertEqual(d['laps'][0]['paceSecondsPerKm'],237.5)
        self.assertTrue(d['lapsComplete'])
        self.assertEqual(d['anaerobicTrainingEffect'],2.4)
        self.assertNotIn('position',json.dumps(d))
        self.assertNotIn('serial',json.dumps(d))

    def test_generic_interval_label_is_not_reclassified_as_hard_training(self):
        d=normalize_intensity({'session_mesgs':[session(total_distance=1000)],'lap_mesgs':[{'total_distance':1000,'total_timer_time':330,'intensity':'interval'}]})
        self.assertEqual(d['laps'][0]['intensity'],'interval')
        self.assertNotIn('hard',d)

    def test_missing_invalid_overlapping_and_truncated_laps_are_explicit(self):
        d=normalize_intensity({'session_mesgs':[session()], 'lap_mesgs':[]})
        self.assertFalse(d['lapsComplete'])
        self.assertIsNone(d['aerobicTrainingEffect'])
        laps=[{'start_time':START,'total_elapsed_time':100,'total_distance':400,'total_timer_time':-1,'avg_heart_rate':float('nan')}]*161
        d=normalize_intensity({'session_mesgs':[session(total_distance=100000)],'lap_mesgs':laps})
        self.assertEqual(len(d['laps']),160)
        self.assertFalse(d['lapsComplete'])
        self.assertIn('overlapping_laps',d['warnings'])
        self.assertIn('laps_truncated',d['warnings'])
        self.assertIsNone(d['laps'][0]['timerSeconds'])
        self.assertIsNone(d['laps'][0]['averageHeartRate'])

    def test_real_sdk_decodes_work_and_recovery_without_exporting_records(self):
        encoder=Encoder()
        encoder.on_mesg(Profile['mesg_num']['FILE_ID'],{'type':'activity','manufacturer':'development','product':1,'time_created':START})
        encoder.on_mesg(Profile['mesg_num']['SESSION'],session(total_distance=600,total_timer_time=180))
        for i,(distance,timer,intensity) in enumerate([(400,92,'active'),(200,88,'rest')]):
            encoder.on_mesg(Profile['mesg_num']['LAP'],{'start_time':START+timedelta(seconds=i*100),'timestamp':START+timedelta(seconds=i*100+timer),'total_elapsed_time':timer,'total_timer_time':timer,'total_distance':distance,'intensity':intensity})
        d=decode_intensity(bytes(encoder.close()))
        self.assertEqual(d['lapCount'],2)
        self.assertEqual(d['laps'][0]['paceSecondsPerKm'],230)
        self.assertEqual(d['laps'][1]['intensity'],'rest')

    def test_short_forward_transition_tolerance_does_not_hide_real_overlap(self):
        def run(distance=7, duration=2.8, kind='warmup', next_start=1):
            return normalize_intensity({'session_mesgs':[session(total_distance=distance+400)], 'lap_mesgs':[
                {'start_time':START,'total_elapsed_time':duration,'total_timer_time':duration,'total_distance':distance,'intensity':kind},
                {'start_time':START+timedelta(seconds=next_start),'total_elapsed_time':92,'total_timer_time':92,'total_distance':400,'intensity':'active'}]})
        self.assertTrue(run()['lapsComplete'])
        self.assertIn('transition_time_tolerance',run()['warnings'])
        for kwargs in [{'distance':400},{'duration':4},{'kind':'active'},{'next_start':0}]:
            self.assertFalse(run(**kwargs)['lapsComplete'])
            self.assertIn('overlapping_laps',run(**kwargs)['warnings'])

    def test_missing_timestamps_gaps_and_work_pauses_are_not_continuous_evidence(self):
        base={'start_time':START,'total_elapsed_time':300,'total_timer_time':300,'total_distance':1000,'intensity':'active'}
        for changed in [{**base,'start_time':None},{**base,'total_elapsed_time':340}]:
            self.assertFalse(normalize_intensity({'session_mesgs':[session(total_distance=1000)],'lap_mesgs':[changed]})['lapsComplete'])
        d=normalize_intensity({'session_mesgs':[session(total_distance=2000)],'lap_mesgs':[base,{**base,'start_time':START+timedelta(seconds=330)}]})
        self.assertIn('lap_time_gap',d['warnings'])
        self.assertFalse(d['lapsComplete'])

    def test_recovery_pause_does_not_erase_measured_work_but_remains_explicit(self):
        lap={'start_time':START,'total_elapsed_time':180,'total_timer_time':80,'total_distance':200,'intensity':'rest'}
        d=normalize_intensity({'session_mesgs':[session(total_distance=200)],'lap_mesgs':[lap]})
        self.assertTrue(d['lapsComplete'])
        self.assertIn('paused_non_work_lap',d['warnings'])
        self.assertEqual(d['laps'][0]['timerSeconds'],80)
