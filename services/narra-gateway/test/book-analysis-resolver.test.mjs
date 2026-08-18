import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveBookAnalysisEntities } from '../book-analysis-resolver.mjs'

function observation({
  id,
  key = id,
  type = 'character_mention',
  kind = 'character',
  candidate,
  related = [],
  confidence = 0.9,
  startOffset = 0,
  quote = `${candidate} появился`,
  fact = `Факт о ${candidate}`
}) {
  return {
    id,
    observationKey: key,
    type,
    entityKind: kind,
    entityCandidate: candidate,
    relatedEntityCandidates: related,
    fact,
    evidence: {
      quote,
      startOffset,
      endOffset: startOffset + quote.length,
      chapterKey: 'chapter-1'
    },
    confidence
  }
}

test('resolver merges normalized names and explicit aliases over the complete evidence set', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111111',
      type: 'character_alias',
      candidate: 'Анна Сергеевна',
      related: ['Анна', 'Аня'],
      confidence: 0.96,
      startOffset: 100,
      quote: 'Анна Сергеевна, которую друзья называли Анна и Аня, появилась'
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222222',
      type: 'character_action',
      candidate: 'анна',
      confidence: 0.91,
      startOffset: 500
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333333',
      type: 'character_dialogue',
      candidate: 'Аня',
      confidence: 0.88,
      startOffset: 900
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444444',
      type: 'location',
      kind: 'location',
      candidate: 'Москва',
      startOffset: 1_200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 2)
  assert.deepEqual(result[0].canonicalName, 'Анна Сергеевна')
  assert.deepEqual(result[0].aliases, ['Анна', 'Аня'])
  assert.equal(result[0].resolutionStatus, 'confirmed')
  assert.deepEqual(result[0].evidenceIds, observations.slice(0, 3).map(({ id }) => id))
  assert.equal(result[0].data.observationCount, 3)
  assert.equal(result[1].entityKind, 'location')
})

test('resolver leaves ambiguous aliases separate instead of merging two people', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111112',
      type: 'character_alias',
      candidate: 'Анна',
      related: ['госпожа'],
      startOffset: 10
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222223',
      type: 'character_alias',
      candidate: 'Мария',
      related: ['госпожа'],
      startOffset: 20
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333334',
      candidate: 'госпожа',
      startOffset: 30
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 3)
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), ['Анна', 'Мария', 'госпожа'])
})

test('resolver rejects an overlapping generational alias from one weak claim', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111140',
      type: 'character_alias',
      candidate: 'Siddhartha',
      related: ['young Siddhartha'],
      quote: 'A day came when what young Siddhartha had on his mind came bursting forth.',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222250',
      type: 'character_action',
      candidate: 'young Siddhartha',
      quote: 'young Siddhartha openly turned against his father',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 2)
  assert.deepEqual(result[0].aliases, [])
  assert.equal(result[1].resolutionStatus, 'candidate')
})

test('resolver reifies an explicitly owned son without merging him into the father', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111151',
      candidate: 'Siddhartha',
      quote: 'Siddhartha waited beside the river.',
      startOffset: 100
    }),
    observation({
      id: '11111111-1111-4111-8111-111111111153',
      type: 'character_action',
      candidate: 'Siddhartha',
      quote: 'Siddhartha crossed the river.',
      startOffset: 150
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222261',
      type: 'character_alias',
      candidate: 'the boy',
      related: ["Siddhartha's son"],
      fact: "The boy is referred to as Siddhartha's son.",
      quote: 'Siddhartha, who greeted him as his son and welcomed him at the hut.',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333371',
      type: 'character_action',
      candidate: 'the boy',
      related: ['Siddhartha'],
      quote: 'the boy became disobedient and started whining',
      startOffset: 300
    })
  ]

  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 2)
  assert.equal(characters[0].canonicalName, 'Siddhartha')
  assert.equal(characters[0].resolutionStatus, 'confirmed')
  assert.equal(characters[1].canonicalName, "Siddhartha's son")
  assert.deepEqual(characters[1].aliases, ['the boy'])
  assert.equal(characters[1].resolutionStatus, 'confirmed')
})

test('resolver reifies an owner-scoped father from a grounded local apposition', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111152',
      candidate: 'Siddhartha',
      quote: 'Siddhartha entered the chamber.',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222262',
      type: 'character_trait',
      candidate: 'his father',
      related: ['Siddhartha'],
      fact: 'quiet',
      quote: 'His father was quiet and noble.',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333372',
      candidate: 'the Brahman',
      fact: "Siddhartha's father is identified as a Brahman.",
      quote: 'Siddhartha stood behind his father. Quoth the Brahman: Say what you came to say.',
      startOffset: 300
    })
  ]

  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 2)
  assert.equal(characters[0].canonicalName, 'Siddhartha')
  assert.equal(characters[1].canonicalName, "Siddhartha's father")
  assert.deepEqual(characters[1].aliases, ['his father', 'the Brahman'])
  assert.equal(characters[1].resolutionStatus, 'confirmed')
})

test('resolver keeps a grounded personal name canonical over an owner-scoped kinship alias', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111153',
      candidate: 'Elizabeth',
      quote: 'Elizabeth entered the room.',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222263',
      type: 'character_alias',
      candidate: 'Jane Bennet',
      related: ["Elizabeth's sister"],
      fact: "Jane Bennet is Elizabeth's sister.",
      quote: "Elizabeth's sister Jane Bennet entered the room.",
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333373',
      type: 'character_action',
      candidate: 'Jane Bennet',
      quote: 'Jane Bennet smiled at her sister.',
      startOffset: 300
    })
  ]

  const jane = resolveBookAnalysisEntities({ observations })
    .find(({ canonicalName, aliases }) =>
      canonicalName === 'Jane Bennet' || aliases.includes('Jane Bennet')
    )
  assert.equal(jane.canonicalName, 'Jane Bennet')
  assert.ok(jane.aliases.includes("Elizabeth's sister"))
})

test('resolver does not reassign one global father label to another owner', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111154',
      type: 'character_dialogue',
      candidate: 'Father',
      related: ['Jo'],
      quote: 'Jo read the letter from Father.',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222264',
      type: 'character_action',
      candidate: 'Father',
      related: ['Meg'],
      quote: 'Meg remembered Father at the front.',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333374',
      type: 'character_alias',
      candidate: 'Father',
      related: ["Laurie's father"],
      fact: "Father is Laurie's father.",
      quote: 'Laurie spoke about his father.',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444484',
      candidate: 'Laurie',
      quote: 'Laurie stood at the window.',
      startOffset: 400
    })
  ]

  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  const father = characters.find(({ canonicalName }) => canonicalName === 'Father')
  assert.ok(father)
  assert.deepEqual(father.aliases, [])
  assert.equal(characters.some(({ canonicalName }) => canonicalName === "Laurie's father"), false)
})

test('resolver blocks a high-confidence alias across incompatible family titles', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111155',
      type: 'character_alias',
      candidate: 'Aunt March',
      related: ['Mr. March'],
      quote: 'Aunt March sent a message to Mr. March.',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222265',
      type: 'character_action',
      candidate: 'Aunt March',
      quote: 'Aunt March waited in the carriage.',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333375',
      type: 'character_action',
      candidate: 'Mr. March',
      quote: 'Mr. March wrote from the front.',
      startOffset: 300
    })
  ]

  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 2)
  assert.deepEqual(characters.map(({ canonicalName }) => canonicalName), ['Aunt March', 'Mr. March'])
  assert.ok(characters.every(({ aliases }) => aliases.length === 0))
})

test('resolver merges exact leading determiner variants before fragment resolution', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111141',
      candidate: 'Rabbit',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222251',
      candidate: 'The Rabbit',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333361',
      candidate: 'White Rabbit',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'White Rabbit')
  assert.deepEqual(result[0].aliases, ['Rabbit', 'The Rabbit'])
})

test('resolver confirms a repeatedly evidenced capitalized role with a leading determiner', () => {
  const result = resolveBookAnalysisEntities({ observations: [
    observation({
      id: '11111111-1111-4111-8111-111111111941',
      type: 'character_dialogue',
      candidate: 'the Caterpillar',
      quote: '“Who are you?” said the Caterpillar.',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222951',
      type: 'character_action',
      candidate: 'the Caterpillar',
      quote: 'the Caterpillar took the hookah out of its mouth',
      startOffset: 200
    })
  ] })
  assert.equal(result[0].canonicalName, 'the Caterpillar')
  assert.equal(result[0].resolutionStatus, 'confirmed')
})

