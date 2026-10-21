import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages'))
from dark_server.worker import ScriptWorker,WorkerRefused


class WorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.worker=ScriptWorker()

    def test_real_javascript_computes_only_proposals_deterministically(self):
        source="const x=observation.actor.stance; return [{operation:x==='sitting'?'stand':'sit',arguments:{}}];"
        before={'actor':{'stance':'standing'}}
        a=self.worker.run(source,before);b=self.worker.run(source,before)
        self.assertEqual(a['proposals'],[{'operation':'sit','arguments':{}}])
        self.assertEqual(a['program_digest'],b['program_digest'])
        self.assertEqual(before,{'actor':{'stance':'standing'}})
        self.assertFalse(a['authority_granted'])

    def test_no_host_file_network_process_or_nondeterministic_globals(self):
        for source in ["return std.loadFile('/dev/null');", "return os.exec(['true']);", "return fetch('https://example.com');",
                       "return require('fs');", "return Date.now();", "return Math.random();", "return import('std');"]:
            with self.subTest(source=source):
                with self.assertRaises(WorkerRefused):self.worker.run(source,{})

    def test_fuel_time_memory_stack_input_output_budgets(self):
        for source in ['while(true){}',"return new ArrayBuffer(1000000000);",'function f(){return f();}return f();',
                       "return [{operation:'author',arguments:{text:'x'.repeat(1000000)}}];",'x'*20000]:
            with self.subTest(source=source[:40]):
                with self.assertRaises(WorkerRefused):self.worker.run(source,{})

    def test_program_cannot_make_itself_founder_or_submit_host_commands(self):
        for source in ["return [{operation:'set_role',arguments:{role:'founder_dark'}}];",
                       "return [{operation:'exec',arguments:{command:'true'}}];",
                       "return [{operation:'sit',arguments:{},authority:'founder_dark'}];"]:
            with self.assertRaises(WorkerRefused):self.worker.run(source,{})

    def test_operating_system_filter_denies_open_socket_exec(self):
        result=subprocess.run([str(self.worker.binary),'--probe-syscalls'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=2)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        self.assertEqual(json.loads(result.stdout),{'open_blocked':True,'socket_blocked':True,'exec_blocked':True})


if __name__=='__main__':unittest.main()
