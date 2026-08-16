const entries = (codes, sampleRate, gender, group) => codes.map((code) => [
  code,
  Object.freeze({
    providerVoice: `${code}_${sampleRate}`,
    sampleRate,
    gender,
    group
  })
])

const VOICES = new Map([
  ...entries(['Che'], 48000, 'female', 'assistant'),
  ...entries(['She'], 48000, 'male', 'assistant'),
  ...entries(['Erm'], 48000, 'female', 'assistant'),

  ...entries(['Ast', 'Gal', 'Bez', 'Ego', 'Izv'], 48000, 'male', 'library'),
  ...entries(['Ste', 'Tso', 'Chr'], 48000, 'female', 'library'),
  ...entries([
    'Ana', 'Ann', 'Bek', 'Boc', 'Chp', 'Dsu', 'Klu', 'Min', 'Mir', 'Ovs',
    'San', 'Sdo', 'Shc', 'Shl', 'Sid', 'Sto', 'Str', 'Tar', 'Tre', 'Uso',
    'Vol'
  ], 24000, 'male', 'library'),
  ...entries([
    'Aer', 'Bal', 'Buz', 'Dad', 'Dyu', 'Kab', 'Kud', 'Mak', 'Sko', 'Smi',
    'Sne', 'Sta', 'Ved'
  ], 24000, 'female', 'library'),

  ...entries(['Ksa'], 48000, 'male', 'child'),
  ...entries(['Saf', 'Bsa'], 48000, 'female', 'child'),
  ...entries(['Kkr', 'Ktr'], 24000, 'male', 'child'),
  ...entries(['Kbu', 'Koz'], 24000, 'female', 'child'),

  ...entries(['Mar', 'Kas'], 48000, 'male', 'manual'),
  ...entries([
    'Aso', 'Bai', 'Bik', 'Bol', 'Gav', 'Gri', 'Gur', 'Igr', 'Kai', 'Kar',
    'Ker', 'Kha', 'Kis', 'Kka', 'Kor', 'Kov', 'Lil', 'Mel', 'Nag', 'Ore',
    'Peh', 'Pik', 'Pot', 'Pru', 'Rab', 'Res', 'Roz', 'Rum', 'Shi', 'Tob',
    'Tya', 'Voy'
  ], 24000, 'unspecified', 'manual')
])

export function voiceConfig(voice) {
  return VOICES.get(voice)
}

export function isSupportedVoice(voice) {
  return VOICES.has(voice)
}

const DEFAULT_VOICE_BY_GENDER = Object.freeze({
  male: 'She',
  female: 'Che',
  unspecified: 'Erm'
})

/**
 * Keeps generated voices compatible with the evidence-backed character gender.
 * An unknown gender may retain any supported voice; a missing or incompatible
 * voice gets a deterministic assistant fallback.
 */
export function voiceForGender(voice, gender) {
  const normalizedGender = gender === 'male' || gender === 'female' ? gender : 'unspecified'
  const configured = voiceConfig(voice)
  if (
    configured &&
    (normalizedGender === 'unspecified' || configured.gender === normalizedGender)
  ) {
    return voice
  }
  return DEFAULT_VOICE_BY_GENDER[normalizedGender]
}

export const SUPPORTED_VOICES = Object.freeze([...VOICES.keys()])
