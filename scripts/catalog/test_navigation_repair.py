import tempfile
import unittest
import zipfile
from pathlib import Path
from clean_epub import clean_epub, parse, text
from repair_navigation import remove_contents_column_labels


class NavigationRepairTests(unittest.TestCase):
    def book(self, path, body):
        files = {
            'mimetype':'application/epub+zip',
            'META-INF/container.xml':'<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
            'OPS/book.opf':'<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:language>en</dc:language></metadata><manifest><item id="story" href="story.xhtml" media-type="application/xhtml+xml"/><item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="toc"><itemref idref="story"/></spine></package>',
            'OPS/story.xhtml':'<html><head><title>Book</title></head><body>'+body+'</body></html>',
            'OPS/toc.ncx':'<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap/></ncx>',
        }
        with zipfile.ZipFile(path,'w') as z:
            for name, value in files.items():z.writestr(name,value)

    def test_empty_toc_uses_real_rst_chapters_and_keeps_story_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            source,target,repeat=[Path(tmp)/name for name in ['source.epub','target.epub','repeat.epub']]
            self.book(source,'<p class="center pfirst" id="one">CHAPTER I</p><p class="center pnext">THE ROAD HOME</p><p id="prose">Keep THIS author text.</p><p class="center pfirst" id="two">CHAPTER II</p><p>Next part.</p>')
            review={'strategy':'rst','expected_entries':2}
            clean_epub(source,target,navigation_repair=review)
            with zipfile.ZipFile(target) as z:
                toc=parse(z.read('OPS/toc.ncx'));story=parse(z.read('OPS/story.xhtml'))
                self.assertEqual(toc.xpath('//*[local-name()="content"]/@src'),['story.xhtml#one','story.xhtml#two'])
                self.assertEqual(toc.xpath('//*[local-name()="text"]/text()'),['Chapter I. the road home','Chapter II'])
                self.assertEqual(text(story.xpath('//*[@id="prose"]')[0]),'Keep THIS author text.')
                self.assertEqual(text(story.xpath('//*[@id="one"]')[0]),'Chapter I')
            clean_epub(target,repeat,navigation_repair=review)
            self.assertEqual(target.read_bytes(),repeat.read_bytes())
            with self.assertRaisesRegex(ValueError,'expected 3 chapters, found 2'):
                clean_epub(source,repeat,navigation_repair={'strategy':'rst','expected_entries':3})

    def test_poems_without_ids_get_stable_destinations(self):
        with tempfile.TemporaryDirectory() as tmp:
            source,target,repeat=[Path(tmp)/name for name in ['source.epub','target.epub','repeat.epub']]
            self.book(source,'<div class="poem"><p class="title">FIRST POEM</p><p>Verse one.</p><p class="title">SECOND POEM</p><p>Verse two.</p></div>')
            review={'strategy':'poems','expected_entries':2}
            clean_epub(source,target,navigation_repair=review)
            with zipfile.ZipFile(target) as z:
                self.assertEqual(parse(z.read('OPS/toc.ncx')).xpath('//*[local-name()="content"]/@src'),['story.xhtml#narra-toc-1','story.xhtml#narra-toc-2'])
            clean_epub(target,repeat,navigation_repair=review)
            self.assertEqual(target.read_bytes(),repeat.read_bytes())

    def test_removing_column_keeps_child_chapters_and_ordinary_headings(self):
        doc=parse(b'<html><body><h4 id="column">Chapter</h4><p>I First</p><p>II Second</p><h4 id="real">Chapter</h4><p>Story starts here.</p></body></html>')
        toc=parse(b'<ncx><navMap><navPoint id="column"><navLabel><text>Chapter</text></navLabel><content src="story.xhtml#column"/><navPoint id="one"><content src="story.xhtml#one"/></navPoint></navPoint><navPoint id="two"><content src="story.xhtml#two"/></navPoint></navMap></ncx>')
        report={};remove_contents_column_labels({'story.xhtml':doc},{'toc.ncx':toc},report)
        self.assertEqual(toc.xpath('//navMap/navPoint/@id'),['one','two'])
        self.assertEqual(text(doc.xpath('//*[@id="real"]')[0]),'Chapter')
        self.assertEqual(report['contents_column_labels_removed'],1)