test('resolver joins a two-part full name only through one exact honorific bridge', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111144',
      type: 'character_alias',
      candidate: 'Mr. Bingley',
      related: ['Charles'],
      quote: 'Mr. Bingley answered when Caroline said, “Charles writes carelessly.”',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222254',
      candidate: 'Charles Bingley',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333364',
      type: 'character_alias',
      candidate: 'Miss Bingley',
      related: ['Caroline'],
      quote: 'Miss Bingley, whom her brother called Caroline, replied.',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444474',
      candidate: 'Caroline Bingley',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 2)
  assert.deepEqual(result.map(({ canonicalName, aliases }) => ({ canonicalName, aliases })), [
    { canonicalName: 'Charles Bingley', aliases: ['Charles', 'Mr. Bingley'] },
    { canonicalName: 'Caroline Bingley', aliases: ['Caroline', 'Miss Bingley'] }
  ])
})

test('resolver does not attach an ambiguous title and surname to one sibling', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111145',
      candidate: 'Miss Bennet',
      quote: 'Miss Bennet accepted her aunt’s invitation.',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222255',
      candidate: 'Elizabeth Bennet',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333365',
      candidate: 'Jane Bennet',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 3)
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Miss Bennet', 'Elizabeth Bennet', 'Jane Bennet'
  ])
  assert.equal(result[0].resolutionStatus, 'candidate')
})

test('resolver keeps strongly evidenced titled parents confirmed despite a shared family name', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111245',
      type: 'character_action',
      candidate: 'Mr. Bennet',
      quote: 'Mr. Bennet opened the letter.',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222355',
      type: 'character_dialogue',
      candidate: 'Mr. Bennet',
      quote: 'Mr. Bennet answered his wife.',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333465',
      type: 'character_action',
      candidate: 'Mrs. Bennet',
      quote: 'Mrs. Bennet rang the bell.',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444575',
      type: 'character_dialogue',
      candidate: 'Mrs. Bennet',
      quote: 'Mrs. Bennet spoke to Jane.',
      startOffset: 400
    }),
    observation({
      id: '55555555-5555-4555-8555-555555555685',
      candidate: 'Elizabeth Bennet',
      startOffset: 500
    }),
    observation({
      id: '66666666-6666-4666-8666-666666666795',
      candidate: 'Jane Bennet',
      startOffset: 600
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  const statuses = new Map(result.map(({ canonicalName, resolutionStatus }) => [
    canonicalName, resolutionStatus
  ]))
  assert.equal(statuses.get('Mr. Bennet'), 'confirmed')
  assert.equal(statuses.get('Mrs. Bennet'), 'confirmed')
})

test('resolver keeps an ambiguous bare name apart from a titled namesake', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111146',
      type: 'character_alias',
      candidate: 'Lady Catherine',
      related: ['Catherine'],
      quote: 'Lady Catherine continued her questions.',
      startOffset: 100
    }),
    observation({
      id: '55555555-5555-4555-8555-555555555586',
      type: 'character_alias',
      candidate: 'Lady Catherine',
      related: ['Catherine'],
      quote: 'Lady Catherine demanded an answer.',
      startOffset: 150
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222256',
      candidate: 'Lady Catherine de Bourgh',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333366',
      candidate: 'Catherine Bennet',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444476',
      candidate: 'Catherine',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 3)
  const groups = result.map(({ canonicalName, aliases }) => ({ canonicalName, aliases }))
  assert.deepEqual(groups, [
    { canonicalName: 'Lady Catherine', aliases: ['Lady Catherine de Bourgh'] },
    { canonicalName: 'Catherine Bennet', aliases: [] },
    { canonicalName: 'Catherine', aliases: [] }
  ])
})

test('resolver applies approved whole-book identity edges without inventing aliases', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111147',
      candidate: 'Elizabeth',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222257',
      candidate: 'Lizzy',
      startOffset: 200
    })
  ]
  const provisional = resolveBookAnalysisEntities({ observations })
  const result = resolveBookAnalysisEntities({
    observations,
    identityMerges: [{
      leftEntityKey: provisional[0].entityKey,
      rightEntityKey: provisional[1].entityKey,
      basis: 'nickname'
    }]
  })
  assert.equal(result.length, 1)
  assert.deepEqual(new Set([result[0].canonicalName, ...result[0].aliases]), new Set([
    'Elizabeth', 'Lizzy'
  ]))
})

test('resolver rejects approved edges across namesakes and generations', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111148',
      candidate: 'Elizabeth Bennet',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222258',
      candidate: 'Jane Bennet',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333368',
      candidate: 'Siddhartha',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444478',
      candidate: 'Young Siddhartha',
      startOffset: 400
    })
  ]
  const provisional = resolveBookAnalysisEntities({ observations })
  const byName = new Map(provisional.map((entity) => [entity.canonicalName, entity.entityKey]))
  const result = resolveBookAnalysisEntities({
    observations,
    identityMerges: [
      {
        leftEntityKey: byName.get('Elizabeth Bennet'),
        rightEntityKey: byName.get('Jane Bennet'),
        basis: 'name_variant'
      },
      {
        leftEntityKey: byName.get('Siddhartha'),
        rightEntityKey: byName.get('Young Siddhartha'),
        basis: 'name_variant'
      }
    ]
  })
  assert.equal(result.length, 4)
})

test('resolver accepts an adjudicated nickname across matching family names only as nickname', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111149',
      candidate: 'Meg March',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222259',
      candidate: 'Margaret March',
      startOffset: 200
    })
  ]
  const provisional = resolveBookAnalysisEntities({ observations })
  const byName = new Map(provisional.map((entity) => [entity.canonicalName, entity.entityKey]))
  const nicknameResult = resolveBookAnalysisEntities({
    observations,
    identityMerges: [{
      leftEntityKey: byName.get('Meg March'),
      rightEntityKey: byName.get('Margaret March'),
      basis: 'nickname'
    }]
  })
  assert.equal(nicknameResult.length, 1)
  assert.deepEqual(
    new Set([nicknameResult[0].canonicalName, ...nicknameResult[0].aliases]),
    new Set(['Meg March', 'Margaret March'])
  )

  const nameVariantResult = resolveBookAnalysisEntities({
    observations,
    identityMerges: [{
      leftEntityKey: byName.get('Meg March'),
      rightEntityKey: byName.get('Margaret March'),
      basis: 'name_variant'
    }]
  })
  assert.equal(nameVariantResult.length, 2)
})

test('resolver rejects treating a shared given name as another character family name', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111159',
      candidate: 'Jane', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222269',
      candidate: 'Flora Jane', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333379',
      candidate: 'Jane Andrews', startOffset: 300
    })
  ]
  const provisional = resolveBookAnalysisEntities({ observations })
  const byName = new Map(provisional.map((entity) => [entity.canonicalName, entity.entityKey]))
  const result = resolveBookAnalysisEntities({
    observations,
    identityMerges: [{
      leftEntityKey: byName.get('Jane'),
      rightEntityKey: byName.get('Flora Jane'),
      basis: 'name_variant'
    }]
  })
  assert.equal(result.length, 3)
  assert.ok(result.every(({ aliases }) => aliases.length === 0))
})

test('resolver rejects a titled-family merge when multiple relatives share the family name', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111248',
      candidate: 'Mr. Darcy',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222358',
      candidate: 'Miss Darcy',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333468',
      candidate: 'Fitzwilliam Darcy',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444578',
      candidate: 'Georgiana Darcy',
      startOffset: 400
    })
  ]
  const provisional = resolveBookAnalysisEntities({ observations })
  const byName = new Map(provisional.map((entity) => [entity.canonicalName, entity.entityKey]))
  const result = resolveBookAnalysisEntities({
    observations,
    identityMerges: [{
      leftEntityKey: byName.get('Mr. Darcy'),
      rightEntityKey: byName.get('Georgiana Darcy'),
      basis: 'name_variant'
    }]
  })
  assert.equal(result.length, 4)
  assert.deepEqual(result.find(({ canonicalName }) => canonicalName === 'Mr. Darcy').aliases, [])
})

test('resolver keeps a fragment shared by two named roles as a candidate', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111142',
      candidate: 'Footman',
      type: 'character_action',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222252',
      candidate: 'Footman',
      type: 'character_dialogue',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333362',
      candidate: 'Fish Footman',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444472',
      candidate: 'Frog Footman',
      startOffset: 400
    }),
    observation({
      id: '55555555-5555-4555-8555-555555555582',
      candidate: 'Fish Footman',
      startOffset: 500
    }),
    observation({
      id: '66666666-6666-4666-8666-666666666692',
      candidate: 'Frog Footman',
      startOffset: 600
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.find(({ canonicalName }) => canonicalName === 'Footman').resolutionStatus, 'candidate')
  assert.equal(result.filter(({ resolutionStatus }) => resolutionStatus === 'confirmed').length, 2)
})

