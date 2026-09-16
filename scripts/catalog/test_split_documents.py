import tempfile
import unittest
import zipfile
from pathlib import Path
from clean_epub import clean_epub, parse, text, member_path
from split_documents import MAX_DOCUMENT_CHARS, MIN_PART_CHARS, choose_boundaries, extract_part

XHTML = 'http://www.w3.org/1999/xhtml'


def paragraphs(prefix, count, size=400):
    return ''.join(f'<p id="{prefix}-{i}">{prefix} {i} ' + ('слово ' * (size // 6)) + '</p>' for i in range(count))


class SplitDocumentsTests(unittest.TestCase):
    def make_book(self, path, chapters=30, chapter_paragraphs=40):
        body = '<section><div class="text"><h3 id="part1">ЧАСТЬ ПЕРВАЯ</h3>'
        for number in range(1, chapters + 1):
            body += f'<div role="heading" aria-level="3" class="header3" id="ch{number}">{number}.</div>'
            body += paragraphs(f'c{number}', chapter_paragraphs)
            if number == 2:
                body += '<p id="ref">См. <a href="#note1">примечание</a> и <a href="#ch1">первую главу</a>.</p>'
        body += '<h3 id="notes">Примечания</h3><aside id="note1">Текст примечания. <a href="#ref">↑</a></aside></div></section>'
        volume = f'<html xmlns="{XHTML}"><head><title>Том 1</title></head><body>{body}</body></html>'
        files = {
            'mimetype': 'application/epub+zip',
            'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
            'OPS/book.opf': '''<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Книга</dc:title><dc:creator>Автор</dc:creator><dc:language>ru</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/><item id="vol1" href="vol1.xhtml" media-type="application/xhtml+xml"/><item id="vol2" href="vol2.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="title"/><itemref idref="vol1" linear="yes"/><itemref idref="vol2"/></spine></package>''',
            'OPS/title.xhtml': f'<html xmlns="{XHTML}"><head><title>Заглавие</title></head><body><h1>Книга</h1><p>Ссылка на <a href="vol1.xhtml#ch5">пятую главу</a>.</p></body></html>',
            'OPS/vol1.xhtml': volume,
            'OPS/vol2.xhtml': f'<html xmlns="{XHTML}"><head><title>Том 2</title></head><body><h2 id="v2">Том второй</h2>{paragraphs("v2", 5)}</body></html>',
            'OPS/nav.xhtml': f'<html xmlns="{XHTML}" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Оглавление</title></head><body><nav epub:type="toc"><ol><li><a href="title.xhtml">Заглавие</a></li><li><a href="vol1.xhtml">Том 1</a></li><li><a href="vol2.xhtml">Том 2</a></li></ol></nav></body></html>',
            'OPS/toc.ncx': '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:depth" content="1"/></head><docTitle><text>Книга</text></docTitle><navMap><navPoint id="n1" playOrder="1"><navLabel><text>Заглавие</text></navLabel><content src="title.xhtml"/></navPoint><navPoint id="n2" playOrder="2"><navLabel><text>Том 1</text></navLabel><content src="vol1.xhtml"/></navPoint><navPoint id="n3" playOrder="3"><navLabel><text>Том 2</text></navLabel><content src="vol2.xhtml"/></navPoint></navMap></ncx>',
        }
        with zipfile.ZipFile(path, 'w') as z:
            for name, content in files.items(): z.writestr(name, content)
        return volume

    def test_oversized_volume_is_split_into_chapter_parts_with_links_and_toc_redirected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target, again = Path(tmp)/'source.epub', Path(tmp)/'target.epub', Path(tmp)/'again.epub'
            volume = self.make_book(source)
            self.assertGreater(len(text(parse(volume.encode()))), MAX_DOCUMENT_CHARS)
            report = clean_epub(source, target)
            self.assertEqual([s['document'] for s in report['split_documents']], ['OPS/vol1.xhtml'])
            parts = report['split_documents'][0]['parts']
            self.assertGreater(parts, 3)
            with zipfile.ZipFile(target) as z:
                names = z.namelist()
                opf = parse(z.read('OPS/book.opf'))
                manifest = {el.get('id'): member_path('OPS/book.opf', el.get('href')) for el in opf.xpath('//*[local-name()="manifest"]/*')}
                spine = [manifest[ref.get('idref')] for ref in opf.xpath('//*[local-name()="spine"]/*')]
                part_names = [name for name in spine if name.startswith('OPS/vol1')]
                self.assertEqual(len(part_names), parts)
                self.assertEqual(part_names[0], 'OPS/vol1.xhtml', 'first part keeps the original file name')
                self.assertEqual(spine[0], 'OPS/title.xhtml'); self.assertEqual(spine[-1], 'OPS/vol2.xhtml')
                self.assertTrue(all(ref.get('linear') == 'yes' for ref in opf.xpath('//*[local-name()="spine"]/*[starts-with(@idref, "vol1")]')))
                docs = {name: parse(z.read(name)) for name in part_names}
                # Every part is chapter-sized and no text is lost or duplicated.
                for name, doc in docs.items():
                    self.assertLess(len(text(doc)), MAX_DOCUMENT_CHARS, name)
                    self.assertGreaterEqual(len(text(doc)), MIN_PART_CHARS, name)
                    self.assertTrue(doc.xpath('//*[local-name()="section"]/*[local-name()="div"][@class="text"]'), 'ancestor wrappers survive')
                compact = lambda value: ''.join(value.split()).casefold()
                body_text = lambda doc: text(doc.xpath('//*[local-name()="body"]')[0])
                self.assertEqual(compact(''.join(body_text(docs[name]) for name in part_names)), compact(body_text(parse(volume.encode()))))
                self.assertEqual([text(t) for t in docs['OPS/vol1-001.xhtml'].xpath('//*[local-name()="title"]')], ['2.'])
                ids = {}
                for name, doc in docs.items():
                    for value in doc.xpath('//@id'):
                        self.assertNotIn(value, ids, 'ids stay unique across parts'); ids[value] = name
                self.assertEqual(set(ids), set(parse(volume.encode()).xpath('//@id')))
                # Links follow their targets into other parts and back.
                ref_doc = docs[ids['ref']]
                anchors = {text(a): a.get('href') for a in ref_doc.xpath('//*[@id="ref"]/*[local-name()="a"]')}
                self.assertEqual(member_path(ids['ref'], anchors['примечание'].partition('#')[0]), ids['note1'])
                self.assertEqual(member_path(ids['ref'], anchors['первую главу'].partition('#')[0]), ids['ch1'])
                note_link = docs[ids['note1']].xpath('//*[@id="note1"]/*[local-name()="a"]')[0].get('href')
                self.assertEqual(member_path(ids['note1'], note_link.partition('#')[0]), ids['ref'])
                title_link = parse(z.read('OPS/title.xhtml')).xpath('//*[local-name()="a"]')[0].get('href')
                self.assertEqual(member_path('OPS/title.xhtml', title_link.partition('#')[0]), ids['ch5'])
                self.assertTrue(title_link.endswith('#ch5'))
                # The volume entry gains nested chapters pointing into the right parts.
                nav = parse(z.read('OPS/nav.xhtml'))
                volume_li = nav.xpath('//*[local-name()="a"][@href="vol1.xhtml"]')[0].getparent()
                nested = volume_li.xpath('./*[local-name()="ol"]/*[local-name()="li"]/*[local-name()="a"]')
                self.assertEqual([text(a) for a in nested][:3], ['Часть первая', '1.', '2.'])
                for a in nested:
                    fragment = a.get('href').partition('#')[2]
                    self.assertEqual(member_path('OPS/nav.xhtml', a.get('href').partition('#')[0]), ids[fragment])
                self.assertEqual(len(nav.xpath('//*[local-name()="nav"]/*[local-name()="ol"]/*[local-name()="li"]')), 3)
                ncx = parse(z.read('OPS/toc.ncx'))
                self.assertEqual(len(ncx.xpath('//*[@id="n2"]/*[local-name()="navPoint"]')), len(nested))
                self.assertEqual(ncx.xpath('//*[@name="dtb:depth"]/@content'), ['2'])
                orders = [int(p.get('playOrder')) for p in ncx.xpath('//*[local-name()="navPoint"]')]
                self.assertEqual(orders, list(range(1, len(orders) + 1)))
                self.assertIn('OPS/vol2.xhtml', names)
            # Cleaning the split book again changes nothing.
            second = clean_epub(target, again)
            self.assertFalse(second['changed']); self.assertEqual(second.get('split_documents'), [])
            self.assertEqual(target.read_bytes(), again.read_bytes())

    def test_small_documents_are_left_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp)/'source.epub', Path(tmp)/'target.epub'
            self.make_book(source, chapters=2, chapter_paragraphs=10)
            report = clean_epub(source, target)
            self.assertEqual(report['split_documents'], [])
            with zipfile.ZipFile(target) as z:
                self.assertEqual(sorted(n for n in z.namelist() if n.startswith('OPS/vol1')), ['OPS/vol1.xhtml'])

    def test_part_boundaries_skip_headings_that_would_leave_a_tiny_part(self):
        doc = parse(f'<html xmlns="{XHTML}"><body><h2 id="part">Часть</h2><h3 id="a">I</h3>{paragraphs("a", 20)}<h3 id="b">II</h3>{paragraphs("b", 20)}<h3 id="c">III</h3><p>Коротко.</p></body></html>'.encode())
        body = doc.xpath('//*[local-name()="body"]')[0]
        boundaries, _, headings = choose_boundaries(body)
        self.assertEqual([h.get('id') for h in headings], ['part', 'a', 'b', 'c'])
        self.assertEqual([h.get('id') for h in boundaries], ['b'], 'part title stays with chapter I, tiny tail stays with chapter II')
        first = extract_part(doc, None, boundaries[0]); second = extract_part(doc, boundaries[0], None)
        compact = lambda el: ''.join(text(el).split())
        self.assertTrue(compact(first).startswith('ЧастьIa0слово'))
        self.assertTrue(compact(first).endswith('слово'))
        self.assertTrue(compact(second).startswith('IIb0'))
        self.assertTrue(compact(second).endswith('Коротко.'))
        self.assertEqual(compact(first) + compact(second), compact(doc))

    def test_extract_part_keeps_text_between_nested_elements(self):
        doc = parse(f'<html xmlns="{XHTML}"><body>lead<div>a<h2 id="h1">One</h2>after-h1<span>s</span>tail-s</div>between<div>b<h2 id="h2">Two</h2>c</div>end</body></html>'.encode())
        h1, h2 = doc.xpath('//*[@id="h1"]')[0], doc.xpath('//*[@id="h2"]')[0]
        self.assertEqual(text(extract_part(doc, None, h1)), 'leada')
        # Text that precedes the next heading inside its own container still belongs to this part.
        self.assertEqual(text(extract_part(doc, h1, h2)), 'Oneafter-h1stail-sbetweenb')
        self.assertEqual(text(extract_part(doc, h2, None)), 'Twocend')


if __name__ == '__main__': unittest.main()
