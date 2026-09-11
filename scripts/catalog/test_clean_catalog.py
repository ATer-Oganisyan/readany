import json
import tempfile
import unittest
from pathlib import Path
from clean_catalog import clean_catalog, sha256
import test_clean_epub

class CatalogBatchTests(unittest.TestCase):
    def prepare(self, root):
        sources = root/'sources'; sources.mkdir()
        source = sources/'book.epub'; test_clean_epub.CatalogCleanupTests().make_book(source)
        snapshot = root/'snapshot.json'
        snapshot.write_text(json.dumps([{'book_edition_id':'book','catalog_key':'original','title':'Book','author':'Author','language':'en','content_sha256':sha256(source),'genres':['drama'],'cover':{'content_hash':'old-cover'}}]))
        reviews = root/'reviews.json'; reviews.write_text('{}')
        return snapshot, sources, root/'output', reviews

    def test_missing_source_and_stale_review_reject_entire_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=self.prepare(Path(tmp)); snapshot,sources,output,reviews=args
            reviews.write_text(json.dumps({'book':{'source_sha256':'wrong'}}))
            with self.assertRaisesRegex(ValueError, 'different source'): clean_catalog(*args)
            self.assertFalse((output/'manifest.json').exists())
            reviews.write_text('{}'); (sources/'book.epub').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'Missing or changed'): clean_catalog(*args)
            self.assertFalse(output.exists())

    def test_bundle_is_reproducible_and_retains_replacement_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=self.prepare(Path(tmp)); snapshot,sources,output,reviews=args
            summary=clean_catalog(*args)
            self.assertEqual(summary['books'],1)
            first=(output/'books/book.epub').read_bytes()
            manifest=json.loads((output/'manifest.json').read_text())['books'][0]
            self.assertEqual(manifest['replaces']['catalog_key'],'original')
            self.assertEqual(manifest['replaces']['cover']['content_hash'],'old-cover')
            self.assertEqual(manifest['genres'],['drama'])
            self.assertNotEqual(manifest['catalog_key'],'original')
            clean_catalog(*args)
            self.assertEqual(first,(output/'books/book.epub').read_bytes())
