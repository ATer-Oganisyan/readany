import tempfile
import unittest
import zipfile
from pathlib import Path
from clean_epub import clean_epub, parse, external, member_path

ROOT = Path(__file__).resolve().parents[2]

class BundledCatalogTests(unittest.TestCase):
    def test_every_shipped_book_has_valid_xml_no_external_links_and_stable_cleanup(self):
        books = sorted((ROOT/'packages/app-expo/assets/catalog').glob('*.epub'))
        self.assertEqual(len(books), 17)
        with tempfile.TemporaryDirectory() as tmp:
            for book in books:
                with self.subTest(book=book.name), zipfile.ZipFile(book) as archive:
                    for name in archive.namelist():
                        if name.lower().endswith(('.xml', '.opf', '.ncx', '.xhtml')):
                            doc = parse(archive.read(name))
                            self.assertFalse(any(external(href) for href in doc.xpath('//*[local-name()="a"]/@href')), name)
                    container = parse(archive.read('META-INF/container.xml'))
                    opf_name = container.xpath('//*[local-name()="rootfile"]/@full-path')[0]
                    opf = parse(archive.read(opf_name))
                    manifest = {el.get('id'): member_path(opf_name, el.get('href')) for el in opf.xpath('//*[local-name()="manifest"]/*')}
                    refs = opf.xpath('//*[local-name()="spine"]/*')
                    self.assertTrue(refs)
                    for ref in refs: self.assertIn(manifest[ref.get('idref')], archive.namelist())
                    target = Path(tmp)/book.name
                    clean_epub(book, target)
                    self.assertEqual(book.read_bytes(), target.read_bytes(), 'second cleanup must be byte-identical')
