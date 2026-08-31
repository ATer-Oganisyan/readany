DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'book_characters'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%character_key%'
  LOOP
    EXECUTE format(
      'ALTER TABLE book_characters DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE book_characters
  ADD CONSTRAINT book_characters_key_v3 CHECK (
    character_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
  );
