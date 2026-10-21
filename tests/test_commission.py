import importlib.util
import tempfile
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('commission', ROOT/'tools/commission.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CommissionTests(unittest.TestCase):
    def test_extracts_primary_and_nested_clauses_without_dropping_constraints(self):
        text = '# Title\n## 00. Costs\n**HD-000.UNITY · Engine.** Unity only.\n\n## 05. Policy\nA rule.\n### §5.1 Compiler\nBounded.\n## 99. Resume\nContinue.\n'
        rows = module.extract(text)
        self.assertEqual([r['id'] for r in rows], ['HD-000', 'HD-000.UNITY', 'HD-005', 'HD-005.1', 'HD-099'])
        self.assertIn('Unity only.', rows[1]['text'])
        self.assertIn('Bounded.', rows[3]['text'])

    def test_digest_mismatch_and_missing_clause_fail_verification(self):
        text = '## 00. Costs\nNo cost.\n## 01. Mandate\nBuild.\n'
        projection = module.project(text)
        module.verify(text, projection)
        with self.assertRaises(ValueError): module.verify(text+'changed', projection)
        projection['requirements'].pop()
        with self.assertRaises(ValueError): module.verify(text, projection)

    def test_modified_source_excerpt_cannot_reuse_digest(self):
        text = '## 00. Costs\nNo cost.\n'
        projection = module.project(text)
        projection['requirements'][0]['text'] = 'Spending allowed.'
        with self.assertRaises(ValueError): module.verify(text, projection)

    def test_new_requirements_start_unrun(self):
        projection = module.project('## 87. Tests\nAll gates.\n')
        row = projection['requirements'][0]
        self.assertEqual(row['observed_result'], 'NOT_RUN')
        self.assertFalse(projection['release_accepted'])

    def test_real_spending_covenant_has_its_explicit_id(self):
        rows = {r['id']: r for r in module.extract(module.SOURCE.read_text(encoding='utf-8'))}
        self.assertIn('Zero new expenditure', rows['HD-000']['text'])
        self.assertIn('No paid assets', rows['HD-000']['text'])
        self.assertNotIn('Zero new expenditure', rows['HD-000.EXCLUDE']['text'])

if __name__ == '__main__': unittest.main()
