export interface CoverGenreProfile {
  id: string;
  label: string;
  artDirection: string;
}

interface GenreRule {
  profile: CoverGenreProfile;
  metadata: RegExp;
  content: RegExp;
}

const GENERAL_PROFILE: CoverGenreProfile = {
  id: "classic",
  label: "classics / general literature",
  artDirection:
    "Render the focal illustration as a restrained late-modernist paper collage combined with one engraved or photocopied fragment. Use an ambiguous object or anonymous figure; avoid speculative genre conventions and decorative literary clichés.",
};

const GENRE_RULES: GenreRule[] = [
  {
    profile: {
      id: "manga",
      label: "manga or anime graphic fiction",
      artDirection:
        "Render one or two original characters as hand-painted 1990s cel anime: decisive ink contours, expressive faces, flat shadow shapes, limited cel colors and subtle analogue frame grain. Use a cinematic crop and strong silhouette; never imitate a named artist, studio or franchise, and avoid logos, speed-line clichés and crowded manga panels.",
    },
    metadata: /(manga|anime|манг|аниме|комикс.*япон)/iu,
    content: /(manga|anime|манг|аниме|японск.*(?:комикс|графическ))/iu,
  },
  {
    profile: {
      id: "fanfiction",
      label: "fanfiction or transformative fiction",
      artDirection:
        "Render the focal illustration as an energetic editorial character collage: one or two original anonymous figures, expressive gesture, photocopied contours and a single flat ink shape. Emphasize relationship dynamics or an altered premise; never reproduce recognizable copyrighted faces, costumes, franchise logos, canonical props or official key art.",
    },
    metadata: /(fan[ _-]?fiction|fanfic|фикбук|фанфик)/iu,
    content: /(fan[ _-]?fiction|fanfic|фикбук|фанфик)/iu,
  },
  {
    profile: {
      id: "children",
      label: "children's literature",
      artDirection:
        "Render a playful original character or creature as bold naïve cut-paper illustration mixed with a simple woodblock texture: chunky tactile shapes, imperfect edges, bright flat inks and a strong readable silhouette. Avoid licensed-character imitation, glossy cartoons and sugary styling.",
    },
    metadata: /(child|children|juvenile|kids?|fairy[ _-]?tale|детск|сказк)/iu,
    content: /(children'?s book|для детей|детская (?:книга|литература)|сказк)/iu,
  },
  {
    profile: {
      id: "poetry",
      label: "poetry",
      artDirection:
        "Render the focal illustration as one sparse monotype or wet-brush ink gesture with visible pressure, pauses and dry edges, optionally intersecting one small photographic fragment. Translate rhythm and compression rather than plot; avoid pens, pages and decorative calligraphy.",
    },
    metadata: /(poetry|poem|verse|lyrics?|стих|поэз)/iu,
    content: /(collection of poems|poetry collection|сборник стих|поэтическ)/iu,
  },
  {
    profile: {
      id: "drama",
      label: "drama and plays",
      artDirection:
        "Render a single figure or opposing pair as stark expressionist screenprint: elongated gesture, hard side-light shapes, deep black ink and one abrupt crop, like an experimental theatre photograph translated into print. Build around conflict and presence; avoid masks, curtains, skulls and literal stage scenery.",
    },
    metadata: /(drama|plays?|theatre|theater|драматург|пьес)/iu,
    content: /(play in|stage play|пьеса|драматическ)/iu,
  },
  {
    profile: {
      id: "mystery-thriller",
      label: "mystery, crime or thriller",
      artDirection:
        "Render the focal illustration as high-contrast noir xerox collage: an anonymous cropped figure or familiar object broken by one missing fragment, overprint or hard shadow. Create suspense through omission and visual uncertainty; avoid depicting a creature or object named in the title, guns, magnifying glasses and crime-tape clichés.",
    },
    metadata: /(det_|detective|mystery|thriller|crime|noir|детектив|триллер|кримин)/iu,
    content:
      /(murder mystery|criminal investigation|расследован|детективн|загадочн(?:ое|ого) убийств)/iu,
  },
  {
    profile: {
      id: "science-fiction",
      label: "science fiction",
      artDirection:
        "Render the focal illustration in 1960s–1970s retro-science airbrush combined with precise geometric screenprint: an original human silhouette, machine fragment or impossible scale relation with soft sprayed edges and flat technical shapes. Avoid clocks and dials with numbers, spaceships, neon cyberpunk skylines and glossy concept art.",
    },
    metadata:
      /(sf_(?!fantasy)|science[ _-]?fiction|sci[ _-]?fi|cyberpunk|space opera|научн.*фантаст|киберпанк)/iu,
    content: /(science fiction|научная фантастика|киберпанк|межзв[её]здн|искусственн.*интеллект)/iu,
  },
  {
    profile: {
      id: "adventure",
      label: "adventure",
      artDirection:
        "Render an original figure in motion as a rough pulp-era linocut with an extreme diagonal crop, wind-swept gesture and one interrupted trajectory. Keep it raw, physical and kinetic rather than cinematic; avoid heroic poses, vehicles, weapons and treasure-map clichés.",
    },
    metadata: /(adventure|adv_|action|приключ|боевик)/iu,
    content: /(adventure novel|приключенческ|история о путешестви)/iu,
  },
  {
    profile: {
      id: "fantasy",
      label: "fantasy",
      artDirection:
        "Render an original transformed figure or creature as a collision of medieval marginalia and contemporary paper-cut silhouette: delicate ink detail against one impossible flat shape. Suggest mythic rules without franchise aesthetics; avoid heroic warriors, castles, dragons and polished fantasy concept art.",
    },
    metadata: /(fantasy|sf_fantasy|urban fantasy|фэнтези|мифолог)/iu,
    content: /(fantasy novel|роман фэнтези|магическ(?:ий|ая) мир|городское фэнтези)/iu,
  },
  {
    profile: {
      id: "horror",
      label: "horror",
      artDirection:
        "Render an uncanny original figure, garment or domestic object through damaged photographic emulsion and coarse photocopy grain, with one anatomically or materially impossible interruption. Create unease without spectacle; avoid gore, monsters, vampires, skulls and shock-poster imagery.",
    },
    metadata: /(horror|gothic|supernatural|ужас|мистик)/iu,
    content: /(horror novel|роман ужасов|готическ|сверхъестественн.*ужас)/iu,
  },
  {
    profile: {
      id: "romance",
      label: "romance",
      artDirection:
        "Render two original anonymous figures in the manner of a restrained 1960s fashion-editorial illustration: elegant ink contours, cropped profiles, fabric-like flat shapes and deliberate space between them. Focus on intimacy and social pressure; avoid embraces, hearts and sentimental glamour.",
    },
    metadata: /(love_|romance|romantic fiction|любовн|романтическ)/iu,
    content: /(romance novel|love story|любовный роман|романтическая история)/iu,
  },
  {
    profile: {
      id: "historical-fiction",
      label: "historical fiction",
      artDirection:
        "Render the focal illustration as an era-specific engraved figure or architectural fragment interrupted by one torn archival photograph or modern flat shape. Let print registration visibly collide across periods; avoid costume tableaux, battle scenes and heritage-poster nostalgia.",
    },
    metadata: /(historical fiction|history fiction|историческ.*(?:роман|проз)|antique)/iu,
    content: /(historical novel|исторический роман|историческая проза)/iu,
  },
  {
    profile: {
      id: "biography-memoir",
      label: "biography or memoir",
      artDirection:
        "Render one human presence as an intimate documentary contact-print fragment combined with handwritten-looking but strictly nonverbal marks or a cut-paper void. Build around memory and identity; avoid conventional full portraits, timelines and photo-album layouts.",
    },
    metadata: /(biograph|memoir|autobiograph|биограф|мемуар|автобиограф)/iu,
    content: /(memoir|life story|воспоминания|история жизни|биографи)/iu,
  },
  {
    profile: {
      id: "philosophy",
      label: "philosophy",
      artDirection:
        "Render the focal illustration as a severe Bauhaus-style geometric paradox: two or three flat forms, one impossible spatial relation and crisp screenprinted edges with slight misregistration. Make the argument visible without narrative illustration; avoid statues, thinker portraits, brains and classical symbols.",
    },
    metadata: /(philosoph|ethics|metaphysics|философ|этик|метафиз)/iu,
    content: /(philosophical|философск|этическ.*исследован)/iu,
  },
  {
    profile: {
      id: "psychology-self-help",
      label: "psychology or self-development",
      artDirection:
        "Render an original human silhouette as a tactile anatomical paper construction: nested cutouts, repeated behavioral shapes and one visible mechanism, printed like a 1970s educational plate. Avoid brains, arrows, ladders, smiling stock people and motivational symbolism.",
    },
    metadata:
      /(psycholog|self[ _-]?help|self[ _-]?development|personal growth|психолог|саморазвит|личностн.*рост)/iu,
    content: /(psychology|self-help|психологическ|саморазвити|привычк)/iu,
  },
  {
    profile: {
      id: "business-economics",
      label: "business or economics",
      artDirection:
        "Render the focal illustration as a precise isometric editorial construction made from one everyday object under visible systemic pressure, using technical pen lines plus one flat screenprint mass. Express incentives and exchange without charts, coins, handshakes, skyscrapers or corporate imagery.",
    },
    metadata:
      /(business|econom|management|marketing|finance|предпринимат|эконом|менеджмент|финанс)/iu,
    content: /(business book|economics|управлени.*бизнес|предпринимательств|экономическ)/iu,
  },
  {
    profile: {
      id: "science-technology",
      label: "science or technology nonfiction",
      artDirection:
        "Render the focal illustration as a rigorous mid-century scientific cutaway mixed with soft technical airbrush: one process, scale shift or invisible relationship made tactile and strange. Keep it editorial rather than instructional; avoid interface screenshots, circuit-board decoration and textbook diagrams.",
    },
    metadata:
      /(science|technology|computer|programming|mathemat|physics|biology|наук|технолог|компьют|программир|математ|физик|биолог)/iu,
    content: /(scientific|technology|programming|научн.*популяр|технологическ|программировани)/iu,
  },
  {
    profile: {
      id: "history-politics",
      label: "history, society or politics",
      artDirection:
        "Render the focal illustration as forceful political photomontage: anonymous crowd or institutional architecture cut against one intimate domestic fragment, with coarse newspaper halftone and flat overprint. Avoid propaganda language, decorative maps and recognizable leader portraits.",
    },
    metadata: /(history|politic|society|sociolog|истори|полит|социолог|обществ)/iu,
    content:
      /(historical study|political|social history|историческ.*исследован|политическ|общественн)/iu,
  },
  {
    profile: {
      id: "literary-fiction",
      label: "literary fiction",
      artDirection:
        "Render the focal illustration as an expressionist linocut or torn photographic collage featuring one ambiguous anonymous figure, with compressed gesture and layered silhouette. Emphasize psychological and social tension; avoid literal plot scenes, polished portraits and cinematic key art.",
    },
    metadata: /(fiction|literary|novel|prose|classic|проз|роман|повест|классик)/iu,
    content: /(literary novel|novel about|роман о|повесть|литературн.*проз)/iu,
  },
];

export function resolveCoverGenreProfile(input: {
  subjects?: string[];
  title?: string;
  description?: string;
  excerpt?: string;
}): CoverGenreProfile {
  const metadata = (input.subjects ?? []).join(" ").normalize("NFKC");
  if (metadata) {
    const metadataMatch = GENRE_RULES.find((rule) => rule.metadata.test(metadata));
    if (metadataMatch) return metadataMatch.profile;
  }

  const content = [input.title, input.description, input.excerpt]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .slice(0, 6_000);
  const contentMatch = GENRE_RULES.find((rule) => rule.content.test(content));
  return contentMatch?.profile ?? GENERAL_PROFILE;
}
