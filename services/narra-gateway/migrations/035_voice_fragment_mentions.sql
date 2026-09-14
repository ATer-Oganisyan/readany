-- Фрагмент голоса рассказчика доказывает речь, а не имя.
--
-- Эвристика рассказчика берёт абзацы, где персонаж говорит от первого лица и
-- по имени не назван: без них «Игрок», «Белые ночи» и «Записки из подполья» не
-- дают рассказчику ни одной цитаты. У такого фрагмента ноль именных упоминаний,
-- и старое условие `mention_count > 0` роняло всю стадию Prepare целиком.
-- Roster рядом (032) уже допускает ноль — приводим фрагменты к тому же правилу.
ALTER TABLE book_character_fragments
  DROP CONSTRAINT IF EXISTS book_character_fragments_mention_count_check;

ALTER TABLE book_character_fragments
  ADD CONSTRAINT book_character_fragments_mention_count_check
  CHECK (mention_count >= 0);