test('resolver quarantines an ungrounded owned-role label from its named owner', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111143',
      candidate: 'Mrs. Gardiner',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222253',
      candidate: 'Mrs. Gardiner',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333363',
      candidate: "Mrs. Gardiner's other aunt",
      quote: 'she reported some fresh instance of extravagance',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 2)
  assert.equal(result[0].canonicalName, 'Mrs. Gardiner')
  assert.deepEqual(result[0].aliases, [])
  assert.equal(result[1].canonicalName, "Mrs. Gardiner's other aunt")
  assert.equal(result[1].resolutionStatus, 'candidate')
})

test('resolver keeps weak one-off character references as candidates', () => {
  const result = resolveBookAnalysisEntities({
    observations: [observation({
      id: '11111111-1111-4111-8111-111111111113',
      candidate: 'Она',
      confidence: 0.99
    })]
  })
  assert.equal(result[0].resolutionStatus, 'candidate')
})

test('resolver keeps a repeated first-person pronoun out of the published roster', () => {
  const observations = [100, 200, 300, 400, 500, 600].map((startOffset, index) => observation({
    id: `11111111-1111-4111-8111-${String(112950 + index).padStart(12, '0')}`,
    type: 'character_dialogue', candidate: 'I', quote: 'I answered from the room.', startOffset
  }))
  const [character] = resolveBookAnalysisEntities({ observations })
  assert.equal(character.canonicalName, 'I')
  assert.equal(character.resolutionStatus, 'candidate')
})

test('resolver never carries a weak pronoun into a named character alias', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112957',
      type: 'character_alias', candidate: 'Griffin', related: ['I'],
      quote: 'I answered, and Griffin was named later.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222957',
      type: 'character_action', candidate: 'Griffin',
      quote: 'Griffin crossed the room.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333957',
      type: 'character_dialogue', candidate: 'I',
      quote: 'I answered from the room.', startOffset: 300
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 2)
  assert.deepEqual(characters.find(({ canonicalName }) => canonicalName === 'Griffin').aliases, [])
  assert.equal(
    characters.find(({ canonicalName }) => canonicalName === 'I').resolutionStatus,
    'candidate'
  )
})

test('resolver requires source-script grounding for a generated character name', () => {
  const ungrounded = [100, 200, 300].map((startOffset, index) => observation({
    id: `22222222-2222-4222-8222-${String(112960 + index).padStart(12, '0')}`,
    type: 'character_action', candidate: 'Гриффин',
    quote: index === 0 ? 'ГЛАВА I. The invisible man crossed the room.' :
      'The invisible man crossed the room.', startOffset
  }))
  const [candidate] = resolveBookAnalysisEntities({ observations: ungrounded })
  assert.equal(candidate.resolutionStatus, 'candidate')

  const grounded = ungrounded.concat(observation({
    id: '33333333-3333-4333-8333-333333112963',
    type: 'character_dialogue', candidate: 'Гриффин', quote: 'Гриффин ответил.', startOffset: 400
  }))
  const [confirmed] = resolveBookAnalysisEntities({ observations: grounded })
  assert.equal(confirmed.resolutionStatus, 'confirmed')
})

test('resolver keeps a one-off proper-name mention as a candidate until character behaviour corroborates it', () => {
  const mention = resolveBookAnalysisEntities({
    observations: [observation({
      id: '11111111-1111-4111-8111-111111111130',
      candidate: 'Гете',
      confidence: 0.99
    })]
  })
  const dialogue = resolveBookAnalysisEntities({
    observations: [observation({
      id: '22222222-2222-4222-8222-222222222240',
      type: 'character_dialogue',
      candidate: 'Мария',
      confidence: 0.99
    })]
  })
  assert.equal(mention[0].resolutionStatus, 'candidate')
  assert.equal(dialogue[0].resolutionStatus, 'confirmed')
})

test('resolver keeps composite and collective labels out of character synthesis', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111131',
      type: 'character_action',
      candidate: 'Ромео и Бенволио',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222241',
      type: 'character_action',
      candidate: 'Конная армия',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333351',
      type: 'character_dialogue',
      candidate: 'Конная армия',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ resolutionStatus }) => resolutionStatus), [
    'candidate', 'candidate'
  ])
})

test('resolver merges a leading title with the same named character', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111132',
      type: 'character_action',
      candidate: 'Салтан',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222242',
      candidate: 'царь Салтан',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Салтан')
  assert.deepEqual(result[0].aliases, ['царь Салтан'])
})

test('resolver recognizes a proper name after a lowercase leading title', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111134',
      type: 'character_action',
      candidate: 'царь Салтан',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222244',
      candidate: 'царь Салтан',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result[0].resolutionStatus, 'confirmed')
})

test('resolver does not confirm generated descriptions merely because they start uppercase', () => {
  const candidates = [
    'Мертвая лягушка',
    'Капитан дальнего плавания',
    'Механический толстяк',
    'Неустановленный голос',
    'Газовые бронеавтомобили',
    'Две девки-прислужницы',
    'Будочники',
    'Писари',
    'Взводные'
  ]
  const observations = candidates.flatMap((candidate, index) => [
    observation({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      type: 'character_action', candidate, startOffset: index * 100
    }),
    observation({
      id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
      type: 'character_dialogue', candidate, startOffset: index * 100 + 10
    })
  ])
  const result = resolveBookAnalysisEntities({ observations })
  assert.ok(result.every(({ resolutionStatus }) => resolutionStatus === 'candidate'))
})

test('resolver rejects named groups and objects but keeps explicit human roles', () => {
  const rejected = [
    'статуя Магацитла',
    'племя Земзе',
    'вожди Земзе',
    'потомки Земзе',
    'сыны Аама',
    'жрецы Атлантов',
    'гиганты Азии',
    'студенты Хирургической академии'
  ]
  const roles = [
    'коллежский асессор Ковалев',
    'дядя Козий Зоб',
    'председатель Цекубу'
  ]
  const candidates = [...rejected, ...roles]
  const observations = candidates.flatMap((candidate, index) => [
    observation({
      id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
      type: 'character_action', candidate, startOffset: index * 100
    }),
    observation({
      id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
      type: 'character_dialogue', candidate, startOffset: index * 100 + 10
    })
  ])
  const result = resolveBookAnalysisEntities({ observations })
  const byName = new Map(result.map((entity) => [entity.canonicalName, entity]))
  for (const name of rejected) assert.equal(byName.get(name).resolutionStatus, 'candidate')
  for (const name of roles) assert.equal(byName.get(name).resolutionStatus, 'confirmed')
})

test('resolver binds relationship participants to character entity keys including candidates', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111133',
      type: 'character_action',
      candidate: 'Анна',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222243',
      candidate: 'муж Анны',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333353',
      type: 'relationship',
      kind: 'relationship',
      candidate: 'брак Анны',
      related: ['Анна', 'муж Анны'],
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  const characters = result.filter(({ entityKind }) => entityKind === 'character')
  const relationship = result.find(({ entityKind }) => entityKind === 'relationship')
  assert.deepEqual(relationship.data.relatedCharacterEntityKeys, characters.map(({ entityKey }) => entityKey))
  assert.deepEqual(relationship.data.unresolvedRelatedEntityCandidates, [])
})

test('resolver keeps relationship-only participants unresolved without duplicating evidence ownership', () => {
  const observations = [observation({
    id: '11111111-1111-4111-8111-111111111933',
    type: 'relationship',
    kind: 'relationship',
    candidate: 'Father and Mother',
    related: ['Jo', 'Meg'],
    fact: 'Jo and Meg refer to Father and Mother as their parents.',
    quote: 'We have Father and Mother, and each other.',
    confidence: 0.97,
    startOffset: 100
  })]
  const result = resolveBookAnalysisEntities({ observations })
  const characters = result.filter(({ entityKind }) => entityKind === 'character')
  assert.deepEqual(characters, [])
  const relationship = result.find(({ entityKind }) => entityKind === 'relationship')
  assert.deepEqual(relationship.data.relatedCharacterEntityKeys, [])
  assert.deepEqual(
    relationship.data.unresolvedRelatedEntityCandidates,
    ['Father', 'Jo', 'Meg', 'Mother']
  )
  assert.deepEqual(relationship.evidenceIds, [observations[0].id])
})

test('resolver assigns a relationship observation only to its relationship entity', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112933',
      type: 'character_action', candidate: 'Lord Henry', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222933',
      type: 'character_action', candidate: 'Lord Fermor', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333933',
      type: 'relationship', kind: 'relationship',
      candidate: 'Lord Henry and Lord Fermor',
      fact: "Lord Fermor is Lord Henry's uncle.",
      quote: 'Lord Henry went to call on his uncle, Lord Fermor.',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  const relationshipEvidenceId = observations[2].id
  const owners = result.filter(({ evidenceIds }) => evidenceIds.includes(relationshipEvidenceId))
  assert.equal(owners.length, 1)
  assert.equal(owners[0].entityKind, 'relationship')
  assert.deepEqual(
    new Set(owners[0].data.relatedCharacterEntityKeys),
    new Set(result.filter(({ entityKind }) => entityKind === 'character').map(({ entityKey }) => entityKey))
  )
})

