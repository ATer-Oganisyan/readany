import tempfile
import unittest
import zipfile
from pathlib import Path
from clean_epub import clean_epub, clean_document, parse, text, read_document, external, remove_navigation_node

class CatalogCleanupTests(unittest.TestCase):
    def make_book(self, path):
        files = {
            'mimetype': 'application/epub+zip',
            'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
            'OPS/book.opf': '''<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title> Old  title </dc:title><dc:creator>Author</dc:creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="about" href="about.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/><itemref idref="about"/></spine></package>''',
            'OPS/chapter.xhtml': '''<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Действие первое</title><script>window.location="https://example.org"</script><meta http-equiv="refresh" content="0;url=https://example.org"/></head><body><h2 id="act1">Действие первое</h2><p id="p1">Бригадир, в <a id="word" href="https://ru.wiktionary.org/wiki/сюртук" target="_blank">сюртуке</a>, ходит и курит табак.</p><p><a href="#note" epub:type="noteref">1</a></p><aside id="note" epub:type="footnote">Примечание автора.</aside><h2>Предисловие автора</h2><p>Авторский текст.</p><h2>Примечания редакторов</h2><p>Служебное пояснение.</p><h2 id="act2">Действие второе</h2><p>Реплика героя.</p></body></html>''',
            'OPS/about.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>MediaWiki:Wsexport_about</title></head><body><h1>Об этом электронном издании</h1><p>Источник и лицензия</p></body></html>',
            'OPS/nav.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Contents</title></head><body><nav><ol><li><a href="chapter.xhtml#act1">Действие первое</a></li><li><a href="about.xhtml">Об издании</a></li></ol></nav></body></html>',
        }
        with zipfile.ZipFile(path, 'w') as z:
            for name, content in files.items(): z.writestr(name, content)

    def test_words_author_text_and_internal_notes_survive_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp)/'source.epub', Path(tmp)/'target.epub'
            self.make_book(source); original = source.read_bytes()
            report = clean_epub(source, target, title='Бригадир')
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(report['external_links_removed'], 1)
            with zipfile.ZipFile(target) as z:
                doc = parse(z.read('OPS/chapter.xhtml'))
                words = text(doc)
                self.assertIn('сюртуке', words)
                self.assertIn('Авторский текст.', words)
                self.assertIn('Примечание автора.', words)
                self.assertIn('Реплика героя.', words)
                self.assertNotIn('Служебное пояснение.', words)
                self.assertEqual(doc.xpath('//*[@id="word"]')[0].get('href'), None)
                self.assertEqual(len(doc.xpath('//*[@href="#note"]')), 1)
                self.assertFalse(doc.xpath('//*[local-name()="script" or local-name()="meta"]'))
                opf = parse(z.read('OPS/book.opf'))
                self.assertEqual(opf.xpath('//*[@idref="about"]')[0].get('linear'), 'no')
                self.assertIn('Источник и лицензия', z.read('OPS/about.xhtml').decode())
                self.assertNotIn('about.xhtml', z.read('OPS/nav.xhtml').decode())
                self.assertEqual(z.infolist()[0].filename, 'mimetype')
                self.assertEqual(z.infolist()[0].compress_type, zipfile.ZIP_STORED)
            second = Path(tmp)/'second.epub'
            clean_epub(target, second, title='Бригадир')
            self.assertEqual(target.read_bytes(), second.read_bytes())

    def test_repairs_orphan_ncx_closings_without_losing_any_chapters(self):
        raw = b'<ncx><navMap></navPoint><navPoint id="one"><navLabel><text>One</text></navLabel><content src="one.xhtml"/></navPoint><navPoint id="two"><navLabel><text>Two</text></navLabel><content src="two.xhtml"/></navPoint></navMap></ncx>'
        report = {}
        doc = read_document(raw, report, 'toc.ncx')
        self.assertEqual(doc.xpath('//content/@src'), ['one.xhtml', 'two.xhtml'])
        self.assertEqual(report['repaired_xml'], ['toc.ncx'])

    def test_removing_editorial_toc_parent_keeps_nested_story_chapters_in_order(self):
        ncx = parse(b'<navMap><navPoint id="editor"><content src="removed.xhtml"/><navPoint id="one"/><navPoint id="two"/></navPoint><navPoint id="three"/></navMap>')
        remove_navigation_node(ncx[0], './navPoint')
        self.assertEqual(ncx.xpath('./navPoint/@id'), ['one', 'two', 'three'])
        nav = parse(b'<ol><li><a href="removed.xhtml">Editor</a><ol><li id="one"/><li id="two"/></ol></li><li id="three"/></ol>')
        remove_navigation_node(nav[0], './ol/li')
        self.assertEqual(nav.xpath('./li/@id'), ['one', 'two', 'three'])

    def test_repairs_broken_html_without_truncating_the_later_story(self):
        raw = b'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Book</title></head><body><p id="one">Start</p></div></li><p id="two">Rest of the story &amp; ending.</p></body></html>'
        doc = read_document(raw, {}, 'chapter.xhtml')
        self.assertIn('Rest of the story & ending.', text(doc))
        self.assertEqual(doc.xpath('//*[@id]/@id'), ['one', 'two'])

    def test_real_brigadir_loses_links_but_keeps_every_chapter_word_and_id(self):
        source = Path(__file__).parent / 'fixtures' / 'brigadir-original.epub'
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'brigadir.epub'
            report = clean_epub(source, target)
            self.assertEqual(report['external_links_removed'], 41)
            with zipfile.ZipFile(source) as before, zipfile.ZipFile(target) as after:
                for name in before.namelist():
                    if not name.endswith('.xhtml'): continue
                    old, new = parse(before.read(name)), parse(after.read(name))
                    self.assertEqual(text(old), text(new), name)
                    self.assertEqual(old.xpath('//*[@id]/@id'), new.xpath('//*[@id]/@id'), name)
                    self.assertFalse(any(external(href) for href in new.xpath('//*[local-name()="a"]/@href')), name)

    def test_input_cannot_be_overwritten(self):
        with self.assertRaisesRegex(ValueError, 'Output must differ'):
            clean_epub('same.epub', 'same.epub')

    def test_escaped_export_tags_disappear_without_losing_words_or_diacritics(self):
        doc = parse(b'<html><body><p id="prose">One &lt;span class="ifimg"&gt;two&lt;/span&gt;&lt;&lt;br&gt;three. Coll&lt;e!&gt;ge.</p><p>Produced by will, and nourished.</p></body></html>')
        report = {'removed_blocks': 0, 'external_links_removed': 0, 'editorial_sections': []}
        clean_document(doc, report, text_replacements={'<e!>': 'è'})
        self.assertEqual(text(doc), 'One two three. Collège.Produced by will, and nourished.')
        self.assertEqual(doc.xpath('//*[@id]/@id'), ['prose'])

    def test_export_tag_split_between_word_spans_does_not_remove_poem_words(self):
        doc = parse(b'<html><body><p><span id="one">First word. &lt;span </span><span id="two">class="ifimg" &gt;</span><span id="three">Next verse.</span></p></body></html>')
        report = {'removed_blocks': 0, 'external_links_removed': 0, 'editorial_sections': []}
        clean_document(doc, report)
        self.assertEqual(text(doc), 'First word. Next verse.')
        self.assertEqual(doc.xpath('//@id'), ['one', 'two', 'three'])

    def test_reviewed_poem_illustrations_do_not_squeeze_the_remaining_verse(self):
        doc = parse(b'<html><body><p>First line.<span style="float:right"><span>&lt;span </span><span>class="ifimg"&gt;</span><img src="picture.jpg"/></span>Second line.</p></body></html>')
        report = {'removed_blocks': 0, 'external_links_removed': 0, 'editorial_sections': []}
        clean_document(doc, report, normalize_image_floats=True)
        self.assertEqual(text(doc), 'First line.Second line.')
        self.assertEqual(doc.xpath('//img/@src'), ['picture.jpg'])
        self.assertIn('float:none', doc.xpath('//span[@style]/@style')[0])

    def test_gutenberg_credit_continuation_is_hidden_but_first_chapter_is_preserved(self):
        doc = parse(b'<html><body><p id="id00000">Produced by Reader</p><p id="id00001">and the Online Distributed Proofreading Team.</p><h1 id="id00002">STORY</h1><p>Actual author text.</p></body></html>')
        report = {'removed_blocks': 0, 'external_links_removed': 0, 'editorial_sections': []}
        clean_document(doc, report)
        self.assertEqual(text(doc), 'STORYActual author text.')
        self.assertIn('Produced by Reader', report['_notices'])

    def test_review_selects_editor_by_id_and_stops_before_author_dialogue(self):
        doc = parse(b'<html><body><h2 id="author">PREFACE</h2><p>Author words.</p><h2 id="editor">PREFACE</h2><p>Later commentary.</p><p>ALCIBIADES I</p><p>SOCRATES: Original dialogue.</p></body></html>')
        report = {'removed_blocks': 0, 'external_links_removed': 0, 'editorial_sections': []}
        clean_document(doc, report, reviewed_sections=[{'heading': 'PREFACE', 'heading_id': 'editor', 'stop_before_text': 'ALCIBIADES I'}])
        self.assertIn('Author words.', text(doc))
        self.assertIn('SOCRATES: Original dialogue.', text(doc))
        self.assertNotIn('Later commentary.', text(doc))

    def test_missing_review_boundary_fails_instead_of_deleting_author_text(self):
        doc = parse(b'<html><body><h2>PREFACE</h2><p>Original dialogue.</p></body></html>')
        with self.assertRaisesRegex(ValueError, 'Missing reviewed boundary'):
            clean_document(doc, {}, reviewed_sections=[{'heading': 'PREFACE', 'stop_before_text': 'NOT PRESENT'}])
        self.assertIn('Original dialogue.', text(doc))

    def test_publication_notices_are_retained_outside_spine_and_repeat_is_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target, second = [Path(tmp)/name for name in ('source.epub', 'target.epub', 'second.epub')]
            self.make_book(source)
            with zipfile.ZipFile(source) as z: files = {name: z.read(name) for name in z.namelist()}
            files['OPS/chapter.xhtml'] = files['OPS/chapter.xhtml'].replace(b'</body>', b'<div class="publisher">Publisher credit <a href="https://example.org">source</a></div></body>')
            files['OPS/chapter.xhtml'] = files['OPS/chapter.xhtml'].replace(b'</body>', '<p>Редакторы издания: Первый, Второй.</p></body>'.encode())
            with zipfile.ZipFile(source, 'w') as z:
                for name, data in files.items(): z.writestr(name, data)
            clean_epub(source, target)
            with zipfile.ZipFile(target) as z:
                self.assertNotIn('Publisher credit', text(parse(z.read('OPS/chapter.xhtml'))))
                self.assertIn('Publisher credit', text(parse(z.read('Narra/source-notices.xhtml'))))
                self.assertNotIn('narra-source-notices', parse(z.read('OPS/book.opf')).xpath('//*[local-name()="spine"]/*/@idref'))
            clean_epub(target, second)
            self.assertEqual(target.read_bytes(), second.read_bytes())

    def test_ncx_page_list_and_auxiliary_navigation_drop_removed_note_targets(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp)/'source.epub', Path(tmp)/'target.epub'
            self.make_book(source)
            with zipfile.ZipFile(source) as z: files = {name: z.read(name) for name in z.namelist()}
            files['OPS/book.opf'] = files['OPS/book.opf'].replace(b'</manifest>', b'<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>')
            files['OPS/toc.ncx'] = b'<ncx><navMap><navPoint><navLabel><text>Act</text></navLabel><content src="chapter.xhtml#act1"/></navPoint></navMap><pageList><pageTarget><content src="missing.xhtml#note"/></pageTarget><pageTarget><content src="chapter.xhtml#act2"/></pageTarget></pageList><navList><navTarget><content src="about.xhtml"/></navTarget></navList></ncx>'
            with zipfile.ZipFile(source, 'w') as z:
                for name, data in files.items(): z.writestr(name, data)
            clean_epub(source, target)
            with zipfile.ZipFile(target) as z:
                ncx = parse(z.read('OPS/toc.ncx'))
                self.assertEqual(ncx.xpath('//content/@src'), ['chapter.xhtml#act1', 'chapter.xhtml#act2'])

if __name__ == '__main__': unittest.main()
