import tempfile
import unittest
import zipfile
from pathlib import Path
from chapter_headings import sentence_case, replace_text, normalize_chapters
from clean_epub import clean_epub, parse, text, member_path


class ChapterHeadingTests(unittest.TestCase):
    def test_sentence_case_ornaments_and_roman_numbers(self):
        for before, after in [
            ('* ЧАСТЬ ПЕРВАЯ *', 'Часть первая'),
            ('гЛаВа вТоРаЯ', 'Глава вторая'),
            ('CHAPTER XIV. THE ROAD HOME', 'Chapter XIV. the road home'),
            ('XIV. THE ROAD HOME', 'XIV. The road home'),
            ('* ДЕЙСТВИЕ II *', 'Действие II'),
            ('TABLE OF CONTENTS.[*]', 'Table of contents.'),
            ('«НОВОЕ НАЧАЛО»', '«Новое начало»'),
            ('3. FIRST STEPS', '3. First steps'),
            ('*****', ''),
        ]:
            with self.subTest(before=before):
                self.assertEqual(sentence_case(before), after)
                self.assertEqual(sentence_case(after), after)

    def test_inline_markup_ids_and_link_destinations_survive(self):
        doc = parse('<h2 id="chapter">* <span id="a">ГЛАВА</span> <em id="b">ВТОРАЯ</em><a href="#note">*</a> *</h2>'.encode())
        replace_text(doc, sentence_case(text(doc)))
        self.assertEqual(text(doc), 'Глава вторая')
        self.assertEqual(doc.xpath('//@id'), ['chapter', 'a', 'b'])
        self.assertEqual(doc.xpath('//@href'), ['#note'])

    def test_exports_without_body_are_still_normalized(self):
        doc = parse('<html><div><h2 id="chapter">ABBREVIATIONS USED IN THE NOTES.</h2><p>Keep THIS prose.</p></div></html>'.encode())
        normalize_chapters({'chapter.xhtml':doc}, {}, {}, set(), {}, member_path, text)
        self.assertEqual(text(doc.xpath('//h2')[0]), 'Abbreviations used in the notes.')
        self.assertEqual(text(doc.xpath('//p')[0]), 'Keep THIS prose.')

    def test_epub_nav_body_css_and_second_pass_agree(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target, repeat = [Path(tmp)/n for n in ['source.epub','target.epub','repeat.epub']]
            files = {
                'mimetype':'application/epub+zip',
                'META-INF/container.xml':'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
                'book.opf':'<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:language>ru</dc:language></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/><item id="n" href="n.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine><itemref idref="c"/></spine></package>',
                'c.xhtml':'<html><head><title>Chapter</title><style>h2 {text-transform:uppercase!important}</style></head><body><h2 id="one"><span>* ГЛАВА ПЕРВАЯ *</span></h2><p id="story">Не менять РЕПЛИКУ автора.</p><h2 id="two">***</h2><p>Продолжение.</p></body></html>',
                'n.xhtml':'<html><body><nav><a href="c.xhtml#one">* ГЛАВА ПЕРВАЯ *</a><a href="c.xhtml#two">***</a></nav></body></html>',
                'toc.ncx':'<ncx><navMap><navPoint id="n1"><navLabel><text>* ГЛАВА ПЕРВАЯ *</text></navLabel><content src="c.xhtml#one"/></navPoint><navPoint id="n2"><navLabel><text>***</text></navLabel><content src="c.xhtml#two"/></navPoint></navMap></ncx>',
            }
            with zipfile.ZipFile(source,'w') as z:
                for name, content in files.items(): z.writestr(name,content)
            clean_epub(source,target)
            with zipfile.ZipFile(target) as z:
                body=parse(z.read('c.xhtml')); nav=parse(z.read('n.xhtml')); ncx=parse(z.read('toc.ncx'))
                self.assertEqual([text(e) for e in body.xpath('//h2')], ['Глава первая','Раздел 2'])
                self.assertEqual([text(e) for e in nav.xpath('//a')], ['Глава первая','Раздел 2'])
                self.assertEqual(ncx.xpath('//navLabel/text/text()'), ['Глава первая','Раздел 2'])
                self.assertEqual(text(body.xpath('//*[@id="story"]')[0]),'Не менять РЕПЛИКУ автора.')
                self.assertIn('text-transform:none!important',body.xpath('//h2/span')[0].get('style'))
            clean_epub(target,repeat)
            self.assertEqual(target.read_bytes(),repeat.read_bytes())


if __name__ == '__main__': unittest.main()
