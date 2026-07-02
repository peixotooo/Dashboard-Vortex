-- Migration 129: Feedback do cliente nas respostas do assistente
--
-- Base do monitoramento de satisfação antes de liberar em todos os produtos:
-- o widget mostra 👍/👎 discreto em cada resposta; o dashboard agrega.
-- 1 = útil · -1 = não útil · NULL = sem avaliação. Só faz sentido em
-- role='assistant' (o endpoint valida).

ALTER TABLE assistant_messages
  ADD COLUMN IF NOT EXISTS feedback SMALLINT;