test('resolver keeps grounded relationship participants separate through every merge pass', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112934',
      type: 'character_action', candidate: 'Mrs. Vane', fact: 'female',
      quote: 'Mrs. Vane waited in the theatre.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222934',
      type: 'character_dialogue', candidate: 'Mrs. Vane', fact: 'female',
      quote: 'Mrs. Vane answered quietly.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333934',
      type: 'character_action', candidate: 'Sibyl Vane', fact: 'female',
      quote: 'Sibyl Vane crossed the room.', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444934',
      type: 'character_dialogue', candidate: 'Sibyl Vane', fact: 'female',
      quote: 'Sibyl Vane called for her mother.', startOffset: 400
    }),
    observation({
      id: '55555555-5555-4555-8555-555555555934',
      type: 'character_action', candidate: 'James Vane', fact: 'male',
      quote: 'James Vane entered.', startOffset: 500
    }),
    observation({
      id: '66666666-6666-4666-8666-666666666934',
      type: 'relationship', kind: 'relationship',
      candidate: 'Mrs. Vane and Sibyl Vane', related: ['Mrs. Vane', 'Sibyl Vane'],
      fact: 'Mrs. Vane is Sibyl Vane\'s mother.',
      quote: 'Mrs. Vane warned her daughter, Sibyl Vane.', startOffset: 600
    })
  ]

  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.deepEqual(
    characters.map(({ canonicalName }) => canonicalName),
    ['Mrs. Vane', 'Sibyl Vane', 'James Vane']
  )
  assert.ok(characters.every(({ aliases }) => aliases.length === 0))
})

test('resolver propagates a grounded relationship separation through short-name bridges', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112958',
      type: 'character_alias', candidate: 'Anna Vale', related: ['Anna'],
      quote: 'Anna Vale was called Anna.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222958',
      type: 'character_alias', candidate: 'Beth Vale', related: ['Beth'],
      quote: 'Beth Vale was called Beth.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333958',
      type: 'character_alias', candidate: 'Anna', related: ['Beth'],
      quote: 'Anna and Beth answered together.', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444958',
      type: 'relationship', kind: 'relationship',
      candidate: 'Anna Vale and Beth Vale', related: ['Anna Vale', 'Beth Vale'],
      fact: 'Anna Vale is Beth Vale\'s sister.',
      quote: 'Anna Vale spoke to her sister Beth Vale.', startOffset: 400
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 2)
  assert.deepEqual(
    characters.map(({ canonicalName, aliases }) => new Set([canonicalName, ...aliases])),
    [new Set(['Anna Vale', 'Anna']), new Set(['Beth Vale', 'Beth'])]
  )
})

test('resolver does not propagate a short-name separation to a leading-name insertion', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112961',
      type: 'character_action', candidate: 'Alice Bell',
      quote: 'Alice Bell crossed the room.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222961',
      type: 'character_alias', candidate: 'Mary Alice Bell', related: ['Beth Vale'],
      quote: 'Mary Alice Bell, known here as Beth Vale, answered.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333961',
      type: 'character_dialogue', candidate: 'Beth Vale',
      quote: 'Beth Vale replied.', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444961',
      type: 'relationship', kind: 'relationship',
      candidate: 'Alice Bell and Beth Vale', related: ['Alice Bell', 'Beth Vale'],
      fact: 'Alice Bell speaks with Beth Vale.',
      quote: 'Alice Bell spoke to Beth Vale.', startOffset: 400
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 2)
  assert.deepEqual(
    characters.map(({ canonicalName, aliases }) => new Set([canonicalName, ...aliases])),
    [new Set(['Alice Bell']), new Set(['Mary Alice Bell', 'Beth Vale'])]
  )
})

test('resolver never folds an owned role into its named owner', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112935',
      type: 'character_action', candidate: 'Mr. Hubbard',
      quote: 'Mr. Hubbard opened the door.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222935',
      type: 'character_dialogue', candidate: 'Mr. Hubbard',
      quote: 'Mr. Hubbard answered.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333935',
      type: 'character_action', candidate: "Mr. Hubbard's assistant",
      quote: "Mr. Hubbard's assistant carried the bag.", startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444935',
      type: 'character_dialogue', candidate: "Mr. Hubbard's assistant",
      quote: "Mr. Hubbard's assistant replied.", startOffset: 400
    })
  ]

  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.deepEqual(
    characters.map(({ canonicalName }) => canonicalName),
    ['Mr. Hubbard', "Mr. Hubbard's assistant"]
  )
  assert.ok(characters.every(({ aliases }) => aliases.length === 0))
})

test('resolver never turns one owned kinship label into a global family role', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112962',
      type: 'character_action', candidate: 'Father',
      quote: 'Father marked the books.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222962',
      type: 'character_dialogue', candidate: 'Father',
      quote: 'Father answered the girls.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333962',
      type: 'character_mention', candidate: "Laurie's father",
      related: ['Laurie'],
      quote: "It was Laurie's father who entered.", startOffset: 300
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 2)
  assert.deepEqual(characters.map(({ canonicalName }) => canonicalName), [
    'Father', "Laurie's father"
  ])
  assert.ok(characters.every(({ aliases }) => aliases.length === 0))
})

test('resolver does not split a relationship label when both participants are not grounded', () => {
  const result = resolveBookAnalysisEntities({ observations: [observation({
    id: '22222222-2222-4222-8222-222222222943',
    type: 'relationship',
    kind: 'relationship',
    candidate: 'King and Queen',
    quote: 'The royal couple entered.',
    startOffset: 100
  })] })
  assert.equal(result.filter(({ entityKind }) => entityKind === 'character').length, 0)
})

test('resolver merges one unambiguous chain of full-name fragments', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111115',
      candidate: 'Раскольников',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222225',
      candidate: 'Родион Раскольников',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333335',
      candidate: 'Родион Романович Раскольников',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444445',
      candidate: 'Родион Романович',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Родион Романович Раскольников')
  assert.deepEqual(result[0].aliases, [
    'Раскольников', 'Родион Раскольников', 'Родион Романович'
  ])
  assert.deepEqual(result[0].evidenceIds, observations.map(({ id }) => id))
})

test('resolver does not treat a leading given-name insertion as a middle-name expansion', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112944',
      type: 'character_action', candidate: 'Alice Bell',
      quote: 'Alice Bell crossed the room.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222944',
      type: 'character_dialogue', candidate: 'Alice Bell',
      quote: 'Alice Bell answered.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333944',
      type: 'character_action', candidate: 'Mary Alice Bell',
      quote: 'Mary Alice Bell entered.', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444944',
      type: 'character_dialogue', candidate: 'Mary Alice Bell',
      quote: 'Mary Alice Bell spoke.', startOffset: 400
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(characters.map(({ canonicalName }) => canonicalName), [
    'Alice Bell', 'Mary Alice Bell'
  ])
})

test('resolver treats a dotted S middle initial as a name part, not a possessive marker', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112959',
      type: 'character_action', candidate: 'James S. Potter',
      quote: 'James S. Potter entered.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222959',
      type: 'character_dialogue', candidate: 'James',
      quote: 'James answered.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333959',
      type: 'character_action', candidate: 'James',
      quote: 'James crossed the room.', startOffset: 300
    })
  ]
  const [character] = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(new Set([character.canonicalName, ...character.aliases]), new Set([
    'James S. Potter', 'James'
  ]))
})

test('resolver keeps a repeated ambiguous family title separate from full-name relatives', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112945',
      type: 'character_action', candidate: 'Mr. Dashwood', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222945',
      type: 'character_dialogue', candidate: 'Mr. Dashwood', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333945',
      type: 'character_action', candidate: 'Mr. Henry Dashwood', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444945',
      type: 'character_action', candidate: 'Mr. John Dashwood', startOffset: 400
    }),
    observation({
      id: '55555555-5555-4555-8555-555555555945',
      type: 'character_dialogue', candidate: 'Mr. Henry Dashwood', startOffset: 500
    }),
    observation({
      id: '66666666-6666-4666-8666-666666666945',
      type: 'character_dialogue', candidate: 'Mr. John Dashwood', startOffset: 600
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
  const title = characters.find(({ canonicalName }) => canonicalName === 'Mr. Dashwood')
  assert.equal(title.resolutionStatus, 'candidate')
  assert.deepEqual(title.aliases, [])
  assert.equal(characters.length, 3)
})

