"""Recover reviewed empty EPUB TOCs from real chapter markers in spine order."""
import posixpath
import re
from lxml import etree as ET
from chapter_headings import sentence_case

NCX = 'http://www.daisy.org/z3986/2005/ncx/'
NUMBERED = re.compile(r'^CHAPTER\s+([IVXLCDM]+|\d+)\.?$', re.I)


def local(el): return ET.QName(el).localname if isinstance(el.tag, str) else ''
def text(el): return ' '.join(''.join(el.itertext()).split())


def recover_navigation(docs, ncxs, manifest, opf, review, report):
    if not review: return
    strategy = review['strategy']
    entries = []
    for ref in opf.xpath('//*[local-name()="spine"]/*'):
        if ref.get('linear') == 'no': continue
        name, _ = manifest[ref.get('idref')]
        if 'titlepage' in name or name not in docs: continue
        doc = docs[name]
        for element in list(doc.iter()):
            kind = local(element)
            if kind not in {'p','h5'}: continue
            label = text(element)
            classes = set(element.get('class','').split())
            selected = (
                strategy == 'rst' and kind == 'p' and 'center' in classes and bool(NUMBERED.fullmatch(label)) or
                strategy == 'warwick' and kind == 'p' and 'ph2' in classes and bool(NUMBERED.fullmatch(label)) or
                strategy == 'abaft' and kind == 'p' and 'ph2' in classes and bool(element.xpath('.//*[@id]')[0:1]) and
                    any(re.fullmatch(r'chap\d+', ident) for ident in element.xpath('.//@id')) or
                strategy == 'poems' and kind == 'p' and 'title' in classes or
                strategy == 'cellini' and kind == 'h5' and bool(re.fullmatch(r'[IVXLCDM]+', label)) or
                strategy == 'shakespeare' and kind == 'p' and bool(re.fullmatch(r'Actus\s+\w+\.(?:\s*Sc[oa]ena\s+\w+\.)?', label, re.I))
            )
            if not selected: continue
            # Footnote numbers remain clickable in the text, but are not chapter names.
            label = re.sub(r'\[\d+\]$', '', label).strip()
            if strategy == 'cellini': label = 'Chapter ' + label
            if strategy in {'rst','warwick'}:
                following = element.getnext()
                if following is not None and local(following)=='p' and 'center' in following.get('class','').split() and not NUMBERED.fullmatch(text(following)):
                    label = label.rstrip('.') + '. ' + text(following)
                    following.set('data-narra-heading','true')
            element.set('data-narra-heading','true')
            ident = element.get('id')
            if not ident:
                ident = f'narra-toc-{len(entries)+1}'
                if doc.xpath('//*[@id=$id]',id=ident): raise ValueError(f'Generated heading ID collision: {name}#{ident}')
                element.set('id',ident)
            entries.append((name,ident,sentence_case(label)))
    if len(entries) != review['expected_entries']:
        raise ValueError(f"Reviewed TOC expected {review['expected_entries']} chapters, found {len(entries)}")
    if not entries or not ncxs: raise ValueError('Cannot recover TOC without chapters and an NCX manifest item')
    for name, doc in ncxs.items():
        maps = doc.xpath('//*[local-name()="navMap"]')
        navmap = maps[0] if maps else ET.SubElement(doc,f'{{{NCX}}}navMap')
        for child in list(navmap): navmap.remove(child)
        for index,(target,ident,label) in enumerate(entries,1):
            point=ET.SubElement(navmap,f'{{{NCX}}}navPoint',id=f'narra-chapter-{index}',playOrder=str(index))
            ET.SubElement(ET.SubElement(point,f'{{{NCX}}}navLabel'),f'{{{NCX}}}text').text=label
            ET.SubElement(point,f'{{{NCX}}}content',src=posixpath.relpath(target,posixpath.dirname(name))+'#'+ident)
    report['recovered_navigation_entries'] = len(entries)


def remove_contents_column_labels(docs, ncxs, report):
    # "Chapter" is a column heading of a printed contents list, not a chapter.
    # Only remove it when the following rows demonstrate that exact structure.
    for name, doc in docs.items():
        for heading in doc.xpath('//*[local-name()="h4"]'):
            if text(heading).casefold() != 'chapter' or not heading.get('id'): continue
            following = list(heading.itersiblings())[:3]
            numbered_rows = following and all(re.match(r'^[IVXLCDM]+[.\s]',text(e)) for e in following[:2])
            packed_rows = following and len(re.findall(r'\b[IVXLCDM]+\b',text(following[0]))) >= 3
            if not (numbered_rows or packed_rows): continue
            fragment = heading.get('id')
            for ncx_name,ncx in ncxs.items():
                for point in list(ncx.xpath('//*[local-name()="navPoint"]')):
                    hrefs=point.xpath('./*[local-name()="content"]/@src')
                    if not hrefs: continue
                    target,_,anchor=hrefs[0].partition('#')
                    target=posixpath.normpath(posixpath.join(posixpath.dirname(ncx_name),target))
                    if target!=name or anchor!=fragment: continue
                    parent=point.getparent();index=parent.index(point)
                    for child in list(point.xpath('./*[local-name()="navPoint"]')):
                        parent.insert(index,child);index+=1
                    parent.remove(point)
                    report['contents_column_labels_removed']=report.get('contents_column_labels_removed',0)+1
            heading.text='Contents'
            for child in list(heading):
                # These reviewed headings are plain text; do not flatten unexpected markup.
                if text(child): raise ValueError('Unexpected markup in contents column heading')
