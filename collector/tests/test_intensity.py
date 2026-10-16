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