test('resolver confirms a dominant family title without merging competing full forms', () => {
  const observations = [
    ...Array.from({ length: 20 }, (_, index) => observation({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      type: index % 2 ? 'character_dialogue' : 'character_action',
      candidate: 'Mrs. Dashwood', startOffset: 100 + index * 10
    })),
    ...[0, 1].map((index) => observation({
      id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
      type: index ? 'character_dialogue' : 'character_action',
      candidate: 'Mrs. Henry Dashwood', startOffset: 400 + index * 10
    })),
    ...[0, 1].map((index) => observation({
      id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
      type: index ? 'character_dialogue' : 'character_action',
      candidate: 'Mrs. John Dashwood', startOffset: 500 + index * 10
    }))
  ]
  const characters = resolveBookAnalysisEntities({ observations })
  const title = characters.find(({ canonicalName }) => canonicalName === 'Mrs. Dashwood')
  assert.equal(title.resolutionStatus, 'confirmed')
  assert.deepEqual(title.aliases, [])
  assert.equal(characters.length, 3)
})

test('resolver does not merge an ambiguous surname into two full names', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111116',
      candidate: 'Иванов',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222226',
      candidate: 'Петр Иванов',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333336',
      candidate: 'Сергей Иванов',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Иванов', 'Петр Иванов', 'Сергей Иванов'
  ])
})

test('resolver does not infer that one given name is a unique full-name alias', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111118',
      candidate: 'Анна',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222228',
      candidate: 'Анна Сергеевна',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Анна', 'Анна Сергеевна'
  ])
})

test('resolver merges a repeatedly grounded unique given name with its full form', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111251',
      candidate: 'Jane',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222361',
      candidate: 'Jane',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333471',
      candidate: 'Jane Bennet',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.deepEqual(new Set([result[0].canonicalName, ...result[0].aliases]), new Set([
    'Jane', 'Jane Bennet'
  ]))
})

test('resolver accepts a repeated generated full-name expansion for one unique grounded given name', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111651',
      candidate: 'Jane',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222761',
      candidate: 'Jane',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333871',
      candidate: 'Jane Bennet',
      quote: 'She accepted the invitation.',
      fact: 'female',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444981',
      candidate: 'Jane Bennet',
      quote: 'She answered her sister.',
      fact: 'female',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.deepEqual(new Set([result[0].canonicalName, ...result[0].aliases]), new Set([
    'Jane', 'Jane Bennet'
  ]))
})

test('resolver does not infer a titled-surname identity from gender alone', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112001',
      type: 'character_action', candidate: 'Mr. Darcy', fact: 'male', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222002',
      type: 'character_dialogue', candidate: 'Mr. Darcy', fact: 'male', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333003',
      type: 'character_action', candidate: 'Fitzwilliam Darcy', fact: 'male', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444004',
      type: 'character_dialogue', candidate: 'Fitzwilliam Darcy', fact: 'male', startOffset: 400
    }),
    observation({
      id: '55555555-5555-4555-8555-555555555005',
      type: 'character_action', candidate: 'Miss Darcy', fact: 'female', startOffset: 500
    }),
    observation({
      id: '66666666-6666-4666-8666-666666666006',
      type: 'character_action', candidate: 'Georgiana Darcy', fact: 'female', startOffset: 600
    }),
    observation({
      id: '77777777-7777-4777-8777-777777777007',
      type: 'character_dialogue', candidate: 'Georgiana Darcy', fact: 'female', startOffset: 700
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 4)
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Mr. Darcy', 'Fitzwilliam Darcy', 'Miss Darcy', 'Georgiana Darcy'
  ])
  assert.ok(result.every(({ aliases }) => aliases.length === 0))
})

test('resolver accepts an approved title and full-name pair when only another gender competes', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112963',
      type: 'character_action', candidate: 'Mr. Bingley', fact: 'male', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222963',
      type: 'character_dialogue', candidate: 'Charles Bingley', fact: 'male', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333963',
      type: 'character_action', candidate: 'Caroline Bingley', fact: 'female', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444963',
      type: 'character_dialogue', candidate: 'Caroline Bingley', fact: 'female', startOffset: 400
    })
  ]
  const provisional = resolveBookAnalysisEntities({ observations })
  const byName = new Map(provisional.map((entity) => [entity.canonicalName, entity.entityKey]))
  const characters = resolveBookAnalysisEntities({
    observations,
    identityMerges: [{
      leftEntityKey: byName.get('Mr. Bingley'),
      rightEntityKey: byName.get('Charles Bingley'),
      basis: 'name_variant'
    }]
  })
  assert.equal(characters.length, 2)
  assert.deepEqual(
    new Set([characters[0].canonicalName, ...characters[0].aliases]),
    new Set(['Mr. Bingley', 'Charles Bingley'])
  )
})

test('resolver blocks an approved leading-name insertion even without another family competitor', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112964',
      type: 'character_action', candidate: 'Alice Bell', fact: 'female', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222964',
      type: 'character_action', candidate: 'Mary Alice Bell', fact: 'female', startOffset: 200
    })
  ]
  const provisional = resolveBookAnalysisEntities({ observations })
  const result = resolveBookAnalysisEntities({
    observations,
    identityMerges: [{
      leftEntityKey: provisional[0].entityKey,
      rightEntityKey: provisional[1].entityKey,
      basis: 'name_variant'
    }]
  })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Alice Bell', 'Mary Alice Bell'
  ])
})

test('resolver rejects repeated one-sided titled-family aliases when two relatives compete', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112960',
      type: 'character_alias', candidate: 'Edward Ferrars', related: ['Mr. Ferrars'],
      quote: 'Mr. Ferrars is the happy man.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222960',
      type: 'character_alias', candidate: 'Edward Ferrars', related: ['Mr. Ferrars'],
      quote: 'You have seen enough of Edward.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333960',
      type: 'character_action', candidate: 'Robert Ferrars', fact: 'male',
      quote: 'Robert Ferrars entered.', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444960',
      type: 'character_action', candidate: 'Mr. Ferrars', fact: 'male',
      quote: 'Mr. Ferrars arrived later.', startOffset: 400
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
  assert.equal(characters.length, 3)
  assert.ok(characters.every(({ aliases }) => aliases.length === 0))
})

test('resolver rejects repeated ungrounded alias claims without a competing relative', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112961',
      type: 'character_alias', candidate: 'Lucy Steele', related: ['Miss Steele'],
      quote: 'Lucy Steele entered the room.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222961',
      type: 'character_alias', candidate: 'Lucy Steele', related: ['Miss Steele'],
      quote: 'Lucy Steele spoke again.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333961',
      type: 'character_dialogue', candidate: 'Miss Steele',
      quote: 'Miss Steele asked a question.', startOffset: 300
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
  assert.equal(characters.length, 2)
  assert.ok(characters.every(({ aliases }) => aliases.length === 0))
})

test('resolver quarantines a singular family title when a collective names two relatives', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112962',
      type: 'character_alias', candidate: 'Lucy Steele', related: ['Miss Steele'],
      quote: 'Lucy Steele entered the room.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222962',
      type: 'character_dialogue', candidate: 'Miss Steele',
      quote: 'Miss Steele asked a question.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333962',
      type: 'character_mention', candidate: 'Miss Steeles', related: ['Lucy', 'Anne'],
      quote: 'The Miss Steeles, Lucy and Anne, arrived together.', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444962',
      type: 'character_action', candidate: 'Anne',
      quote: 'Anne asked another question.', startOffset: 400
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
  const lucy = characters.find(({ canonicalName }) => canonicalName === 'Lucy Steele')
  const title = characters.find(({ canonicalName }) => canonicalName === 'Miss Steele')
  assert.deepEqual(lucy.aliases, [])
  assert.equal(title.resolutionStatus, 'candidate')
})

test('resolver applies an explicit signed married-name transition', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112011',
      type: 'character_action', candidate: 'Lydia Bennet', fact: 'female', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222012',
      candidate: 'Lydia Bennet',
      fact: 'Lydia Bennet later signs herself Lydia Wickham.',
      quote: 'I shall write to them, and sign my name Lydia Wickham.',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333013',
      type: 'character_action', candidate: 'Lydia Wickham', fact: 'female', startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.deepEqual(new Set([result[0].canonicalName, ...result[0].aliases]), new Set([
    'Lydia Bennet', 'Lydia Wickham'
  ]))
})

test('resolver joins a signer initial only through an answered-letter authorship bridge', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112015',
      type: 'character_mention', candidate: 'M. Vale',
      fact: 'M. Vale is the signer of the letter.',
      quote: 'Yours sincerely, M. VALE', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222015',
      type: 'character_action', candidate: 'M. Vale',
      quote: 'I recollected my dear Alice and Jane.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333015',
      type: 'character_action', candidate: 'Mr. Vale', fact: 'male',
      quote: 'Mr. Vale wrote to his brother.', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444015',
      type: 'character_action', candidate: 'Mrs. Vale', fact: 'female',
      quote: "Alice had never answered Mrs. Vale's long letter.", startOffset: 400
    }),
    observation({
      id: '55555555-5555-4555-8555-555555555015',
      type: 'character_action', candidate: 'Alice', fact: 'female',
      quote: 'Alice read the letter.', startOffset: 500
    }),
    observation({
      id: '66666666-6666-4666-8666-666666666015',
      type: 'character_action', candidate: 'Jane', fact: 'female',
      quote: 'Jane listened.', startOffset: 600
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
  const valeRows = characters.filter(({ canonicalName, aliases }) =>
    [canonicalName, ...aliases].some((name) => /Vale$/u.test(name))
  )
  assert.equal(valeRows.length, 2)
  const signer = valeRows.find(({ canonicalName, aliases }) =>
    [canonicalName, ...aliases].includes('M. Vale')
  )
  assert.deepEqual(new Set([signer.canonicalName, ...signer.aliases]), new Set([
    'M. Vale', 'Mrs. Vale'
  ]))
  assert.equal(valeRows.some(({ canonicalName, aliases }) =>
    [canonicalName, ...aliases].includes('Mr. Vale')
  ), true)
})

test('resolver ignores isolated namesake noise when one full-name expansion is strong', () => {
  const observations = [
    ...[100, 200, 300].map((startOffset, index) => observation({
      id: `11111111-1111-4111-8111-1111111121${index + 1}`,
      type: 'character_action', candidate: 'Beth', startOffset
    })),
    ...[400, 500, 600, 700, 800].map((startOffset, index) => observation({
      id: `22222222-2222-4222-8222-2222222221${index + 1}`,
      type: 'character_action', candidate: 'Beth March', startOffset
    })),
    observation({
      id: '33333333-3333-4333-8333-333333333111',
      candidate: 'Mrs. Beth Bouncer', startOffset: 900
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 2)
  assert.deepEqual(new Set([result[0].canonicalName, ...result[0].aliases]), new Set([
    'Beth', 'Beth March'
  ]))
  assert.equal(result[1].canonicalName, 'Mrs. Beth Bouncer')
})

test('resolver triangulates a family nickname without merging an ordinary relative', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112121',
      candidate: 'Marmee March', related: ['Marmee', 'Mrs. March', 'Mother'],
      confidence: 0.98,
      quote: 'Three cheers for Marmee while Meg conducted Mother to the seat of honor.',
      startOffset: 100
    }),
    observation({
      id: '11111111-1111-4111-8111-111111112120',
      type: 'character_dialogue', candidate: 'Marmee',
      quote: 'Marmee approved the plan.', startOffset: 150
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222122',
      type: 'character_action', candidate: 'Mrs. March', related: ['Marmee'],
      confidence: 0.99, quote: 'Mrs. March examined the presents.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333123',
      type: 'character_action', candidate: 'Jo March', related: ['Mrs. March'],
      quote: 'Jo asked her mother a question.', startOffset: 300
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
  assert.equal(characters.length, 2)
  const mother = characters.find(({ canonicalName, aliases }) =>
    canonicalName === 'Mrs. March' || aliases.includes('Mrs. March')
  )
  assert.deepEqual(new Set([mother.canonicalName, ...mother.aliases]), new Set([
    'Marmee', 'Marmee March', 'Mrs. March'
  ]))
  assert.equal(characters.some(({ canonicalName }) => canonicalName === 'Jo March'), true)
})

test('resolver requires reciprocal evidence for a family nickname', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112131',
      candidate: 'Marmee March', related: ['Marmee', 'Mrs. March', 'Mother'],
      confidence: 0.98,
      quote: 'Three cheers for Marmee while Meg conducted Mother to the seat of honor.',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222132',
      type: 'character_action', candidate: 'Mrs. March',
      quote: 'Mrs. March examined the presents.', startOffset: 200
    })
  ]
  assert.equal(resolveBookAnalysisEntities({ observations }).length, 2)
})

test('resolver joins a declared first name to a unique nickname with the same family name', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112141',
      type: 'character_alias', candidate: 'Laurie', related: ['Laurie Laurence'],
      quote: 'Laurie Laurence was known to his friends as Laurie.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222142',
      type: 'character_dialogue', candidate: 'Laurie',
      quote: 'My first name is Theodore, but the fellows called me Dora, so I made them say Laurie instead.',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333143',
      type: 'character_action', candidate: 'Theodore Laurence', startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.deepEqual(new Set([result[0].canonicalName, ...result[0].aliases]), new Set([
    'Laurie', 'Laurie Laurence', 'Theodore Laurence'
  ]))
})

test('resolver does not use a first-name declaration without a shared family bridge', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112151',
      type: 'character_alias', candidate: 'Laurie', related: ['Laurie Laurence'],
      quote: 'Laurie Laurence was known to his friends as Laurie.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222152',
      type: 'character_dialogue', candidate: 'Laurie',
      quote: 'My first name is Theodore, but I made them say Laurie instead.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333153',
      type: 'character_action', candidate: 'Theodore Cooper', startOffset: 300
    })
  ]
  assert.equal(resolveBookAnalysisEntities({ observations }).length, 2)
})

test('resolver follows an explicit spouse surname into a later full-name form', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112161',
      type: 'character_action', candidate: 'Jo March', fact: 'female', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222162',
      type: 'character_action', candidate: 'Friedrich Bhaer', fact: 'male', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333163',
      type: 'character_dialogue', candidate: 'Jo March', related: ['Friedrich Bhaer'],
      fact: 'Jo says she could not bear a rich husband.',
      quote: 'I could not bear a rich husband, said Jo.', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444164',
      type: 'character_action', candidate: 'Jo Bhaer', fact: 'female', startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 2)
  const jo = result.find(({ canonicalName, aliases }) =>
    canonicalName === 'Jo March' || aliases.includes('Jo March')
  )
  assert.deepEqual(new Set([jo.canonicalName, ...jo.aliases]), new Set([
    'Jo March', 'Jo Bhaer'
  ]))
})

test('resolver does not infer a surname transition without an explicit spouse cue', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112171',
      type: 'character_action', candidate: 'Jo March', fact: 'female', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222172',
      type: 'character_action', candidate: 'Friedrich Bhaer', fact: 'male', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333173',
      type: 'character_dialogue', candidate: 'Jo March', related: ['Friedrich Bhaer'],
      fact: 'Jo discusses a school with Friedrich.', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444174',
      type: 'character_action', candidate: 'Jo Bhaer', fact: 'female', startOffset: 400
    })
  ]
  assert.equal(resolveBookAnalysisEntities({ observations }).length, 3)
})

test('resolver joins a spouse to one compatible married title and full form', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112021',
      type: 'character_action', candidate: 'Charlotte Lucas', fact: 'female', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222022',
      type: 'character_dialogue', candidate: 'Charlotte Lucas', fact: 'female', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333023',
      type: 'character_action', candidate: 'Mr. Collins', fact: 'male', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444024',
      type: 'character_dialogue', candidate: 'Mr. Collins', fact: 'male', startOffset: 400
    }),
    observation({
      id: '55555555-5555-4555-8555-555555555025',
      type: 'character_action', candidate: 'Mrs. Collins', fact: 'female', startOffset: 500
    }),
    observation({
      id: '66666666-6666-4666-8666-666666666026',
      type: 'character_dialogue', candidate: 'Mrs. Collins', fact: 'female', startOffset: 600
    }),
    observation({
      id: '77777777-7777-4777-8777-777777777027',
      type: 'character_action', candidate: 'Charlotte Collins', fact: 'female', startOffset: 700
    }),
    observation({
      id: '88888888-8888-4888-8888-888888888028',
      type: 'relationship', kind: 'relationship', candidate: 'Charlotte and Mr. Collins',
      related: ['Charlotte Lucas', 'Mr. Collins'],
      fact: 'Charlotte Lucas is married to Mr. Collins.',
      quote: 'Charlotte, the wife of Mr. Collins, received her friend.',
      startOffset: 800
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  const characters = result.filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 2)
  const charlotte = characters.find(({ canonicalName, aliases }) =>
    canonicalName === 'Charlotte Lucas' || aliases.includes('Charlotte Lucas')
  )
  assert.deepEqual(new Set([charlotte.canonicalName, ...charlotte.aliases]), new Set([
    'Charlotte Lucas', 'Charlotte Collins', 'Mrs. Collins'
  ]))
})

test('resolver does not merge a spouse with a child who shares the family name', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112041',
      type: 'character_action', candidate: 'Mr. Bennet', fact: 'male', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222042',
      type: 'character_action', candidate: 'Mrs. Bennet', fact: 'female', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333043',
      type: 'character_action', candidate: 'Miss Bennet', fact: 'female', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444044',
      type: 'character_action', candidate: 'Jane Bennet', fact: 'female', startOffset: 400
    }),
    observation({
      id: '55555555-5555-4555-8555-555555555045',
      type: 'relationship', kind: 'relationship', candidate: 'Mr. and Mrs. Bennet',
      related: ['Mr. Bennet', 'Mrs. Bennet'], fact: 'Mr. and Mrs. Bennet are spouses.',
      quote: 'Mr. Bennet answered his wife, Mrs. Bennet.', startOffset: 500
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 4)
})

test('resolver does not treat a one-letter signer initial as an honorific name', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112051',
      type: 'character_action', candidate: 'Mr. Gardiner', fact: 'male', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222052',
      type: 'character_action', candidate: 'Mr. Gardiner', fact: 'male', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333053',
      type: 'character_action', candidate: 'M. Gardiner', startOffset: 300
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
  assert.equal(characters.length, 2)
})

test('resolver blocks an approved signer-initial and honorific merge', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112965',
      type: 'character_action', candidate: 'Mr. Gardiner', fact: 'male', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222965',
      type: 'character_action', candidate: 'M. Gardiner', startOffset: 200
    })
  ]
  const provisional = resolveBookAnalysisEntities({ observations })
  const result = resolveBookAnalysisEntities({
    observations,
    identityMerges: [{
      leftEntityKey: provisional[0].entityKey,
      rightEntityKey: provisional[1].entityKey,
      basis: 'name_variant'
    }]
  })
  assert.equal(result.length, 2)
  assert.ok(result.every(({ aliases }) => aliases.length === 0))
})

test('resolver may use one attributed behaviour when one strong full form is unique', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111112031',
      type: 'character_dialogue', candidate: 'Maria',
      quote: 'It is not Lady Catherine. The other is Miss De Bourgh.',
      startOffset: 100
    }),
    ...[200, 300, 400].map((startOffset, index) => observation({
      id: `22222222-2222-4222-8222-22222222203${index + 2}`,
      type: 'character_action', candidate: 'Maria Lucas', fact: 'female',
      quote: 'Sir William Lucas and his daughter Maria entered the room.',
      startOffset
    }))
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.deepEqual(new Set([result[0].canonicalName, ...result[0].aliases]), new Set([
    'Maria', 'Maria Lucas'
  ]))
})

test('resolver blocks an approved merge across incompatible person genders', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111652',
      candidate: 'Colonel Forster',
      fact: 'male',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222762',
      candidate: 'Mrs. Forster',
      fact: 'female',
      startOffset: 200
    })
  ]
  const provisional = resolveBookAnalysisEntities({ observations })
  const byName = new Map(provisional.map((entity) => [entity.canonicalName, entity.entityKey]))
  const result = resolveBookAnalysisEntities({
    observations,
    identityMerges: [{
      leftEntityKey: byName.get('Colonel Forster'),
      rightEntityKey: byName.get('Mrs. Forster'),
      basis: 'married_name'
    }]
  })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Colonel Forster', 'Mrs. Forster'
  ])
})

test('resolver keeps a repeated given name separate when two full forms compete', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111252',
      candidate: 'Mary',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222362',
      candidate: 'Mary',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333472',
      candidate: 'Mary Bennet',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444582',
      candidate: 'Mary King',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 3)
})

test('resolver merges a repeated unique titled prefix with its complete name', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111253',
      candidate: 'Sir William',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222363',
      candidate: 'Sir William',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333473',
      candidate: 'Sir William Lucas',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
})

test('resolver keeps repeated descriptive character labels out of synthesis', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111117',
      candidate: 'молодой человек',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222227',
      candidate: 'молодой человек',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].resolutionStatus, 'candidate')
})

test('resolver keeps capitalized descriptive phrases out of synthesis', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111119',
      candidate: 'Пьяная девушка',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222229',
      candidate: 'Пьяная девушка',
      type: 'character_action',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333339',
      candidate: 'Невеста Свидригайлова',
      confidence: 0.99,
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ resolutionStatus }) => resolutionStatus), [
    'candidate', 'candidate'
  ])
})

test('resolver merges a full name through a unique patronymic and nickname bridge', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111120',
      candidate: 'Авдотья Романовна Раскольникова',
      related: ['Дуня'],
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222230',
      candidate: 'Авдотья Романовна',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333340',
      candidate: 'Авдотья Романовна Дуня',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444450',
      candidate: 'Дуня',
      related: ['Авдотья Романовна'],
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Авдотья Романовна Раскольникова')
  assert.deepEqual(result[0].aliases, [
    'Авдотья Романовна', 'Авдотья Романовна Дуня', 'Дуня'
  ])
})

test('resolver uses a Russian patronymic composite as a nickname bridge without related links', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111124',
      candidate: 'Авдотья Романовна Раскольникова',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222234',
      candidate: 'Авдотья Романовна',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333344',
      candidate: 'Авдотья Романовна Дуня',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444454',
      candidate: 'Дуня',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Авдотья Романовна Раскольникова')
  assert.deepEqual(result[0].aliases, [
    'Авдотья Романовна', 'Авдотья Романовна Дуня', 'Дуня'
  ])
})

test('resolver merges a Russian ya-name with its echka diminutive', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111126',
      candidate: 'Дуня',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222236',
      candidate: 'Дунечка',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Дунечка')
  assert.deepEqual(result[0].aliases, ['Дуня'])
})

test('resolver does not merge unrelated diminutives without the exact ya-echka form', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111127',
      candidate: 'Анна',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222237',
      candidate: 'Анечка',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333347',
      candidate: 'Манечка',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Анна', 'Анечка', 'Манечка'
  ])
})

test('resolver merges the same three-part full name in a different token order', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111128',
      candidate: 'Родион Романович Раскольников',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222238',
      candidate: 'Раскольников Родион Романович',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Родион Романович Раскольников')
  assert.deepEqual(result[0].aliases, ['Раскольников Родион Романович'])
})

test('resolver does not merge partially overlapping or two-part reordered names', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111129',
      candidate: 'Анна Мария Иванова',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222239',
      candidate: 'Мария Анна Петрова',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333349',
      candidate: 'Иван Иванов',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444459',
      candidate: 'Иванов Иван',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Анна Мария Иванова', 'Мария Анна Петрова', 'Иван Иванов', 'Иванов Иван'
  ])
})

test('resolver does not treat a regular surname after a patronymic as a nickname bridge', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111125',
      candidate: 'Анна Сергеевна',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222235',
      candidate: 'Анна Сергеевна Иванова',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333345',
      candidate: 'Иванова',
      startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444444455',
      candidate: 'Анна Сергеевна Петрова',
      startOffset: 400
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName, aliases }) => ({ canonicalName, aliases })), [
    { canonicalName: 'Анна Сергеевна', aliases: [] },
    { canonicalName: 'Анна Сергеевна Иванова', aliases: ['Иванова'] },
    { canonicalName: 'Анна Сергеевна Петрова', aliases: [] }
  ])
})

test('resolver does not treat one-way related mentions as aliases', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111122',
      candidate: 'Лизавета',
      related: ['Алена Ивановна'],
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222232',
      candidate: 'Алена Ивановна',
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Лизавета', 'Алена Ивановна'
  ])
})

test('resolver does not merge reciprocal mentions without a composite name bridge', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111123',
      candidate: 'Анна Сергеевна',
      related: ['Борис Иванович'],
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222233',
      candidate: 'Борис Иванович',
      related: ['Анна Сергеевна'],
      startOffset: 200
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(result.map(({ canonicalName }) => canonicalName), [
    'Анна Сергеевна', 'Борис Иванович'
  ])
})

test('resolver merges a unique surname after joining colloquial patronymic variants', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111121',
      candidate: 'Андрей Семеныч Лебезятников',
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222231',
      candidate: 'Андрей Семенович Лебезятников',
      startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333341',
      candidate: 'Лебезятников',
      startOffset: 300
    })
  ]
  const result = resolveBookAnalysisEntities({ observations })
  assert.equal(result.length, 1)
  assert.equal(result[0].canonicalName, 'Андрей Семенович Лебезятников')
  assert.deepEqual(result[0].aliases, ['Андрей Семеныч Лебезятников', 'Лебезятников'])
})

test('resolver output is stable regardless of scan completion order', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111111114',
      type: 'character_alias',
      candidate: 'Борис Иванович',
      related: ['Борис'],
      startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222222224',
      candidate: 'Борис',
      startOffset: 200
    })
  ]
  const forward = resolveBookAnalysisEntities({ observations })
  const reverse = resolveBookAnalysisEntities({ observations: [...observations].reverse() })
  assert.deepEqual(reverse, forward)
})

test('resolver merges a titled surname with the only full name substituted by scan evidence', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111113001',
      type: 'character_action', candidate: 'Mr. Wickham', fact: 'male', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222223001',
      type: 'character_action', candidate: 'George Wickham',
      fact: 'George Wickham is described as a young man.',
      quote: 'Mr. Wickham is by no means a respectable young man.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333001',
      type: 'character_action', candidate: 'Lydia Wickham', fact: 'female', startOffset: 300
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
  const wickham = characters.find(({ aliases, canonicalName }) =>
    [canonicalName, ...aliases].includes('George Wickham')
  )
  assert.deepEqual(new Set([wickham.canonicalName, ...wickham.aliases]), new Set([
    'George Wickham', 'Mr. Wickham'
  ]))
  assert.ok(characters.some(({ canonicalName }) => canonicalName === 'Lydia Wickham'))
  assert.equal(characters.length, 2)
})

test('resolver does not infer candidate gender from a different person in the fact', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111113010',
      type: 'character_gender', candidate: 'Mrs. Alexander Spencer', fact: 'female',
      quote: 'Mrs. Alexander Spencer called.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222223010',
      type: 'character_action', candidate: 'Mrs. Alexander Spencer',
      fact: 'Mrs. Alexander Spencer will bring a boy.',
      quote: 'Mrs. Spencer will bring a boy.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333010',
      type: 'character_action', candidate: 'Mrs. Spencer', fact: 'female',
      quote: 'Mrs. Spencer arrived.', startOffset: 300
    })
  ]
  const [character] = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.deepEqual(new Set([character.canonicalName, ...character.aliases]), new Set([
    'Mrs. Alexander Spencer', 'Mrs. Spencer'
  ]))
})

test('resolver leaves a shared title separate when evidence substitutes it for two relatives', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111113002',
      type: 'character_action', candidate: 'Mr. Ferrars', fact: 'male', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222223002',
      type: 'character_action', candidate: 'Edward Ferrars', fact: 'male',
      quote: 'Mr. Ferrars entered the room.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333002',
      type: 'character_action', candidate: 'Robert Ferrars', fact: 'male',
      quote: 'Mr. Ferrars left the house.', startOffset: 300
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 3)
  assert.ok(characters.every(({ aliases }) => aliases.length === 0))
})

test('resolver does not use an owned family title to bridge two full-name relatives', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111113007',
      type: 'character_alias', candidate: 'Charlotte Lucas', related: ['Miss Lucas'],
      fact: 'female', quote: 'Miss Lucas, Charlotte Lucas, entered.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222223007',
      type: 'character_action', candidate: 'Maria Lucas', fact: 'female',
      quote: 'Miss Lucas answered Maria.', startOffset: 200
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 2)
  const charlotte = characters.find(({ canonicalName, aliases }) =>
    [canonicalName, ...aliases].includes('Charlotte Lucas')
  )
  assert.ok(![charlotte.canonicalName, ...charlotte.aliases].includes('Maria Lucas'))
})

test('resolver keeps a substituted family title apart from a grounded relative', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111113003',
      type: 'character_action', candidate: 'Mrs. Vane', fact: 'female', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222223003',
      type: 'character_action', candidate: 'Sibyl Vane', fact: 'female',
      quote: 'Mrs. Vane crossed the room.', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333003',
      type: 'relationship', kind: 'relationship', candidate: 'Sibyl Vane and Mrs. Vane',
      related: ['Sibyl Vane', 'Mrs. Vane'], fact: 'Mrs. Vane is Sibyl Vane\'s mother.',
      quote: 'Mrs. Vane put her hands on her daughter\'s head.', startOffset: 300
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 2)
  assert.ok(characters.every(({ aliases }) => aliases.length === 0))
})

test('resolver treats two grounded names in one quote as co-occurrence, not substitution', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111113009',
      type: 'character_action', candidate: 'Mrs. Barry', fact: 'female',
      quote: 'Mrs. Barry said that Aunt Josephine had arrived.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222223009',
      type: 'character_action', candidate: 'Aunt Josephine Barry', fact: 'female',
      quote: 'Aunt Josephine Barry entered the room.', startOffset: 200
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.equal(characters.length, 2)
  assert.ok(characters.every(({ aliases }) => aliases.length === 0))
})

test('resolver merges a named aunt title with the same grounded personal name', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111113004',
      type: 'character_action', candidate: 'Aunt Josephine Barry', fact: 'female', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222223004',
      type: 'character_action', candidate: 'Miss Josephine Barry', fact: 'female', startOffset: 200
    })
  ]
  const [character] = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(new Set([character.canonicalName, ...character.aliases]), new Set([
    'Aunt Josephine Barry', 'Miss Josephine Barry'
  ]))
})

test('resolver does not merge a named aunt through a family-only title cluster', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111113008',
      type: 'character_action', candidate: 'Aunt Josephine Barry', fact: 'female', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222223008',
      type: 'character_action', candidate: 'Miss Josephine Barry', fact: 'female', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333008',
      type: 'character_action', candidate: 'Josephine Barry', related: ['Miss Barry'],
      fact: 'female', quote: 'Miss Barry wrote to Josephine Barry.', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444443008',
      type: 'character_action', candidate: 'Mrs. Barry',
      fact: 'female', quote: 'Mrs. Barry spoke to her daughter.', startOffset: 400
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  assert.ok(characters.length >= 2)
  assert.ok(characters.every(({ canonicalName, aliases }) => {
    const names = [canonicalName, ...aliases]
    return !(names.some((name) => name.includes('Josephine')) && names.includes('Mrs. Barry'))
  }))
})

test('resolver merges a spouse-style title after repeated same-family cross-references', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111113005',
      type: 'character_alias', candidate: 'Fanny Dashwood', related: ['Fanny'], fact: 'female',
      quote: 'Fanny Dashwood, called Fanny by her family, spoke.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222223005',
      type: 'character_action', candidate: 'Mrs. John Dashwood', related: ['Fanny'],
      fact: 'female', startOffset: 200
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333005',
      type: 'character_action', candidate: 'Mrs. John Dashwood', related: ['Fanny'],
      fact: 'female', startOffset: 400
    }),
    observation({
      id: '44444444-4444-4444-8444-444444443005',
      type: 'character_action', candidate: 'Fanny',
      fact: 'Fanny is John Dashwood\'s wife.', startOffset: 500
    })
  ]
  const [character] = resolveBookAnalysisEntities({ observations })
  assert.deepEqual(new Set([character.canonicalName, ...character.aliases]), new Set([
    'Fanny', 'Fanny Dashwood', 'Mrs. John Dashwood'
  ]))
})

test('resolver does not propagate a family-title separation to every full-name relative', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111113011',
      type: 'relationship', kind: 'relationship',
      candidate: 'Mrs. Dashwood and Mrs. John Dashwood',
      related: ['Mrs. Dashwood', 'Mrs. John Dashwood'],
      fact: 'Mrs. Dashwood is Mrs. John Dashwood\'s mother-in-law.',
      quote: 'Mrs. Dashwood answered Mrs. John Dashwood.', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222223011',
      type: 'character_action', candidate: 'Fanny Dashwood',
      fact: 'Fanny Dashwood is John Dashwood\'s wife.', startOffset: 200
    }),
    observation({
      id: '55555555-5555-4555-8555-555555553011',
      type: 'character_gender', candidate: 'Fanny Dashwood', fact: 'female', startOffset: 250
    }),
    observation({
      id: '33333333-3333-4333-8333-333333333011',
      type: 'character_action', candidate: 'Mrs. John Dashwood', related: ['Fanny Dashwood'],
      fact: 'female', startOffset: 300
    }),
    observation({
      id: '44444444-4444-4444-8444-444444443011',
      type: 'character_action', candidate: 'Mrs. John Dashwood', related: ['Fanny Dashwood'],
      fact: 'female', startOffset: 500
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
    .filter(({ entityKind }) => entityKind === 'character')
  const fanny = characters.find(({ canonicalName, aliases }) =>
    [canonicalName, ...aliases].includes('Fanny Dashwood')
  )
  assert.ok([fanny.canonicalName, ...fanny.aliases].includes('Mrs. John Dashwood'))
  assert.ok(![fanny.canonicalName, ...fanny.aliases].includes('Mrs. Dashwood'))
})

test('resolver does not merge a spouse-style title from one related mention', () => {
  const observations = [
    observation({
      id: '11111111-1111-4111-8111-111111113006',
      type: 'character_action', candidate: 'Fanny Dashwood', fact: 'female', startOffset: 100
    }),
    observation({
      id: '22222222-2222-4222-8222-222222223006',
      type: 'character_action', candidate: 'Mrs. John Dashwood', related: ['Fanny Dashwood'],
      fact: 'female', startOffset: 200
    })
  ]
  const characters = resolveBookAnalysisEntities({ observations })
  assert.equal(characters.length, 2)
})
